import { useEffect, useState } from "react";
import { buildRound, levelStats } from "../lib/session";
import { tutorReady } from "../lib/tutor";
import { nextIn } from "../lib/srs";
import { loadGrammar, pickTopics, topicsFor } from "../lib/grammar";
import { LEVELS, type GrammarTopic, type Progress } from "../lib/types";
import { estimated, useLevel } from "./useLevel";
import { currentPlan } from "./plan";
import { dayKey, daysUntil } from "../lib/intensive";
import { SprintPanel } from "./SprintPanel";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  onStart: () => void; // word round (extra)
  onTutor: () => void; // tutor session (main)
  onGrammar: () => void; // Grammatik round (extra)
  onSprint: () => void;
}

export function Today({ progress, update, onStart, onTutor, onGrammar, onSprint }: Props) {
  const { level, newPerRound } = progress.settings;
  const [attempt, setAttempt] = useState(0);
  const data = useLevel(level, attempt);
  const now = new Date();
  const [keyDraft, setKeyDraft] = useState("");
  const ready = tutorReady(progress.settings);
  const [topics, setTopics] = useState<GrammarTopic[]>([]);

  useEffect(() => {
    loadGrammar()
      .then((all) => setTopics(topicsFor(all, level)))
      .catch(() => setTopics([]));
  }, [level]);

  const grammarDone = topics.filter((t) => progress.memory[t.id]?.card.state === 2).length;
  const nextTopic = pickTopics(topics, progress.memory, now, 1)[0];

  return (
    <section className="screen today" aria-labelledby="today-head">
      <h1 id="today-head">Today</h1>

      <div className="segmented" role="radiogroup" aria-label="Exam level">
        {LEVELS.map((lv) => (
          <button key={lv} type="button" role="radio" aria-checked={lv === level} className="seg" onClick={() => update((p) => ({ ...p, settings: { ...p.settings, level: lv } }))}>
            {lv}
          </button>
        ))}
      </div>
      {estimated(level) && <p className="note">{level} word levels are estimated from frequency, not from an official list.</p>}

      {/* main: the tutor */}
      <div className="panel tutor-main" aria-labelledby="tutor-head">
        <h2 id="tutor-head">Tutor session</h2>
        <p>
          Translate 6 sentences from {progress.settings.explainIn} into German. Each one practises one {level} word
          {topics.length > 0 && <> and a Grammatik topic{nextTopic && <>, starting with <strong lang="de">{nextTopic.label}</strong></>}</>}. The tutor corrects you and gives hints until you get it.
        </p>
        {ready ? (
          <button className="btn btn--primary btn--wide" type="button" onClick={onTutor}>Start tutor session</button>
        ) : (
          <form
            className="keybox"
            onSubmit={(e) => {
              e.preventDefault();
              const k = keyDraft.trim();
              if (k) update((p) => ({ ...p, settings: { ...p.settings, openRouterKey: k } }));
            }}
          >
            <p className="note">Paste your OpenRouter key once to turn the tutor on. It stays on this device.</p>
            <div className="keybox__row">
              <label className="field keybox__field">
                <span className="visually-hidden">OpenRouter API key</span>
                <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-or-…" autoComplete="off" spellCheck={false} />
              </label>
              <button className="btn btn--primary" type="submit" disabled={!keyDraft.trim()}>Save</button>
            </div>
          </form>
        )}
      </div>

      {data.state === "ready" && progress.settings.intensive.on && (
        <SprintPanel
          plan={currentPlan(progress, data.words, now)}
          examDate={progress.settings.intensive.examDate}
          daysLeft={progress.settings.intensive.examDate ? daysUntil(progress.settings.intensive.examDate, now) : NaN}
          today={progress.daily?.[dayKey(now)]}
          level={level}
          stats={levelStats(data.words, progress.memory, now)}
          onSprint={onSprint}
        />
      )}

      {/* extras: word and grammar rounds */}
      <h2 className="today__aux-head">Also practise</h2>
      <div className="aux">
        {data.state === "loading" && (
          <div className="panel aux__card" aria-busy="true">
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--button" />
          </div>
        )}
        {data.state === "error" && (
          <div className="panel panel--error aux__card" role="alert">
            <h3>The {level} words did not load.</h3>
            <p>{data.message}.</p>
            <button className="btn" type="button" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </div>
        )}
        {data.state === "ready" && (() => {
          const s = levelStats(data.words, progress.memory, now);
          const round = buildRound(data.words, progress.memory, now, { size: 10, newMax: newPerRound, tutorReady: ready });
          if (round.length === 0) {
            const nextDue = data.words.map((w) => progress.memory[w.id]).filter(Boolean).sort((a, b) => +new Date(a.card.due) - +new Date(b.card.due))[0];
            return (
              <div className="panel panel--empty aux__card">
                <h3>Words: all caught up</h3>
                <p>{nextDue ? `Next review ${nextIn(nextDue, now)}.` : "Every word of this level is in your reviews."}</p>
              </div>
            );
          }
          return (
            <div className="panel aux__card">
              <h3>Word round</h3>
              <p className="note">{s.due} due, {s.learned} of {s.total} {level} words learned</p>
              <div className="meter meter--thin" role="img" aria-label={`${s.learned} of ${s.total} ${level} words learned`}>
                <span style={{ inlineSize: `${(100 * s.learned) / Math.max(1, s.total)}%` }} />
              </div>
              <button className="btn" type="button" onClick={onStart}>Start {round.length} words</button>
            </div>
          );
        })()}
        <div className="panel aux__card">
          <h3>Grammatik</h3>
          <p className="note">
            {topics.length ? `${grammarDone} of ${topics.length} ${level} topics learned${nextTopic ? `, next: ${nextTopic.label}` : ""}` : "Loading topics…"}
          </p>
          <div className="meter meter--thin" role="img" aria-label={`${grammarDone} of ${topics.length} ${level} grammar topics learned`}>
            <span style={{ inlineSize: `${(100 * grammarDone) / Math.max(1, topics.length)}%` }} />
          </div>
          <button className="btn" type="button" onClick={onGrammar} disabled={!ready || topics.length === 0}>5 exercises</button>
          {!ready && <p className="note">Needs the tutor key.</p>}
        </div>
      </div>
    </section>
  );
}
