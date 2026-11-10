import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade } from "ts-fsrs";
import { check, gradeCorrection, toGrade } from "../lib/check";
import { buildRound, buildTranslateRound, buildTutorSession, exerciseFor } from "../lib/session";
import { loadGrammar, topicsFor } from "../lib/grammar";
import { newMemory, nextIn, review } from "../lib/srs";
import { correct, correctTranslation, generateTask, targetLabel, tutorReady, type Correction, type TranslationTask } from "../lib/tutor";
import type { Exercise, GrammarTopic, Memory, Progress, Verdict, Word } from "../lib/types";
import { useLevel } from "./useLevel";
import { intervalCap, sessionLoad } from "./plan";
import { dayKey } from "../lib/intensive";
import { atomicAssoc, bumpAssoc, assocOf } from "../lib/assoc";
import { AI_MAX_TRIES, AI_TIME_LIMIT_MS, TYPED_MAX_TRIES, canRetry, finalGrade, formatLeft } from "../lib/attempts";
import { Rating } from "ts-fsrs";

export type RoundMode = "mixed" | "translate" | "tutor";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  onDone: () => void;
  mode: RoundMode;
}

interface Outcome {
  verdict: Verdict;
  expected?: string;
  next: string;
  correction?: Correction;
  reference?: string;
  note?: string;
  tries?: number;
  grammarLabel?: string;
  wordId?: string;
  wordLabel?: string;
}

/** Retry state for the current exercise (reset when the exercise changes). */
export interface Attempt {
  tries: number;
  startedAt: number;
  last?: Correction;
  lastVerdict: Verdict;
  message?: string;
}
export const freshAttempt = (): Attempt => ({ tries: 0, startedAt: Date.now(), lastVerdict: "wrong" });

const prompts: Record<Exercise["kind"], (e: Exercise, lang: string) => string> = {
  article: () => "Which article?",
  plural: (e) => `Plural of ${e.word.gender} ${e.word.word}`,
  p3: (e) => `er / sie / es … (${e.word.word})`,
  pp: (e) => `Partizip II of ${e.word.word}`,
  translate: (_e, lang) => (lang === "Français" ? "Traduis en allemand" : "Translate into German"),
  write: (e) => `Write a sentence with ${targetLabel(e.word)}`,
};

/** German words the learner already practised: offered to the AI as scaffold for its sentences. */
const knownLabels = (words: Word[], memory: Record<string, Memory>) =>
  words.filter((w) => (memory[w.id]?.streak ?? 0) >= 1).map(targetLabel);

