import { useEffect, useMemo, useRef, useState } from "react";
import { Rating, type Grade } from "ts-fsrs";
import { check, toGrade } from "../lib/check";
import { buildRound, exerciseFor } from "../lib/session";
import { newMemory, nextIn, review } from "../lib/srs";
import { correct, tutorReady, type Correction } from "../lib/tutor";
import type { Exercise, Memory, Progress, Verdict } from "../lib/types";
import { useLevel } from "./useLevel";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  onDone: () => void;
}

interface Outcome {
  verdict: Verdict;
  expected?: string;
  next: string;
  correction?: Correction;
  note?: string;
}

const prompts: Record<Exercise["kind"], (e: Exercise) => string> = {
  article: () => "Which article?",
  plural: (e) => `Plural of ${e.word.gender} ${e.word.word}`,
  p3: (e) => `er / sie / es … (${e.word.word})`,
  pp: (e) => `Partizip II of ${e.word.word}`,
  write: (e) => `Write a sentence with ${e.word.pos === "NOUN" ? `${e.word.gender} ${e.word.word}` : e.word.word}`,
};

export function Round({ progress, update, onDone }: Props) {
  const data = useLevel(progress.settings.level);
  const ready = tutorReady(progress.settings);
  const [queue, setQueue] = useState<Exercise[] | null>(null);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [right, setRight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requeued = useRef(new Set<string>());

  // build the round once, when the words arrive
  useEffect(() => {
    if (data.state === "ready" && queue === null) {
      setQueue(buildRound(data.words, progress.memory, new Date(), { size: 10, newMax: progress.settings.newPerRound, tutorReady: ready }));
    }
  }, [data, queue, progress.memory, progress.settings.newPerRound, ready]);

  const ex = queue?.[index];

  const grade = (verdict: Verdict, g: Grade, extra: Partial<Outcome> = {}) => {
    if (!ex) return;
    const now = new Date();
    const prev: Memory = progress.memory[ex.word.id] ?? newMemory(now);
    const mem = review(prev, g, now);
    update((p) => ({ ...p, memory: { ...p.memory, [ex.word.id]: mem } }));
    if (verdict === "right") setRight((r) => r + 1);
    // a missed word comes back once later in this round (short-term practice)
    if (verdict !== "right" && !requeued.current.has(ex.word.id) && queue) {
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

  const submitSentence = async (sentence: string) => {
    if (!ex || outcome || busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = await correct(ex.word, sentence, progress.settings);
      if (!c.targetUsed) {
        grade("wrong", Rating.Again, { correction: c, note: `Your sentence does not use ${ex.word.word}.` });
      } else if (c.isCorrect) {
        grade("right", Rating.Good, { correction: c });
      } else {
        grade(c.errors.length <= 1 ? "close" : "wrong", c.errors.length <= 1 ? Rating.Hard : Rating.Again, { correction: c });
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

  return (
    <section className="screen round" aria-labelledby="ex-prompt">
      <div className="round__bar">
        <progress max={queue.length} value={index}>{index} of {queue.length}</progress>
        <span className="num">{index + 1} / {queue.length}</span>
      </div>

      <div className="card">
        <p className="card__level">{ex.word.level}{ex.word.anchored ? "" : ", estimated level"}</p>
        <p className="card__word" lang="de">{ex.kind === "article" ? ex.word.word : ex.kind === "write" ? (ex.word.pos === "NOUN" ? `${ex.word.gender} ${ex.word.word}` : ex.word.word) : ex.word.lemma}</p>
        <h1 id="ex-prompt" className="card__prompt">{prompts[ex.kind](ex)}</h1>

        {ex.kind === "article" && <ArticleTiles key={`${index}`} expected={ex.answer!} done={outcome !== null} onPick={answer} />}
        {(ex.kind === "plural" || ex.kind === "p3" || ex.kind === "pp") && (
          <TypedAnswer key={`${index}`} prefix={ex.kind === "plural" ? "die" : ex.kind === "p3" ? "er" : undefined} done={outcome !== null} onSubmit={answer} />
        )}
        {ex.kind === "write" && <SentenceAnswer key={`${index}`} busy={busy} done={outcome !== null} onSubmit={submitSentence} />}
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

function SentenceAnswer({ busy, done, onSubmit }: { busy: boolean; done: boolean; onSubmit: (s: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form className="typed typed--sentence" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <label className="visually-hidden" htmlFor="sentence">Your sentence</label>
      <textarea id="sentence" lang="de" rows={3} value={value} onChange={(e) => setValue(e.target.value)} disabled={done || busy} />
      <button className="btn btn--primary" type="submit" disabled={done || busy || !value.trim()} aria-busy={busy}>
        {busy ? "The tutor is reading…" : "Correct my sentence"}
      </button>
    </form>
  );
}

function Feedback({ outcome, onNext }: { outcome: Outcome; onNext: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const head = outcome.verdict === "right" ? "Richtig." : outcome.verdict === "close" ? "Almost: check the umlaut." : "Not this time.";
  const c = outcome.correction;
  const body = useMemo(() => {
    if (c) return null;
    if (outcome.verdict === "right") return null;
    return outcome.expected;
  }, [c, outcome]);
  return (
    <div className="feedback" data-verdict={outcome.verdict} role="status">
      <p className="feedback__head">{head}</p>
      {body && <p>Answer: <strong lang="de">{body}</strong></p>}
      {outcome.note && <p>{outcome.note}</p>}
      {c && (
        <div className="feedback__correction">
          <p lang="de"><strong>{c.corrected}</strong></p>
          {c.errors.length > 0 && (
            <ul>
              {c.errors.map((e, i) => (
                <li key={i}><span lang="de">{e.wrong}</span> → <span lang="de">{e.fix}</span>: {e.why}</li>
              ))}
            </ul>
          )}
          <p className="feedback__ai">Correction by an AI model via OpenRouter. It can be wrong.</p>
        </div>
      )}
      <p className="feedback__next">Next review: {outcome.next}</p>
      <button ref={btn} className="btn btn--primary" type="button" onClick={onNext}>Continue</button>
    </div>
  );
}
