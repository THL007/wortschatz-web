import type { DayLog, Plan } from "../lib/intensive";
import type { Level } from "../lib/types";

interface Props {
  plan: Plan | null;
  examDate: string;
  daysLeft: number;
  today: DayLog | undefined;
  level: Level;
  wordsLeft: number;
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long" });
};

/** Intensive mode status inside the tutor card: no separate exercise, just today's target. */
export function ExamStatus({ plan, examDate, daysLeft, today, level, wordsLeft }: Props) {
  if (!examDate) {
    return <p className="exam exam--note">Intensive mode is on. <a href="#/settings">Set your exam date</a> to get a daily goal.</p>;
  }
  if (!plan) {
    return <p className="exam exam--note">{daysLeft === 0 ? "Exam day. Viel Erfolg! Only a light review today." : "Your exam date has passed. Set a new one in Settings or turn intensive mode off."}</p>;
  }
  const done = Math.min(today?.new ?? 0, plan.newPerDay);
  return (
    <div className="exam" aria-label="Exam plan">
      <p className="exam__line">
        <span className="exam__days figure">{plan.daysLeft}</span> {plan.daysLeft === 1 ? "day" : "days"} to your exam ({fmt(examDate)})
      </p>
      {plan.reviewOnly ? (
        <p className="note">Review only now: no new words before the exam.</p>
      ) : (
        <>
          <p className="note">
            Today: {done} of {plan.newPerDay} new {level} words.{" "}
            {plan.feasible ? `That covers the ${wordsLeft} left in time.` : `Your time fits about ${plan.coverable} of the ${wordsLeft} left (estimate); the most important come first.`}
          </p>
          <div className="meter meter--thin" role="img" aria-label={`${done} of ${plan.newPerDay} new words today`}>
            <span style={{ inlineSize: `${(100 * done) / Math.max(1, plan.newPerDay)}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
