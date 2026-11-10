import { useCallback, useEffect, useRef, useState } from "react";
import { AI_MAX_TRIES, AI_TIME_LIMIT_MS, canRetry, finalGrade } from "../lib/attempts";
import { gradeCorrection } from "../lib/check";
import { checkDrill, generateDrill, loadGrammar, pickTopics, topicsFor, type Drill } from "../lib/grammar";
import { dayKey } from "../lib/intensive";
import { newMemory, nextIn, review } from "../lib/srs";
import { tutorReady, type Correction } from "../lib/tutor";
import type { GrammarTopic, Progress, Verdict } from "../lib/types";
import { intervalCap, sessionLoad } from "./plan";
import { loadLevel } from "../lib/store";
import { RetryPanel, freshAttempt, type Attempt } from "./Round";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  onDone: () => void;
}

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; topics: GrammarTopic[] };
interface Done { verdict: Verdict; correction?: Correction; next: string; tries: number }

export function GrammarRound({ progress, update, onDone }: Props) {
  const s = progress.settings;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [index, setIndex] = useState(0);
  const [drill, setDrill] = useState<{ state: "loading" | "ready" | "error"; value?: Drill; message?: string; revived?: boolean }>({ state: "loading" });
  const [attempt, setAttempt] = useState<Attempt>(freshAttempt);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [right, setRight] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadGrammar()
      .then(async (all) => {
        const now = new Date();
        const size = sessionLoad(progress, await loadLevel(s.level).catch(() => []), now).grammarSize; // intensive: more exercises
        setLoad({ state: "ready", topics: pickTopics(topicsFor(all, s.level), progress.memory, now, size) });
      })
      .catch((e: Error) => setLoad({ state: "error", message: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topic = load.state === "ready" ? load.topics[index] : undefined;

  const loadDrill = useCallback(async () => {
    if (!topic) return;
    setValue("");
    setError(null);
    const saved = progress.drills?.[topic.id];
    if (saved && saved.lang === s.explainIn) {
      setDrill({ state: "ready", value: saved, revived: true });
      setAttempt(freshAttempt());
      return;
    }
    setDrill({ state: "loading" });
    try {
      setDrill({ state: "ready", value: await generateDrill(topic, s) });
      setAttempt(freshAttempt());
    } catch (e) {
      setDrill({ state: "error", message: (e as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id]);

  useEffect(() => {
    if (topic) loadDrill();
  }, [topic, loadDrill]);

  useEffect(() => {
    if (drill.state === "ready" && !done) input.current?.focus();
  }, [drill.state, done]);

  useEffect(() => {
    if (done || drill.state !== "ready") return;
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [done, drill.state, index]);

  const finish = (verdict: Verdict, grade: Parameters<typeof review>[1], correction: Correction | undefined, tries: number) => {
    if (!topic || !drill.value) return;
    const now = new Date();
    const mem = review(progress.memory[topic.id] ?? newMemory(now), grade, now, { maxIntervalDays: intervalCap(progress, now) });
    const solved = verdict === "right";
    const day = dayKey(now);
    update((p) => {
      const drills = { ...p.drills };
      if (solved) delete drills[topic.id];
      else drills[topic.id] = { ...drill.value!, lang: p.settings.explainIn };
      const log = p.daily?.[day] ?? { new: 0, reviews: 0 };
      return { ...p, memory: { ...p.memory, [topic.id]: mem }, drills, daily: { ...p.daily, [day]: { ...log, reviews: log.reviews + 1 } } };
    });
    if (solved) setRight((r) => r + 1);
    setDone({ verdict, correction, next: nextIn(mem, now), tries });
  };

  const giveUp = (note?: string) => {
    const f = finalGrade(null, attempt.lastVerdict);
    finish(f.verdict, f.grade, attempt.last ?? (drill.value ? { isCorrect: false, corrected: drill.value.answer, targetUsed: true, errors: [] } : undefined), attempt.tries);
    if (note) setError(note);
  };

  useEffect(() => {
    if (!done && attempt.tries > 0 && clock - attempt.startedAt >= AI_TIME_LIMIT_MS) giveUp("Time is up for this exercise.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);

  const submit = async () => {
    if (!topic || !drill.value || done || busy || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const c = await checkDrill(topic, drill.value, value.trim(), s);
      const g = gradeCorrection(c, value.trim());
      const tries = attempt.tries + 1;
      if (g.verdict === "right") {
        const f = finalGrade(tries);
        finish(f.verdict, f.grade, c, tries);
      } else if (canRetry("ai", tries, attempt.startedAt, Date.now())) {
        setAttempt({ ...attempt, tries, last: c, lastVerdict: g.verdict });
      } else {
        const f = finalGrade(null, g.verdict);
        finish(f.verdict, f.grade, c, tries);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setDone(null);
    setError(null);
    setValue("");
    setDrill({ state: "loading" }); // never show the previous exercise under the next topic
    setIndex((i) => i + 1);
  };

  if (!tutorReady(s)) {
    return (
      <section className="screen">
        <div className="panel panel--empty">
          <h1>Grammatik needs the AI tutor.</h1>
          <p>Add your OpenRouter key on Today or in Settings. The tutor writes the exercises and checks your answers.</p>
          <a className="btn btn--primary" href="#/">Back to Today</a>
        </div>
      </section>
    );
  }
  if (load.state === "loading") {
    return <section className="screen" aria-busy="true" aria-label="Loading grammar"><div className="panel"><div className="skeleton skeleton--card" /></div></section>;
  }
  if (load.state === "error") {
    return (
      <section className="screen">
        <div className="panel panel--error" role="alert">
          <h1>The grammar topics did not load.</h1>
          <p>{load.message}. Check your connection, then try again.</p>
          <button className="btn" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }
  if (load.topics.length === 0) {
    return (
      <section className="screen">
        <div className="panel panel--empty">
          <h1>No grammar topics for {s.level}.</h1>
          <p>Pick another level on Today.</p>
          <button className="btn" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }
  if (!topic) {
    return (
      <section className="screen">
        <div className="panel round-end">
          <h1>Grammatik done.</h1>
          <p className="round-end__score num">{right} right of {load.topics.length}</p>
          <p>Topics you missed come back sooner.</p>
          <button className="btn btn--primary" type="button" onClick={onDone}>Back to Today</button>
        </div>
      </section>
    );
  }

  const left = AI_TIME_LIMIT_MS - (Math.max(clock, Date.now()) - attempt.startedAt);
  return (
    <section className="screen round" aria-labelledby="g-prompt">
      <div className="round__bar">
        <progress max={load.topics.length} value={index}>{index} of {load.topics.length}</progress>
        <span className="num">{index + 1} / {load.topics.length}</span>
      </div>
      <div className="card">
        <p className="card__level">{topic.level} Grammatik</p>
        <p className="card__grammar card__grammar--title" lang="de">{topic.label}</p>
        {drill.state === "loading" && <div className="source source--loading" aria-busy="true"><span className="skeleton skeleton--line" /><span>The tutor is writing an exercise…</span></div>}
        {drill.state === "error" && (
          <div className="inline-error" role="alert">
            {drill.message}
            <button className="btn btn--quiet" type="button" onClick={loadDrill}>Try again</button>
            <button className="btn btn--quiet" type="button" onClick={next}>Skip</button>
          </div>
        )}
        {drill.state === "ready" && drill.value && (
          <>
            {drill.revived && attempt.tries === 0 && <p className="note">This one again: you did not solve it last time.</p>}
            <h1 id="g-prompt" className="card__prompt">{drill.value.instruction}</h1>
            <blockquote className="source source--drill" lang="de">{drill.value.prompt}</blockquote>
            {!done && attempt.tries > 0 && <RetryPanel attempt={attempt} max={AI_MAX_TRIES} left={left} onGiveUp={() => giveUp()} />}
            <form className="typed" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <label className="typed__field">
                <span className="visually-hidden">Your answer</span>
                <input ref={input} lang="de" value={value} onChange={(e) => setValue(e.target.value)} disabled={!!done || busy} autoComplete="off" autoCapitalize="off" spellCheck={false} />
              </label>
              <button className="btn btn--primary" type="submit" disabled={!!done || busy || !value.trim()} aria-busy={busy}>
                {busy ? "Checking…" : attempt.tries ? "Check again" : "Check"}
              </button>
            </form>
          </>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      {done && (
        <div className="feedback" data-verdict={done.verdict} role="status">
          <p className="feedback__head">{done.verdict === "right" ? "Richtig." : done.verdict === "close" ? "Almost." : "Not this time."}</p>
          {done.tries > 1 && done.verdict === "right" && <p className="note">Solved on try {done.tries}.</p>}
          {done.verdict !== "right" && drill.value && <p>Answer: <strong lang="de">{done.correction?.corrected || drill.value.answer}</strong></p>}
          {done.correction && done.correction.errors.length > 0 && done.verdict !== "right" && (
            <ul className="feedback__list">
              {done.correction.errors.map((e, i) => (
                <li key={i}><span lang="de">{e.wrong}</span> → <span lang="de">{e.fix}</span>: {e.why}</li>
              ))}
            </ul>
          )}
          <p className="feedback__ai">Exercise and check by an AI model via OpenRouter. They can be wrong.</p>
          <p className="feedback__next">Next time for {topic.label}: {done.next}</p>
          <button className="btn btn--primary" type="button" onClick={next} autoFocus>Continue</button>
        </div>
      )}
    </section>
  );
}
