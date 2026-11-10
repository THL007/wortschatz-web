import { Rating, type Grade } from "ts-fsrs";
import type { Verdict } from "./types";

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

export const normalise = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^(der|die|das)\s+/i, "");

/**
 * Exact (case-insensitive) = right. Only an umlaut / ß slip = close. Anything else = wrong.
 */
export function check(given: string, expected: string): Verdict {
  const g = normalise(given);
  const e = normalise(expected);
  if (!g) return "wrong";
  if (g.toLowerCase() === e.toLowerCase()) return "right";
  if (fold(g) === fold(e)) return "close";
  return "wrong";
}

/** Nantia LONG-TERM-POLICY mapping: wrong -> Again, close -> Hard, right -> Good. */
export function toGrade(v: Verdict): Grade {
  if (v === "right") return Rating.Good;
  if (v === "close") return Rating.Hard;
  return Rating.Again;
}
