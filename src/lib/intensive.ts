// Intensive mode (exam sprint): a daily plan from the exam date and the minutes a learner has.

export type Minutes = 15 | 30 | 60;

export interface IntensiveSettings {
  on: boolean;
  examDate: string; // YYYY-MM-DD (local)
  minutes: Minutes;
}

export interface DayLog {
  new: number;
  reviews: number;
}

/**
 * Throughput estimate (an assumption, shown to the learner as an estimate):
 * one new word takes about 1 minute in its first session; about a quarter of the time goes to reviews.
 */
export const NEW_WORDS_PER_MINUTE = 0.75;
/** The last days before the exam are for review only (no new words), when there is room. */
export const REVIEW_ONLY_DAYS = 2;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole days from today (local) until the exam day; 0 on exam day, negative after it. */
export function daysUntil(examDate: string, now: Date): number {
  const [y, m, d] = examDate.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  const exam = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exam - today) / 86_400_000);
}

export interface Plan {
  daysLeft: number;
  studyDays: number; // days that take new words
  capacityPerDay: number; // new words per day the minutes allow
  newPerDay: number; // new words per day to cover what is left (capped by capacity)
  coverable: number; // words that fit before the exam at this pace
  feasible: boolean; // remaining words fit
  reviewOnly: boolean; // today is in the final review-only stretch
}

export function makePlan(opts: { remaining: number; examDate: string; minutes: Minutes; now: Date }): Plan | null {
  const daysLeft = daysUntil(opts.examDate, opts.now);
  if (!Number.isFinite(daysLeft) || daysLeft < 1) return null; // no plan on or after exam day
  const reserve = daysLeft > REVIEW_ONLY_DAYS + 2 ? REVIEW_ONLY_DAYS : 0;
  const studyDays = Math.max(1, daysLeft - reserve);
  const reviewOnly = reserve > 0 && daysLeft <= reserve;
  const capacityPerDay = Math.max(1, Math.round(opts.minutes * NEW_WORDS_PER_MINUTE));
  const needed = Math.ceil(opts.remaining / studyDays);
  const newPerDay = reviewOnly ? 0 : Math.min(capacityPerDay, needed);
  const coverable = capacityPerDay * studyDays;
  return { daysLeft, studyDays, capacityPerDay, newPerDay, coverable, feasible: opts.remaining <= coverable, reviewOnly };
}

/** New words still allowed today: the daily goal minus what was already introduced today. */
export const newLeftToday = (plan: Plan, today: DayLog | undefined) => Math.max(0, plan.newPerDay - (today?.new ?? 0));

/** Reviews never get scheduled after the exam: cap the FSRS interval at the days left (at least 1). */
export const maxIntervalFor = (daysLeft: number) => Math.max(1, daysLeft);
