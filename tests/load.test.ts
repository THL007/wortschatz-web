import { describe, expect, it } from "vitest";
import { sessionLoad } from "../src/app/plan";
import { buildTutorSession } from "../src/lib/session";
import { newMemory } from "../src/lib/srs";
import { defaultSettings } from "../src/lib/store";
import type { Memory, Progress, Word } from "../src/lib/types";

const now = new Date(2026, 10, 10, 9, 0);
const words: Word[] = Array.from({ length: 600 }, (_, i) => ({ id: `n:w${i}`, lemma: `w${i}`, word: `W${i}`, pos: "NOUN", rank: i + 1, level: "A1", anchored: i % 2 === 1, gender: "der", plural: null }));
const prog = (intensive: Partial<Progress["settings"]["intensive"]>, extra: Partial<Progress> = {}): Progress => ({
  version: 1,
  settings: { ...defaultSettings, intensive: { ...defaultSettings.intensive, ...intensive } },
  memory: {},
  ...extra,
});

describe("sessionLoad: intensive scales the normal rounds", () => {
  it("keeps normal sizes when intensive is off", () => {
    const l = sessionLoad(prog({ on: false }), words, now);
    expect([l.tutorSize, l.wordSize, l.grammarSize, l.tutorNewMax]).toEqual([6, 10, 5, undefined]);
  });
  it("grows sessions with the minutes and caps new words at today's goal", () => {
    const l = sessionLoad(prog({ on: true, examDate: "2026-12-10", minutes: 30 }), words, now);
    expect([l.tutorSize, l.wordSize, l.grammarSize]).toEqual([10, 20, 8]);
    expect(l.plan?.newPerDay).toBe(22); // ceil(600 / 28) = 22, capacity 23
    expect(l.tutorNewMax).toBe(10);
    expect(l.wordNewMax).toBe(20);
    expect(l.examFirst && l.newFirst).toBe(true);
  });
  it("shares the daily goal: new words already learned today shrink the cap", () => {
    const l = sessionLoad(prog({ on: true, examDate: "2026-12-10", minutes: 30 }, { daily: { "2026-11-10": { new: 18, reviews: 0 } } }), words, now);
    // start-of-day total = 600 not started + 18 introduced today -> goal ceil(618 / 28) = 23, 5 left
    expect(l.plan?.newPerDay).toBe(23);
    expect(l.tutorNewMax).toBe(5);
    expect(l.wordNewMax).toBe(5);
  });
  it("falls back to normal without an exam date", () => {
    expect(sessionLoad(prog({ on: true, examDate: "" }), words, now).tutorSize).toBe(6);
  });
});

describe("tutor session in intensive mode", () => {
  it("brings new official-list words before not-due reviews, up to the cap", () => {
    const memory: Record<string, Memory> = { "n:w0": newMemory(new Date(2026, 11, 1)) }; // started, not due
    const s = buildTutorSession(words, [], memory, now, { size: 4, newMax: 3, newFirst: true, examFirst: true });
    expect(s.map((e) => e.word.lemma)).toEqual(["w1", "w3", "w5", "w0"]);
  });
  it("keeps the normal order without intensive", () => {
    const memory: Record<string, Memory> = { "n:w0": newMemory(new Date(2026, 11, 1)) };
    expect(buildTutorSession(words, [], memory, now, { size: 3 }).map((e) => e.word.lemma)).toEqual(["w0", "w1", "w2"]);
  });
});
