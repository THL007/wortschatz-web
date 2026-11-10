// Retry policy: learners may try again before the answer is shown.
import { Rating, type Grade } from "ts-fsrs";
import type { Verdict } from "./types";

export const AI_MAX_TRIES = 5; // translate / write / Grammatik: same exercise, up to 5 checks
export const AI_TIME_LIMIT_MS = 5 * 60_000; // ... within 5 minutes
export const TYPED_MAX_TRIES = 2; // plural / er-form / Partizip: one extra try

export type AttemptKind = "ai" | "typed";

/** May the learner try again after a miss? */
export function canRetry(kind: AttemptKind, triesUsed: number, startedAt: number, now: number): boolean {
  const max = kind === "ai" ? AI_MAX_TRIES : TYPED_MAX_TRIES;
  if (triesUsed >= max) return false;
  if (kind === "ai" && now - startedAt >= AI_TIME_LIMIT_MS) return false;
  return true;
}

/**
 * Final grade from the try on which the learner succeeded (null = never).
 * Follows the Nantia hint scale: more help -> lower grade, never a free pass.
 * - solved on try 1 or 2 -> Good
 * - solved on try 3+    -> Hard
 * - not solved, but the last answer was close (one small error) -> Hard
 * - not solved -> Again
 */
export function finalGrade(solvedOnTry: number | null, lastVerdict: Verdict = "wrong"): { verdict: Verdict; grade: Grade } {
  if (solvedOnTry === null) return lastVerdict === "close" ? { verdict: "close", grade: Rating.Hard } : { verdict: "wrong", grade: Rating.Again };
  // solved is solved (verdict right); the grade carries how much help it took
  return { verdict: "right", grade: solvedOnTry <= 2 ? Rating.Good : Rating.Hard };
}

export const formatLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
