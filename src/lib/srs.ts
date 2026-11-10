import { createEmptyCard, fsrs, generatorParameters, Rating, type Grade } from "ts-fsrs";
import type { Memory } from "./types";

// FSRS-6 default weights, fuzz off (Nantia LONG-TERM-POLICY).
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));
// Intensive mode caps intervals at the days left before the exam; one scheduler per cap.
const capped = new Map<number, ReturnType<typeof fsrs>>();
const schedulerFor = (maxIntervalDays?: number) => {
  if (!maxIntervalDays) return scheduler;
  if (!capped.has(maxIntervalDays)) capped.set(maxIntervalDays, fsrs(generatorParameters({ enable_fuzz: false, maximum_interval: maxIntervalDays })));
  return capped.get(maxIntervalDays)!;
};

export function newMemory(now: Date): Memory {
  return { card: createEmptyCard(now), streak: 0, seen: 0 };
}

/** Apply one graded review. Again/Hard reset the streak; Good/Easy extend it. */
export function review(mem: Memory, grade: Grade, now: Date, opts: { maxIntervalDays?: number } = {}): Memory {
  let { card } = schedulerFor(opts.maxIntervalDays).next(mem.card, now, grade);
  // hard guarantee for intensive mode: no review lands after the exam (ts-fsrs alone can exceed the cap)
  if (opts.maxIntervalDays) {
    const latest = now.getTime() + opts.maxIntervalDays * 86_400_000;
    if (new Date(card.due).getTime() > latest) card = { ...card, due: new Date(latest), scheduled_days: opts.maxIntervalDays };
  }
  const good = grade === Rating.Good || grade === Rating.Easy;
  return { card, streak: good ? mem.streak + 1 : 0, seen: mem.seen + 1 };
}

export const isDue = (mem: Memory, now: Date) => new Date(mem.card.due).getTime() <= now.getTime();

/** Human phrase for the next review time. */
export function nextIn(mem: Memory, now: Date): string {
  const ms = new Date(mem.card.due).getTime() - now.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "right away";
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "in 1 hour" : `in ${h} hours`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}
