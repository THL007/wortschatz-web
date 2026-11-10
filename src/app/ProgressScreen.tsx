import { useEffect, useState } from "react";
import { levelStats } from "../lib/session";
import { loadLevel } from "../lib/store";
import { LEVELS, type Level, type Progress } from "../lib/types";
import { estimated } from "./useLevel";
import { loadGrammar } from "../lib/grammar";
import type { GrammarTopic } from "../lib/types";

type Row = { level: Level; total: number; started: number; learned: number; due: number };
type State = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rows: Row[] };

export function ProgressScreen({ progress }: { progress: Progress }) {
  const [res, setRes] = useState<State>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setRes({ state: "loading" });
    const now = new Date();
    Promise.all(LEVELS.map(async (level) => ({ level, ...levelStats(await loadLevel(level), progress.memory, now) })))
      .then((rows) => alive && setRes({ state: "ready", rows }))
      .catch((e: Error) => alive && setRes({ state: "error", message: e.message }));
    return () => {
      alive = false;
    };
  }, [progress.memory, attempt]);

  const anyStarted = res.state === "ready" && res.rows.some((r) => r.started > 0);

  return (
    <section className="screen" aria-labelledby="progress-head">
      <h1 id="progress-head">Progress</h1>
      {res.state === "loading" && (
        <div className="panel" aria-busy="true">
          {LEVELS.map((l) => <div key={l} className="skeleton skeleton--line" />)}
        </div>
      )}
      {res.state === "error" && (
        <div className="panel panel--error" role="alert">
          <h2>Your progress could not be counted.</h2>
          <p>{res.message}. Your answers are safe on this device.</p>
          <button className="btn" type="button" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      )}
      {res.state === "ready" && !anyStarted && (
        <div className="panel panel--empty">
          <h2>No words practised yet.</h2>
          <p>Your first round fills this table, one level at a time.</p>
          <a className="btn btn--primary" href="#/">Go to Today</a>
        </div>
      )}
      {res.state === "ready" && anyStarted && (
        <div className="panel panel--flush">
          <table className="table">
            <thead>
              <tr><th scope="col">Level</th><th scope="col" className="num">Learned</th><th scope="col" className="num">Started</th><th scope="col" className="num">Due</th><th scope="col">Of all words</th></tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.level}>
                  <th scope="row">{r.level}{estimated(r.level) && <span className="tag">estimated</span>}</th>
                  <td className="num">{r.learned}</td>
                  <td className="num">{r.started}</td>
                  <td className="num">{r.due}</td>
                  <td>
                    <div className="meter meter--thin" role="img" aria-label={`${r.learned} of ${r.total} learned`}>
                      <span style={{ inlineSize: `${(100 * r.learned) / Math.max(1, r.total)}%` }} />
                    </div>
                    <span className="table__total num">{r.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Learned means the word has left short-term practice and is on spaced reviews.</p>
        </div>
      )}
      <GrammarProgress progress={progress} />
    </section>
  );
}

function GrammarProgress({ progress }: { progress: Progress }) {
  const [topics, setTopics] = useState<GrammarTopic[] | null>(null);
  useEffect(() => {
    loadGrammar().then(setTopics).catch(() => setTopics([]));
  }, []);
  if (!topics || topics.length === 0) return null;
  const now = new Date();
  const rows = LEVELS.map((level) => {
    const ts = topics.filter((t) => t.level === level);
    const mem = ts.map((t) => progress.memory[t.id]).filter(Boolean);
    return { level, total: ts.length, started: mem.length, learned: mem.filter((m) => m.card.state === 2).length, due: mem.filter((m) => new Date(m.card.due) <= now).length };
  });
  if (rows.every((r) => r.started === 0)) return null;
  return (
    <div className="panel panel--flush">
      <table className="table">
        <caption className="table__caption">Grammatik</caption>
        <thead>
          <tr><th scope="col">Level</th><th scope="col" className="num">Learned</th><th scope="col" className="num">Started</th><th scope="col" className="num">Due</th><th scope="col">Of all topics</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.level}>
              <th scope="row">{r.level}</th>
              <td className="num">{r.learned}</td>
              <td className="num">{r.started}</td>
              <td className="num">{r.due}</td>
              <td>
                <div className="meter meter--thin" role="img" aria-label={`${r.learned} of ${r.total} topics learned`}>
                  <span style={{ inlineSize: `${(100 * r.learned) / Math.max(1, r.total)}%` }} />
                </div>
                <span className="table__total num">{r.total}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
