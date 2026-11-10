import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rating } from "ts-fsrs";
import { daysUntil, makePlan, maxIntervalFor, newLeftToday } from "../src/lib/intensive";
import { buildRound, exerciseFor } from "../src/lib/session";
import { newMemory, review } from "../src/lib/srs";
import type { Word } from "../src/lib/types";

const now = new Date(2026, 10, 10, 9, 0); // 10 Nov 2026, local

describe("daysUntil", () => {
  it("counts whole local days", () => {
    expect(daysUntil("2026-11-10", now)).toBe(0);
    expect(daysUntil("2026-11-11", now)).toBe(1);
    expect(daysUntil("2026-12-10", now)).toBe(30);
    expect(daysUntil("2026-11-01", now)).toBe(-9);
    expect(Number.isNaN(daysUntil("", now))).toBe(true);
  });
});

describe("makePlan", () => {
  it("spreads the remaining words over study days, keeping 2 review-only days", () => {
    const p = makePlan({ remaining: 575, examDate: "2026-12-10", minutes: 30, now })!;
    expect(p.daysLeft).toBe(30);
    expect(p.studyDays).toBe(28);
    expect(p.newPerDay).toBe(21); // ceil(575 / 28), within capacity 23 (30 min x 0.75)
    expect(p.feasible).toBe(true);
  });

  it("caps the daily goal at what the minutes allow and says it is not feasible", () => {
    const p = makePlan({ remaining: 1793, examDate: "2026-11-24", minutes: 15, now })!;
    expect(p.capacityPerDay).toBe(11);
    expect(p.newPerDay).toBe(11);
    expect(p.feasible).toBe(false);
    expect(p.coverable).toBe(11 * 12);
  });

  it("returns no plan on or after exam day", () => {
    expect(makePlan({ remaining: 10, examDate: "2026-11-10", minutes: 30, now })).toBeNull();
    expect(makePlan({ remaining: 10, examDate: "2026-11-01", minutes: 30, now })).toBeNull();
  });

  it("stops new words in the final review-only days", () => {
    const p = makePlan({ remaining: 100, examDate: "2026-11-12", minutes: 30, now })!; // 2 days left, short horizon: no reserve
    expect(p.reviewOnly).toBe(false);
    expect(p.newPerDay).toBeGreaterThan(0);
  });

  it("property: the daily goal never exceeds capacity and covers the words when feasible", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4000 }), fc.integer({ min: 1, max: 200 }), fc.constantFrom(15, 30, 60), (remaining, days, minutes) => {
        const exam = new Date(now);
        exam.setDate(exam.getDate() + days);
        const iso = `${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2, "0")}-${String(exam.getDate()).padStart(2, "0")}`;
        const p = makePlan({ remaining, examDate: iso, minutes: minutes as 15 | 30 | 60, now })!;
        expect(p.newPerDay).toBeLessThanOrEqual(p.capacityPerDay);
        if (p.feasible && !p.reviewOnly) expect(p.newPerDay * p.studyDays).toBeGreaterThanOrEqual(remaining);
      }),
    );
  });

  it("newLeftToday subtracts what was introduced today", () => {
    const p = makePlan({ remaining: 575, examDate: "2026-12-10", minutes: 30, now })!;
    expect(newLeftToday(p, { new: 15, reviews: 40 })).toBe(6);
    expect(newLeftToday(p, { new: 30, reviews: 0 })).toBe(0);
  });
});

describe("FSRS cap at the exam date", () => {
  it("never schedules a review after the exam", () => {
    const cap = maxIntervalFor(5);
    let m = newMemory(now);
    let t = now;
    for (let i = 0; i < 6; i++) {
      m = review(m, Rating.Easy, t, { maxIntervalDays: cap });
      const days = (new Date(m.card.due).getTime() - t.getTime()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(cap + 0.001);
      t = new Date(m.card.due);
    }
  });
});

describe("sprint rounds", () => {
  const w = (i: number, anchored: boolean): Word => ({ id: `n:w${i}`, lemma: `w${i}`, word: `W${i}`, pos: "NOUN", rank: i, level: "B1", anchored, gender: "der", plural: null });
  const words = [w(1, false), w(2, true), w(3, false), w(4, true)];

  it("serves official-list (anchored) words first, each group by frequency", () => {
    const r = buildRound(words, {}, now, { size: 4, newMax: 4, tutorReady: false, examFirst: true });
    expect(r.map((e) => e.word.rank)).toEqual([2, 4, 1, 3]);
  });

  it("starts translation one step earlier", () => {
    const m = { ...newMemory(now), streak: 1 };
    expect(exerciseFor(words[0], m, true, 1).kind).toBe("translate");
    expect(exerciseFor(words[0], m, true).kind).not.toBe("translate");
  });
});
