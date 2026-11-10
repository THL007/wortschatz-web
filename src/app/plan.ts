import { dayKey, daysUntil, makePlan, maxIntervalFor, type Plan } from "../lib/intensive";
import type { Progress, Word } from "../lib/types";

/** The intensive plan for the current level, or null when intensive mode is off or the exam date is past. */
export function currentPlan(progress: Progress, words: Word[], now: Date): Plan | null {
  const it = progress.settings.intensive;
  if (!it.on || !it.examDate) return null;
  // count from the start of today, so the daily goal does not shrink while you study
  const introducedToday = progress.daily?.[dayKey(now)]?.new ?? 0;
  const remaining = words.filter((w) => !progress.memory[w.id]).length + introducedToday;
  return makePlan({ remaining, examDate: it.examDate, minutes: it.minutes, now });
}

/** Interval cap for reviews while intensive mode runs (undefined = normal FSRS). */
export function intervalCap(progress: Progress, now: Date): number | undefined {
  const it = progress.settings.intensive;
  if (!it.on || !it.examDate) return undefined;
  const d = daysUntil(it.examDate, now);
  return Number.isFinite(d) && d >= 1 ? maxIntervalFor(d) : undefined;
}
