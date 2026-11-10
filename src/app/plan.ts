import { dayKey, daysUntil, makePlan, maxIntervalFor, newLeftToday, type Plan } from "../lib/intensive";
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

/** How big today's rounds are and how many new words they may bring in. */
export interface SessionLoad {
  tutorSize: number;
  tutorNewMax?: number; // undefined = no daily cap (normal mode)
  wordSize: number;
  wordNewMax: number;
  grammarSize: number;
  newFirst: boolean; // intensive: new words before not-yet-due reviews
  examFirst: boolean; // intensive: official-list words first
  translateFrom: number; // streak at which translation enters word rounds
  plan: Plan | null;
}

const BY_MINUTES = { 15: { tutor: 8, word: 15, grammar: 6 }, 30: { tutor: 10, word: 20, grammar: 8 }, 60: { tutor: 12, word: 25, grammar: 10 } } as const;

/**
 * Intensive mode does not add a separate exercise: it scales the normal rounds.
 * Tutor session and word round share today's new-word goal (the daily log counts both).
 */
export function sessionLoad(progress: Progress, words: Word[], now: Date): SessionLoad {
  const normal: SessionLoad = { tutorSize: 6, wordSize: 10, wordNewMax: progress.settings.newPerRound, grammarSize: 5, newFirst: false, examFirst: false, translateFrom: 2, plan: null };
  const plan = currentPlan(progress, words, now);
  if (!plan) return normal;
  const size = BY_MINUTES[progress.settings.intensive.minutes] ?? BY_MINUTES[30];
  const left = plan.reviewOnly ? 0 : newLeftToday(plan, progress.daily?.[dayKey(now)]);
  return {
    tutorSize: size.tutor,
    tutorNewMax: Math.min(left, size.tutor),
    wordSize: size.word,
    wordNewMax: Math.min(left, size.word),
    grammarSize: size.grammar,
    newFirst: true,
    examFirst: true,
    translateFrom: 1,
    plan,
  };
}
