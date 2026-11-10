import { isDue } from "./srs";
import type { Exercise, ExerciseKind, GrammarTopic, Memory, Word } from "./types";
import { pickTopics } from "./grammar";

/** Which exercise fits this word at this streak. All deterministic kinds come from wordhoard forms. */
export function exerciseFor(word: Word, mem: Memory | undefined, tutorReady: boolean, translateFrom = 2): Exercise {
  const streak = mem?.streak ?? 0;
  const kinds: ExerciseKind[] = [];
  if (word.pos === "NOUN") {
    kinds.push("article");
    if (word.plural) kinds.push("plural");
  } else {
    if (word.p3) kinds.push("p3");
    if (word.pp) kinds.push("pp");
  }
  // AI exercises once the word is familiar: translate from your language (streak >= 2), then write freely (>= 3)
  if (tutorReady && streak >= translateFrom) kinds.push("translate");
  if (tutorReady && streak >= translateFrom + 1) kinds.push("write");
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
  opts: { size: number; newMax: number; tutorReady: boolean; examFirst?: boolean; translateFrom?: number },
): Exercise[] {
  const byId = new Map(words.map((w) => [w.id, w]));
  const due = Object.entries(memory)
    .filter(([id, m]) => byId.has(id) && isDue(m, now))
    .sort((a, b) => new Date(a[1].card.due).getTime() - new Date(b[1].card.due).getTime())
    .map(([id]) => byId.get(id)!);
  const fresh = words
    .filter((w) => !memory[w.id])
    // exam sprint: words calibrated on official lists (anchored) first, each group by frequency
    .sort((a, b) => (opts.examFirst ? Number(b.anchored) - Number(a.anchored) : 0) || a.rank - b.rank)
    .slice(0, Math.max(0, Math.min(opts.newMax, opts.size - due.length)));
  return [...due, ...fresh].slice(0, opts.size).map((w) => exerciseFor(w, memory[w.id], opts.tutorReady, opts.translateFrom));
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

/**
 * A translation round: words you have started come first (due ones oldest first), then new words
 * in frequency order. Every item is a "translate" exercise (AI-built sentence, AI-corrected answer).
 */
export function buildTranslateRound(words: Word[], memory: Record<string, Memory>, now: Date, opts: { size: number }): Exercise[] {
  const started = words.filter((w) => memory[w.id]);
  const due = started.filter((w) => isDue(memory[w.id], now)).sort((a, b) => new Date(memory[a.id].card.due).getTime() - new Date(memory[b.id].card.due).getTime());
  const rest = started.filter((w) => !isDue(memory[w.id], now)).sort((a, b) => a.rank - b.rank);
  const fresh = words.filter((w) => !memory[w.id]).sort((a, b) => a.rank - b.rank);
  return [...due, ...rest, ...fresh].slice(0, opts.size).map((word) => ({ kind: "translate" as const, word }));
}

/**
 * Tutor session (the main exercise): translation sentences, each also practising one grammar topic
 * of the level. Words: due first, then started, then new by frequency (buildTranslateRound).
 * Topics: due first, then unseen in teaching order (pickTopics), cycled over the sentences.
 */
export function buildTutorSession(
  words: Word[],
  topics: GrammarTopic[],
  memory: Record<string, Memory>,
  now: Date,
  opts: { size: number },
): Exercise[] {
  const items = buildTranslateRound(words, memory, now, { size: opts.size });
  const picked = pickTopics(topics, memory, now, Math.min(opts.size, topics.length));
  return items.map((e, i) => (picked.length ? { ...e, grammar: picked[i % picked.length] } : e));
}