export function Round({ progress, update, onDone, mode }: Props) {
  const data = useLevel(progress.settings.level);
  const ready = tutorReady(progress.settings);
  const [queue, setQueue] = useState<Exercise[] | null>(null);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [right, setRight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<{ state: "idle" | "loading" | "ready" | "error"; value?: TranslationTask; message?: string; revived?: boolean }>({ state: "idle" });
  const [attempt, setAttempt] = useState<Attempt>(freshAttempt);
  const [clock, setClock] = useState(Date.now());
  const requeued = useRef(new Set<string>());
  const [topics, setTopics] = useState<GrammarTopic[] | null>(mode === "tutor" ? null : []);
  useEffect(() => {
    if (mode !== "tutor") return;
    loadGrammar()
      .then((all) => setTopics(topicsFor(all, progress.settings.level)))
      .catch(() => setTopics([])); // grammar is optional: the session still runs on words
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // build the round once, when the words arrive
  useEffect(() => {
    if (data.state !== "ready" || queue !== null || topics === null) return;
    const now = new Date();
    // intensive mode only scales these normal rounds (sizes, today's new-word goal, exam-list order)
    const load = sessionLoad(progress, data.words, now);
    if (mode === "tutor") {
      setQueue(buildTutorSession(data.words, topics, progress.memory, now, { size: load.tutorSize, newMax: load.tutorNewMax, newFirst: load.newFirst, examFirst: load.examFirst }));
    } else if (mode === "translate") {
      setQueue(buildTranslateRound(data.words, progress.memory, now, { size: 5 }));
    } else {
      setQueue(buildRound(data.words, progress.memory, now, { size: load.wordSize, newMax: load.wordNewMax, tutorReady: ready, examFirst: load.examFirst, translateFrom: load.translateFrom }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, queue, mode, ready, topics]);

  const ex = queue?.[index];
  const known = data.state === "ready" ? knownLabels(data.words, progress.memory) : [];

  // translation: ask the AI for a sentence when the exercise appears
  const loadTask = useCallback(async () => {
    if (!ex || ex.kind !== "translate") return;
    // revive an unsolved sentence for this word instead of asking the AI for a new one
    const saved = progress.tasks?.[ex.word.id];
    if (saved && saved.lang === progress.settings.explainIn && (!ex.grammar || saved.grammar === ex.grammar.id) && (saved.mode ?? "sentence") === (ex.assocMode ?? "sentence")) {
      setTask({ state: "ready", value: { source: saved.source, reference: saved.reference, grammar: saved.grammar }, revived: true });
      setAttempt(freshAttempt());
      return;
    }
    setTask({ state: "loading" });
    try {
      setTask({ state: "ready", value: await generateTask(ex.word, known, progress.settings, fetch, ex.grammar, { mode: ex.assocMode, companions: ex.companions }) });
      setAttempt(freshAttempt()); // the clock starts when the sentence is on screen
    } catch (e) {
      setTask({ state: "error", message: (e as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.word.id, ex?.kind, index]);

  useEffect(() => {
    setAttempt(freshAttempt());
    if (ex?.kind === "translate") loadTask();
    else setTask({ state: "idle" });
  }, [index, ex?.kind, loadTask]);

  const isAi = ex?.kind === "translate" || ex?.kind === "write";
  // countdown for AI exercises; when time runs out the answer is shown
  useEffect(() => {
    if (!isAi || outcome) return;
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isAi, outcome, index]);

  const grade = (verdict: Verdict, g: Grade, extra: Partial<Outcome> = {}) => {
    if (!ex) return;
    const solved = verdict === "right";
    const now = new Date();
    const isNew = !progress.memory[ex.word.id];
    const prev: Memory = progress.memory[ex.word.id] ?? newMemory(now);
    const mem = review(prev, g, now, { maxIntervalDays: intervalCap(progress, now) });
    const day = dayKey(now);
    update((p) => {
      const log = p.daily?.[day] ?? { new: 0, reviews: 0 };
      const daily = { ...p.daily, [day]: isNew ? { ...log, new: log.new + 1 } : { ...log, reviews: log.reviews + 1 } };
      // translation sentences: keep an unsolved one to revive next time, drop a solved one
      let tasks = p.tasks;
      if (ex.kind === "translate" && task.value) {
        tasks = { ...p.tasks };
        if (solved) delete tasks[ex.word.id];
        else tasks[ex.word.id] = { ...task.value, lang: p.settings.explainIn, mode: ex.assocMode };
      }
      let memory: Record<string, Memory> = { ...p.memory, [ex.word.id]: solved ? { ...mem, learned: true, assoc: assocOf(p.memory[ex.word.id]) } : { ...mem, assoc: assocOf(p.memory[ex.word.id]) } };
      if (solved) {
        // associability: AI exercises give +1 to the target and every partner word that really appears;
        // word-round exercises (article, plural, forms) can only lift a word from 0 to 1
        if (ex.kind === "translate" || ex.kind === "write") memory = bumpAssoc(memory, [ex.word.id, ...(extra.correction?.companionsUsed ?? [])]);
        else memory[ex.word.id] = atomicAssoc(memory[ex.word.id]);
      }
      // the sentence's grammar point gets the same grade, but only if the learner really used it (ADR 005: no phantom credit)
      if (ex.grammar && extra.correction?.grammarUsed) {
        memory[ex.grammar.id] = review(p.memory[ex.grammar.id] ?? newMemory(now), g, now, { maxIntervalDays: intervalCap(p, now) });
      }
      return { ...p, memory, daily, tasks };
    });
    if (verdict === "right") setRight((r) => r + 1);
    // a missed word comes back once later in this round (short-term practice)
    if (verdict !== "right" && !requeued.current.has(ex.word.id) && queue && mode !== "translate") {
      requeued.current.add(ex.word.id);
      setQueue([...queue, exerciseFor(ex.word, { ...mem, streak: 0 }, false)]);
    }
    setOutcome({ verdict, expected: ex.answer, next: nextIn(mem, now), grammarLabel: ex.grammar?.label, wordId: ex.word.id, wordLabel: targetLabel(ex.word), ...extra });
  };

  const answer = (given: string) => {
    if (!ex || outcome || !ex.answer) return;
    const v = check(given, ex.answer);
    if (ex.kind === "article") return grade(v, toGrade(v)); // three choices: no retry
    const tries = attempt.tries + 1;
    if (v === "right") return grade("right", tries === 1 ? Rating.Good : Rating.Hard, { tries });
    if (canRetry("typed", tries, attempt.startedAt, Date.now())) {
      setAttempt({ ...attempt, tries, lastVerdict: v, message: v === "close" ? "Almost: check the umlaut or ß." : "Not quite." });
      return;
    }
    grade(v, v === "close" ? Rating.Hard : Rating.Again, { tries });
  };

  /** End the exercise without a success: show the full answer and grade from the last try. */
  const giveUp = (note?: string) => {
    if (!ex || outcome) return;
    const g = finalGrade(null, attempt.lastVerdict);
    grade(g.verdict, g.grade, { correction: attempt.last, reference: task.value?.reference, tries: attempt.tries, note });
  };

  useEffect(() => {
    if (isAi && !outcome && attempt.tries > 0 && clock - attempt.startedAt >= AI_TIME_LIMIT_MS) giveUp("Time is up for this sentence.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);

  const submitAi = async (text: string) => {
    if (!ex || outcome || busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = ex.kind === "translate" && task.value ? await correctTranslation(ex.word, task.value, text, progress.settings, fetch, ex.grammar, ex.assocMode === "word" ? [] : ex.companions ?? []) : await correct(ex.word, text, progress.settings);
      const g = gradeCorrection(c, text);
      const tries = attempt.tries + 1;
      const missing = c.targetUsed ? undefined : ex.kind === "translate" ? `Use ${targetLabel(ex.word)} in your translation.` : `Your sentence does not use ${ex.word.word}.`;
      if (g.verdict === "right") {
        const f = finalGrade(tries);
        grade(f.verdict, f.grade, { correction: c, reference: task.value?.reference, tries });
      } else if (canRetry("ai", tries, attempt.startedAt, Date.now())) {
        setAttempt({ ...attempt, tries, last: c, lastVerdict: g.verdict, message: missing });
      } else {
        const f = finalGrade(null, g.verdict);
        grade(f.verdict, f.grade, { correction: c, reference: task.value?.reference, tries, note: missing });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** "Too easy": never ask this word again (only offered after a success). */
  const markEasy = () => {
    if (!outcome?.wordId) return;
    const id = outcome.wordId;
    update((p) => (p.memory[id] ? { ...p, memory: { ...p.memory, [id]: { ...p.memory[id], retired: true, learned: true } } } : p));
    advance();
  };

  const advance = () => {
    setOutcome(null);
    setError(null);
    setTask({ state: queue?.[index + 1]?.kind === "translate" ? "loading" : "idle" }); // no stale sentence under the next word
    setIndex((i) => i + 1);
  };

  if ((mode === "translate" || mode === "tutor") && !ready) {
    return (
      <section className="screen">
        <div className="panel panel--empty">
          <h1>Translation needs the AI tutor.</h1>
          <p>Add your OpenRouter key and a model id in Settings. The tutor builds the sentences and corrects your German.</p>
          <a className="btn btn--primary" href="#/settings">Open Settings</a>
        </div>
      </section>
    );
  }
  if (data.state === "loading" || (data.state === "ready" && queue === null)) {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading round">
        <div className="panel"><div className="skeleton skeleton--card" /></div>
      </section>
    );
  }
  if (data.state === "error") {
    return (
      <section className="screen">
        <div className="panel panel--error" role="alert">
          <h1>This round could not start.</h1>
          <p>{data.message}.</p>
          <button className="btn" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }
  if (!queue || queue.length === 0) {
    return (
      <section className="screen">
        <div className="panel panel--empty">
          <h1>Nothing to practise right now.</h1>
          <p>No words are due and no new ones are left at this level.</p>
          <button className="btn" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }
  if (!ex) {
    return (
      <section className="screen">
        <div className="panel round-end">
          <h1>Round done.</h1>
          <p className="round-end__score num">{right} right of {queue.length}</p>
          <p>Missed words come back sooner. See you at the next review.</p>
          <button className="btn btn--primary" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }

  const lang = progress.settings.explainIn;
  // hints sit above the answer box so they are seen before trying again
  const retryPanel = !outcome && attempt.tries > 0 && (
    <RetryPanel
      attempt={attempt}
      max={isAi ? AI_MAX_TRIES : TYPED_MAX_TRIES}
      left={isAi ? AI_TIME_LIMIT_MS - (Math.max(clock, Date.now()) - attempt.startedAt) : undefined}
      onGiveUp={() => giveUp()}
    />
  );
  const wordOnCard = ex.kind === "article" ? ex.word.word : ex.kind === "write" || ex.kind === "translate" ? targetLabel(ex.word) : ex.word.lemma;

  return (
    <section className="screen round" aria-labelledby="ex-prompt">
      <div className="round__bar">
        <progress max={queue.length} value={index}>{index} of {queue.length}</progress>
        <span className="num">{index + 1} / {queue.length}</span>
      </div>

      <div className="card">
        <p className="card__level">{ex.word.level}{ex.word.anchored ? "" : ", estimated level"}{ex.kind === "translate" ? ", use this word" : ""}</p>
        {ex.kind === "translate" ? (
          <>
            <div className="card__chips">
              <p className="card__target" lang="de">{wordOnCard}</p>
              {ex.companions && ex.companions.length > 0 && ex.assocMode !== "word" && (
                <p className="card__with" lang="de">with {ex.companions.map(targetLabel).join(" + ")}</p>
              )}
              {ex.grammar && <p className="card__grammar" lang="de">Grammatik: {ex.grammar.label}</p>}
            </div>
            <h1 id="ex-prompt" className="card__prompt">{prompts.translate(ex, lang)}</h1>
            {ex.assocMode === "word" && <p className="note">{lang === "Français" ? "Juste le mot, avec son article." : "Just the word, with its article."}</p>}
            {task.state === "loading" && <div className="source source--loading" aria-busy="true"><span className="skeleton skeleton--line" /><span>The tutor is writing a sentence…</span></div>}
            {task.state === "error" && (
              <div className="inline-error" role="alert">
                {task.message}
                <button className="btn btn--quiet" type="button" onClick={loadTask}>Try again</button>
                <button className="btn btn--quiet" type="button" onClick={advance}>Skip</button>
              </div>
            )}
            {task.state === "ready" && task.value && (
              <>
                {task.revived && attempt.tries === 0 && <p className="note">This one again: you did not solve it last time.</p>}
                <blockquote className="source" lang={lang === "Français" ? "fr" : "en"}>{task.value.source}</blockquote>
                {retryPanel}
                <SentenceAnswer key={`t${index}`} busy={busy} done={outcome !== null} onSubmit={submitAi} label="Your German" cta={attempt.tries ? "Check again" : "Check my German"} />
              </>
            )}
          </>
        ) : (
          <>
            <p className="card__word" lang="de">{wordOnCard}</p>
            <h1 id="ex-prompt" className="card__prompt">{prompts[ex.kind](ex, lang)}</h1>
            {ex.kind === "article" && <ArticleTiles key={`${index}`} expected={ex.answer!} done={outcome !== null} onPick={answer} />}
            {retryPanel}
            {(ex.kind === "plural" || ex.kind === "p3" || ex.kind === "pp") && (
              <TypedAnswer key={`${index}`} prefix={ex.kind === "plural" ? "die" : ex.kind === "p3" ? "er" : undefined} done={outcome !== null} onSubmit={answer} />
            )}
            {ex.kind === "write" && retryPanel}
            {ex.kind === "write" && <SentenceAnswer key={`${index}`} busy={busy} done={outcome !== null} onSubmit={submitAi} label="Your sentence" cta={attempt.tries ? "Check again" : "Correct my sentence"} />}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error} Nothing was graded. You can try again or skip.
            <button className="btn btn--quiet" type="button" onClick={advance}>Skip</button>
          </p>
        )}
      </div>

      {outcome && <Feedback outcome={outcome} onNext={advance} onEasy={markEasy} />}
    </section>
  );
}

function ArticleTiles({ expected, done, onPick }: { expected: string; done: boolean; onPick: (g: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = { "1": "der", "2": "die", "3": "das" }[e.key];
      if (g && !done) {
        setPicked(g);
        onPick(g);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onPick]);
  return (
    <div className="tiles" role="group" aria-label="Article" lang="de">
      {(["der", "die", "das"] as const).map((g) => {
        const state = done ? (g === expected ? "right" : g === picked ? "wrong" : "") : "";
        return (
          <button key={g} type="button" className="tile" data-state={state} disabled={done} onClick={() => { setPicked(g); onPick(g); }}>
            {g}
          </button>
        );
      })}
    </div>
  );
}

function TypedAnswer({ prefix, done, onSubmit }: { prefix?: string; done: boolean; onSubmit: (s: string) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form className="typed" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value); }}>
      <label className="typed__field">
        {prefix && <span className="typed__prefix" lang="de">{prefix}</span>}
        <span className="visually-hidden">Your answer</span>
        <input ref={ref} lang="de" value={value} onChange={(e) => setValue(e.target.value)} disabled={done} autoComplete="off" autoCapitalize="off" spellCheck={false} />
      </label>
      <button className="btn btn--primary" type="submit" disabled={done || !value.trim()}>Check</button>
    </form>
  );
}

function SentenceAnswer({ busy, done, onSubmit, label, cta }: { busy: boolean; done: boolean; onSubmit: (s: string) => void; label: string; cta: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form className="typed typed--sentence" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <label className="visually-hidden" htmlFor="sentence">{label}</label>
      <textarea ref={ref} id="sentence" lang="de" rows={3} value={value} onChange={(e) => setValue(e.target.value)} disabled={done || busy} spellCheck={false} />
      <button className="btn btn--primary" type="submit" disabled={done || busy || !value.trim()} aria-busy={busy}>
        {busy ? "The tutor is reading…" : cta}
      </button>
    </form>
  );
}

function Feedback({ outcome, onNext, onEasy }: { outcome: Outcome; onNext: () => void; onEasy: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const head = outcome.verdict === "right" ? "Richtig." : outcome.verdict === "close" ? (outcome.correction ? "Almost: one thing to fix." : "Almost: check the umlaut.") : "Not this time.";
  const c = outcome.correction;
  return (
    <div className="feedback" data-verdict={outcome.verdict} role="status">
      <p className="feedback__head">{head}</p>
      {outcome.tries !== undefined && outcome.tries > 1 && outcome.verdict !== "wrong" && <p className="note">Solved on try {outcome.tries}.</p>}
      {!c && outcome.verdict !== "right" && outcome.expected && <p>Answer: <strong lang="de">{outcome.expected}</strong></p>}
      {outcome.note && <p>{outcome.note}</p>}
      {c && (
        <div className="feedback__correction">
          {!c.isCorrect && <p lang="de"><strong>{c.corrected}</strong></p>}
          {c.errors.length > 0 && (
            <ul>
              {c.errors.map((e, i) => (
                <li key={i}><span lang="de">{e.wrong}</span> → <span lang="de">{e.fix}</span>: {e.why}</li>
              ))}
            </ul>
          )}
          {outcome.grammarLabel && (
            <p>
              Grammatik ({outcome.grammarLabel}):{" "}
              {c.grammarUsed ? "used correctly." : "not used correctly this time. It comes back in a later sentence."}
            </p>
          )}
          {outcome.reference && outcome.reference !== c.corrected && <p>Another good way: <span lang="de">{outcome.reference}</span></p>}
          <p className="feedback__ai">Sentence and correction by an AI model via OpenRouter. They can be wrong.</p>
        </div>
      )}
      <p className="feedback__next">Next review: {outcome.next}</p>
      <div className="feedback__actions">
        <button ref={btn} className="btn btn--primary" type="button" onClick={onNext}>Continue</button>
        {outcome.verdict === "right" && outcome.wordId && (
          <button className="btn" type="button" onClick={onEasy} title={`Never ask ${outcome.wordLabel} again`}>
            Too easy
          </button>
        )}
      </div>
      {outcome.verdict === "right" && outcome.wordLabel && <p className="note">Too easy skips <span lang="de">{outcome.wordLabel}</span> from now on. You can bring easy words back in Settings.</p>}
    </div>
  );
}

export function RetryPanel({ attempt, max, left, onGiveUp }: { attempt: Attempt; max: number; left?: number; onGiveUp: () => void }) {
  const errors = attempt.last?.errors ?? [];
  return (
    <div className="retry" role="status" aria-live="polite">
      <p className="retry__head">
        Not yet. Try {attempt.tries + 1} of {max}
        {left !== undefined && <span className="retry__time num">, {formatLeft(left)} left</span>}
      </p>
      {attempt.message && <p>{attempt.message}</p>}
      {errors.length > 0 && (
        <ul className="retry__hints">
          {errors.map((e, i) => (
            <li key={i}>
              {e.wrong && <><span className="retry__wrong" lang="de">{e.wrong}</span>: </>}
              {e.hint || "Look at this part again."}
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn--quiet" type="button" onClick={onGiveUp}>Show the answer</button>
    </div>
  );
}
