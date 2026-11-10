import { useState } from "react";
import { buildRound, levelStats } from "../lib/session";
import { tutorReady } from "../lib/tutor";
import { nextIn } from "../lib/srs";
import { LEVELS, type Progress } from "../lib/types";
import { estimated, useLevel } from "./useLevel";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  onStart: () => void;
}

export function Today({ progress, update, onStart }: Props) {
  const { level, newPerRound } = progress.settings;
  const [attempt, setAttempt] = useState(0);
  const data = useLevel(level, attempt);
  const now = new Date();

  return (
    <section className="screen today" aria-labelledby="today-head">
      <h1 id="today-head">Today</h1>

      <div className="segmented" role="radiogroup" aria-label="Exam level">
        {LEVELS.map((lv) => (
          <button
            key={lv}
            type="button"
            role="radio"
            aria-checked={lv === level}
            className="seg"
            onClick={() => update((p) => ({ ...p, settings: { ...p.settings, level: lv } }))}
          >
            {lv}
          </button>
        ))}
      </div>
      {estimated(level) && <p className="note">{level} levels are estimated from word frequency, not from an official list.</p>}

      {data.state === "loading" && (
        <div className="panel" aria-busy="true">
          <div className="skeleton skeleton--figure" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--button" />
        </div>
      )}

      {data.state === "error" && (
        <div className="panel panel--error" role="alert">
          <h2>The {level} words did not load.</h2>
          <p>{data.message}. Check your connection, then try again.</p>
          <button className="btn" type="button" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      {data.state === "ready" && (() => {
        const s = levelStats(data.words, progress.memory, now);
        const round = buildRound(data.words, progress.memory, now, { size: 10, newMax: newPerRound, tutorReady: tutorReady(progress.settings) });
        const roundSize = round.length;
        const newCount = round.filter((e) => !progress.memory[e.word.id]).length;
        if (roundSize === 0) {
          const nextDue = data.words
            .map((w) => progress.memory[w.id])
            .filter(Boolean)
            .sort((a, b) => new Date(a.card.due).getTime() - new Date(b.card.due).getTime())[0];
          return (
            <div className="panel panel--empty">
              <h2>All caught up on {level}.</h2>
              <p>{nextDue ? `Your next review is ${nextIn(nextDue, now)}.` : "Every word of this level is in your reviews."} Pick another level to keep going.</p>
            </div>
          );
        }
        return (
          <div className="panel today__plan">
            <dl className="stats">
              <div><dt>Due now</dt><dd className="num">{s.due}</dd></div>
              <div><dt>New in this round</dt><dd className="num">{newCount}</dd></div>
              <div><dt>Learned in {level}</dt><dd className="num">{s.learned} <span>of {s.total}</span></dd></div>
            </dl>
            <div className="meter" role="img" aria-label={`${s.learned} of ${s.total} ${level} words learned`}>
              <span style={{ inlineSize: `${(100 * s.learned) / Math.max(1, s.total)}%` }} />
            </div>
            <button className="btn btn--primary btn--wide" type="button" onClick={onStart}>
              Start a round of {roundSize}
            </button>
          </div>
        );
      })()}
    </section>
  );
}
