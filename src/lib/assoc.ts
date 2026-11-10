// Associability: how freely a word may be combined with other words in tutor exercises.
// a = 0 -> the word only with its article ("the night" -> "die Nacht")
// a = 1 -> a short phrase with one other word that has a >= 1 ("die kalte Nacht")
// a >= 2 -> a sentence, compound or genitive with 1-2 words that have a >= 2 ("Autobahn", "die Bahn des Autos")
// A passed exercise gives +1 to every word that really appears in the learner's correct answer.
import type { Memory, Word } from "./types";

export type AssocMode = "word" | "phrase" | "sentence";

export const assocOf = (m: Memory | undefined) => m?.assoc ?? 0;

export function modeFor(a: number): AssocMode {
  if (a <= 0) return "word";
  if (a === 1) return "phrase";
  return "sentence";
}

/** Minimum associability a partner word needs for this mode. */
export const companionMin = (mode: AssocMode) => (mode === "sentence" ? 2 : mode === "phrase" ? 1 : Infinity);
export const companionCount = (mode: AssocMode) => (mode === "sentence" ? 2 : mode === "phrase" ? 1 : 0);

/**
 * Partner words for a target: other words whose associability allows it, highest first, then by
 * frequency, rotated by `offset` so consecutive items use different partners. "Too easy" words may
 * still be partners (they are known), the target never.
 */
export function pickCompanions(target: Word, mode: AssocMode, words: Word[], memory: Record<string, Memory>, offset = 0): Word[] {
  const n = companionCount(mode);
  if (!n) return [];
  const min = companionMin(mode);
  const pool = words
    .filter((w) => w.id !== target.id && assocOf(memory[w.id]) >= min)
    .sort((a, b) => assocOf(memory[b.id]) - assocOf(memory[a.id]) || a.rank - b.rank);
  if (pool.length <= n) return pool;
  const start = (offset * n) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, n);
}

/** After a passed tutor exercise: +1 for the target and each partner that appears. */
export function bumpAssoc(memory: Record<string, Memory>, ids: string[]): Record<string, Memory> {
  const next = { ...memory };
  for (const id of ids) if (next[id]) next[id] = { ...next[id], assoc: assocOf(next[id]) + 1 };
  return next;
}

/** A passed word-round exercise (article, plural, forms) can lift a word from 0 to 1, not higher. */
export const atomicAssoc = (m: Memory) => ({ ...m, assoc: Math.max(assocOf(m), 1) });
