import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade } from "ts-fsrs";
import { check, gradeCorrection, toGrade } from "../lib/check";
import { buildRound, buildTranslateRound, exerciseFor } from "../lib/session";
import { newMemory, nextIn, review } from "../lib/srs";
import { correct, correctTranslation, generateTask, targetLabel, tutorReady, type Correction, type TranslationTask } from "../lib/tutor";
import type { Exercise, Memory, Progress, Verdict, Word } from "../lib/types";
import { useLevel } from "./useLevel";
import { currentPlan, intervalCap } from "./plan";
import { dayKey, newLeftToday } from "../lib/intensive";

export type RoundMode = "mixed" | "translate" | "sprint";

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
}

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
  const [task, setTask] = useState<{ state: "idle" | "loading" | "ready" | "error"; value?: TranslationTask; message?: string }>({ state: "idle" });
  const requeued = useRef(new Set<string>());

  // build the round once, when the words arrive
  useEffect(() => {
    if (data.state !== "ready" || queue !== null) return;
    const now = new Date();
    if (mode === "translate") {
      setQueue(buildTranslateRound(data.words, progress.memory, now, { size: 5 }));
    } else if (mode === "sprint") {
      // exam sprint: 20 items, today's remaining new-word goal, official-list words first, translation from streak 1
      const plan = currentPlan(progress, data.words, now);
      const newMax = plan ? Math.min(15, newLeftToday(plan, progress.daily?.[dayKey(now)])) : progress.settings.newPerRound;
      setQueue(buildRound(data.words, progress.memory, now, { size: 20, newMax, tutorReady: ready, examFirst: true, translateFrom: 1 }));
    } else {
      setQueue(buildRound(data.words, progress.memory, now, { size: 10, newMax: progress.settings.newPerRound, tutorReady: ready }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, queue, mode, ready]);

  const ex = queue?.[index];
  const known = data.state === "ready" ? knownLabels(data.words, progress.memory) : [];

  // translation: ask the AI for a sentence when the exercise appears
  const loadTask = useCallback(async () => {
    if (!ex || ex.kind !== "translate") return;
    setTask({ state: "loading" });
    try {
      setTask({ state: "ready", value: await generateTask(ex.word, known, progress.settings) });
    } catch (e) {
      setTask({ state: "error", message: (e as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.word.id, ex?.kind, index]);

  useEffect(() => {
    if (ex?.kind === "translate") loadTask();
    else setTask({ state: "idle" });
  }, [index, ex?.kind, loadTask]);

  const grade = (verdict: Verdict, g: Grade, extra: Partial<Outcome> = {}) => {
    if (!ex) return;
    const now = new Date();
    const isNew = !progress.memory[ex.word.id];
    const prev: Memory = progress.memory[ex.word.id] ?? newMemory(now);
    const mem = review(prev, g, now, { maxIntervalDays: intervalCap(progress, now) });
    const day = dayKey(now);
    update((p) => {
      const log = p.daily?.[day] ?? { new: 0, reviews: 0 };
      const daily = { ...p.daily, [day]: isNew ? { ...log, new: log.new + 1 } : { ...log, reviews: log.reviews + 1 } };
      return { ...p, memory: { ...p.memory, [ex.word.id]: mem }, daily };
    });
    if (verdict === "right") setRight((r) => r + 1);
    // a missed word comes back once later in this round (short-term practice)
    if (verdict !== "right" && !requeued.current.has(ex.word.id) && queue && mode !== "translate") {
      requeued.current.add(ex.word.id);
      setQueue([...queue, exerciseFor(ex.word, { ...mem, streak: 0 }, false)]);
    }
    setOutcome({ verdict, expected: ex.answer, next: nextIn(mem, now), ...extra });
  };

  const answer = (given: string) => {
    if (!ex || outcome || !ex.answer) return;
    const v = check(given, ex.answer);
    grade(v, toGrade(v));
  };

  const submitAi = async (text: string) => {
    if (!ex || outcome || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (ex.kind === "translate" && task.value) {
        const c = await correctTranslation(ex.word, task.value, text, progress.settings);
        const g = gradeCorrection(c, text);
        grade(g.verdict, g.grade, { correction: c, reference: task.value.reference, note: c.targetUsed ? undefined : `Use ${targetLabel(ex.word)} in your translation.` });
      } else {
        const c = await correct(ex.word, text, progress.settings);
        const g = gradeCorrection(c, text);
        grade(g.verdict, g.grade, { correction: c, note: c.targetUsed ? undefined : `Your sentence does not use ${ex.word.word}.` });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setOutcome(null);
    setError(null);
    setIndex((i) => i + 1);
  };

  if (mode === "translate" && !ready) {
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
            <p className="card__target" lang="de">{wordOnCard}</p>
            <h1 id="ex-prompt" className="card__prompt">{prompts.translate(ex, lang)}</h1>
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
                <blockquote className="source" lang={lang === "Français" ? "fr" : "en"}>{task.value.source}</blockquote>
                <SentenceAnswer key={`t${index}`} busy={busy} done={outcome !== null} onSubmit={submitAi} label="Your German" cta="Check my German" />
              </>
            )}
          </>
        ) : (
          <>
            <p className="card__word" lang="de">{wordOnCard}</p>
            <h1 id="ex-prompt" className="card__prompt">{prompts[ex.kind](ex, lang)}</h1>
            {ex.kind === "article" && <ArticleTiles key={`${index}`} expected={ex.answer!} done={outcome !== null} onPick={answer} />}
            {(ex.kind === "plural" || ex.kind === "p3" || ex.kind === "pp") && (
              <TypedAnswer key={`${index}`} prefix={ex.kind === "plural" ? "die" : ex.kind === "p3" ? "er" : undefined} done={outcome !== null} onSubmit={answer} />
            )}
            {ex.kind === "write" && <SentenceAnswer key={`${index}`} busy={busy} done={outcome !== null} onSubmit={submitAi} label="Your sentence" cta="Correct my sentence" />}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error} Nothing was graded. You can try again or skip.
            <button className="btn btn--quiet" type="button" onClick={advance}>Skip</button>
          </p>
        )}
      </div>

      {outcome && <Feedback outcome={outcome} onNext={advance} />}
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

function Feedback({ outcome, onNext }: { outcome: Outcome; onNext: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const head = outcome.verdict === "right" ? "Richtig." : outcome.verdict === "close" ? (outcome.correction ? "Almost: one thing to fix." : "Almost: check the umlaut.") : "Not this time.";
  const c = outcome.correction;
  return (
    <div className="feedback" data-verdict={outcome.verdict} role="status">
      <p className="feedback__head">{head}</p>
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
          {outcome.reference && outcome.reference !== c.corrected && <p>Another good way: <span lang="de">{outcome.reference}</span></p>}
          <p className="feedback__ai">Sentence and correction by an AI model via OpenRouter. They can be wrong.</p>
        </div>
      )}
      <p className="feedback__next">Next review: {outcome.next}</p>
      <button ref={btn} className="btn btn--primary" type="button" onClick={onNext}>Continue</button>
    </div>
  );
}
