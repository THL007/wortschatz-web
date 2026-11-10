import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { AI_MAX_TRIES, AI_TIME_LIMIT_MS, canRetry, finalGrade, formatLeft } from "../src/lib/attempts";
import { parseCorrection } from "../src/lib/tutor";

describe("retry policy", () => {
  const t0 = 1_000_000;
  it("AI exercises allow 3 tries within 3 minutes", () => {
    expect(canRetry("ai", 1, t0, t0 + 10_000)).toBe(true);
    expect(canRetry("ai", 2, t0, t0 + 10_000)).toBe(true);
    expect(canRetry("ai", AI_MAX_TRIES, t0, t0 + 10_000)).toBe(false);
    expect(canRetry("ai", 1, t0, t0 + AI_TIME_LIMIT_MS)).toBe(false);
  });
  it("typed exercises allow one extra try, without a clock", () => {
    expect(canRetry("typed", 1, t0, t0 + 10 * AI_TIME_LIMIT_MS)).toBe(true);
    expect(canRetry("typed", 2, t0, t0)).toBe(false);
  });
  it("grades by the try that solved it", () => {
    expect(finalGrade(1).grade).toBe(Rating.Good);
    expect(finalGrade(2).grade).toBe(Rating.Good);
    expect(finalGrade(3)).toEqual({ verdict: "right", grade: Rating.Hard });
    expect(finalGrade(null, "close").grade).toBe(Rating.Hard);
    expect(finalGrade(null).grade).toBe(Rating.Again);
  });
  it("formats the time left", () => {
    expect(formatLeft(161_000)).toBe("2:41");
    expect(formatLeft(-5)).toBe("0:00");
  });
});

describe("hints", () => {
  it("parses a hint per error and tolerates a missing one", () => {
    const c = parseCorrection('{"isCorrect":false,"corrected":"Ich habe keine Zeit.","targetUsed":true,"errors":[{"wrong":"kein","fix":"keine","why":"Zeit is feminine.","hint":"Zeit is feminine: check the ending of kein."},{"wrong":"x","fix":"y","why":"z"}]}');
    expect(c?.errors[0].hint).toContain("check the ending");
    expect(c?.errors[1].hint).toBe("");
  });
});
