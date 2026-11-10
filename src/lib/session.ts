import { isDue } from "./srs";
import type { Exercise, ExerciseKind, Memory, Word } from "./types";

/** Which exercise fits this word at this streak. All deterministic kinds come from wordhoard forms. */
export function exerciseFor(word: Word, mem: Memory | undefined, tutorReady: boolean): Exercise {
  const streak = mem?.streak ?? 0;
  const kinds: ExerciseKind[] = [];
  if (word.pos === "NOUN") {
    kinds.push("article");
    if (word.plural) kinds.push("plural");
  } else {
    if (word.p3) kinds.push("p3");
    if (word.pp) kinds.push("pp");
  }
  // association mode (Nantia: streak >= 3 here, 5 in the CLI) -> write a sentence
  if (tutorReady && streak >= 3) kinds.push("write");
  const kind = kinds[streak % kinds.length] ?? "article";
  const answer =
    kind === "article" ? word.gender : kind === "plural" ? word.plural ?? undefined : kind === "p3" ? word.p3 ?? undefined : kind === "pp" ? word.pp ?? undefined : undefined;
  return { kind, word, answer };
}

/**
 * Build one round: due words first (oldest due first), then new words of the chosen level
 * in frequency order, never a word twice, never more than `size` items.
 */
export function buildRound(
  words: Word[],
  memory: Record<string, Memory>,
  now: Date,
  opts: { size: number; newMax: number; tutorReady: boolean },
): Exercise[] {
  const byId = new Map(words.map((w) => [w.id, w]));
  const due = Object.entries(memory)
    .filter(([id, m]) => byId.has(id) && isDue(m, now))
    .sort((a, b) => new Date(a[1].card.due).getTime() - new Date(b[1].card.due).getTime())
    .map(([id]) => byId.get(id)!);
  const fresh = words
    .filter((w) => !memory[w.id])
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(0, Math.min(opts.newMax, opts.size - due.length)));
  return [...due, ...fresh].slice(0, opts.size).map((w) => exerciseFor(w, memory[w.id], opts.tutorReady));
}

export function levelStats(words: Word[], memory: Record<string, Memory>, now: Date) {
  let learned = 0;
  let due = 0;
  for (const w of words) {
    const m = memory[w.id];
    if (!m) continue;
    if (m.card.state === 2 /* Review */) learned++;
    if (isDue(m, now)) due++;
  }
  return { total: words.length, learned, due, started: words.filter((w) => memory[w.id]).length };
}
