import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rating } from "ts-fsrs";
import { check, toGrade } from "../src/lib/check";
import { buildRound } from "../src/lib/session";
import { newMemory, review } from "../src/lib/srs";
import { containsTarget, parseCorrection } from "../src/lib/tutor";
import type { Memory, Word } from "../src/lib/types";

const noun = (lemma: string, rank: number): Word => ({
  id: `n:${lemma}`, lemma, word: lemma[0].toUpperCase() + lemma.slice(1), pos: "NOUN", rank, level: "A1", anchored: true, gender: "die", plural: null,
});

describe("check", () => {
  it("accepts exact answers case-insensitively", () => expect(check("Nächte", "Nächte")).toBe("right"));
  it("treats an umlaut slip as close", () => expect(check("Naechte", "Nächte")).toBe("close"));
  it("rejects wrong answers", () => expect(check("Nachts", "Nächte")).toBe("wrong"));
  it("ignores a leading article", () => expect(check("die Nächte", "Nächte")).toBe("right"));
  it("maps verdicts to FSRS grades", () => {
    expect(toGrade("right")).toBe(Rating.Good);
    expect(toGrade("close")).toBe(Rating.Hard);
    expect(toGrade("wrong")).toBe(Rating.Again);
  });
});

describe("srs", () => {
  it("Again resets the streak, Good extends it", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    let m = review(newMemory(now), Rating.Good, now);
    expect(m.streak).toBe(1);
    m = review(m, Rating.Again, now);
    expect(m.streak).toBe(0);
    expect(m.seen).toBe(2);
  });
});

describe("buildRound", () => {
  const words = Array.from({ length: 40 }, (_, i) => noun(`wort${i}`, i + 1));

  it("serves new words in frequency order", () => {
    const r = buildRound(words, {}, new Date(), { size: 10, newMax: 5, tutorReady: false });
    expect(r.map((e) => e.word.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("property: no duplicates, never above size, new words are the lowest unseen ranks", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 20 }), fc.integer({ min: 1, max: 15 }), (seenIdx, size) => {
        const now = new Date("2026-11-10T10:00:00Z");
        const memory: Record<string, Memory> = {};
        for (const i of seenIdx) memory[words[i].id] = newMemory(new Date("2026-11-20T00:00:00Z")); // not due
        const r = buildRound(words, memory, now, { size, newMax: 5, tutorReady: false });
        const ids = r.map((e) => e.word.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(r.length).toBeLessThanOrEqual(size);
        const unseen = words.filter((w) => !memory[w.id]).map((w) => w.rank);
        expect(r.map((e) => e.word.rank)).toEqual(unseen.slice(0, r.length));
      }),
    );
  });
});

describe("tutor guards", () => {
  it("finds the target word or a form of it", () => {
    const w: Word = { ...noun("nacht", 1), word: "Nacht", plural: "Nächte" };
    expect(containsTarget(w, "Die Nächte sind kalt.")).toBe(true);
    expect(containsTarget(w, "Der Tag ist lang.")).toBe(false);
  });
  it("rejects malformed tutor JSON", () => {
    expect(parseCorrection("no json here")).toBeNull();
    expect(parseCorrection('{"isCorrect":"yes"}')).toBeNull();
    expect(parseCorrection('```json\n{"isCorrect":false,"corrected":"Ich bin müde.","targetUsed":true,"errors":[]}\n```')?.corrected).toBe("Ich bin müde.");
  });
});
