import type { DayLog, Plan } from "../lib/intensive";
import type { Level } from "../lib/types";

interface Props {
  plan: Plan | null;
  examDate: string;
  daysLeft: number;
  today: DayLog | undefined;
  level: Level;
  stats: { total: number; started: number; learned: number; due: number };
  onSprint: () => void;
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long" });
};

export function SprintPanel({ plan, examDate, daysLeft, today, level, stats, onSprint }: Props) {
  if (!examDate) {
    return (
      <div className="panel sprint sprint--empty">
        <h2>Intensive mode is on.</h2>
        <p>Set your exam date in Settings to get a daily plan.</p>
        <a className="btn" href="#/settings">Set exam date</a>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="panel sprint sprint--empty">
        <h2>{daysLeft === 0 ? "Exam day. Viel Erfolg!" : "Your exam date has passed."}</h2>
        <p>{daysLeft === 0 ? "No new words today. A short review round keeps them fresh." : "Set a new exam date in Settings, or turn intensive mode off."}</p>
      </div>
    );
  }
  const done = today?.new ?? 0;
  const goal = plan.newPerDay;
  const left = stats.total - stats.started;
  return (
    <div className="panel sprint" aria-labelledby="sprint-head">
      <div className="sprint__top">
        <p className="sprint__days"><span className="figure">{plan.daysLeft}</span> {plan.daysLeft === 1 ? "day" : "days"} to your exam</p>
        <p className="note">{fmt(examDate)}</p>
      </div>
      <h2 id="sprint-head">
        {plan.reviewOnly ? "Review only: no new words before the exam." : `Today: ${Math.min(done, goal)} of ${goal} new ${level} words`}
      </h2>
      {!plan.reviewOnly && (
        <div className="meter" role="img" aria-label={`${Math.min(done, goal)} of ${goal} new words today`}>
          <span style={{ inlineSize: `${(100 * Math.min(done, goal)) / Math.max(1, goal)}%` }} />
        </div>
      )}
      <p className="note">
        {left === 0
          ? `Every ${level} word is started. Sprints now review what is due.`
          : plan.feasible
            ? `${left} ${level} words left: ${goal} a day covers them by ${fmt(examDate)}, with the last days for review.`
            : `${left} ${level} words left, but your time fits about ${plan.coverable} (estimate). The most important ones come first.`}
        {" "}Reviews are kept before the exam date.
      </p>
      <button className="btn btn--primary btn--wide" type="button" onClick={onSprint}>
        {done >= goal || plan.reviewOnly ? `Review sprint (${stats.due} due)` : "Start sprint"}
      </button>
    </div>
  );
}
