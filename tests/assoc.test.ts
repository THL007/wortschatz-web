import { describe, expect, it } from "vitest";
import { atomicAssoc, bumpAssoc, modeFor, pickCompanions } from "../src/lib/assoc";
import { buildRound, buildTutorSession, levelStats } from "../src/lib/session";
import { newMemory } from "../src/lib/srs";
import { containsTarget, parseTask } from "../src/lib/tutor";
import type { Memory, Word } from "../src/lib/types";

const now = new Date("2026-11-10T10:00:00Z");
const N = (lemma: string, word: string, rank: number, gender: "der" | "die" | "das" = "das"): Word => ({ id: `n:${lemma}`, lemma, word, pos: "NOUN", rank, level: "A1", anchored: true, gender, plural: null });
const auto = N("auto", "Auto", 1);
const bahn = N("bahn", "Bahn", 2, "die");
const tag = N("tag", "Tag", 3, "der");
const nacht = N("nacht", "Nacht", 4, "die");
const words = [auto, bahn, tag, nacht];
const mem = (assoc: number, due = new Date("2026-11-01T00:00:00Z")): Memory => ({ ...newMemory(due), assoc });

describe("associability modes", () => {
  it("0 = word only, 1 = phrase, 2+ = sentence", () => {
    expect([modeFor(0), modeFor(1), modeFor(2), modeFor(7)]).toEqual(["word", "phrase", "sentence", "sentence"]);
  });
  it("picks partners only from words with enough associability", () => {
    const memory = { "n:auto": mem(2), "n:bahn": mem(2), "n:tag": mem(1), "n:nacht": mem(0) };
    expect(pickCompanions(auto, "sentence", words, memory).map((w) => w.lemma)).toEqual(["bahn"]);
    expect(pickCompanions(tag, "phrase", words, memory).map((w) => w.lemma)).toEqual(["auto"]);
    expect(pickCompanions(nacht, "word", words, memory)).toEqual([]);
  });
  it("Auto (2) + Bahn (2) passed together -> both 3; word rounds lift 0 to 1 only", () => {
    const memory = bumpAssoc({ "n:auto": mem(2), "n:bahn": mem(2) }, ["n:auto", "n:bahn"]);
    expect([memory["n:auto"].assoc, memory["n:bahn"].assoc]).toEqual([3, 3]);
    expect(atomicAssoc(mem(0)).assoc).toBe(1);
    expect(atomicAssoc(mem(4)).assoc).toBe(4);
  });
  it("tutor items follow the target's associability", () => {
    const memory = { "n:auto": mem(2), "n:bahn": mem(2), "n:tag": mem(1) };
    const s = buildTutorSession(words, [], memory, now, { size: 4 });
    const byWord = Object.fromEntries(s.map((e) => [e.word.lemma, e]));
    expect(byWord.auto.assocMode).toBe("sentence");
    expect(byWord.auto.companions?.map((w) => w.lemma)).toContain("bahn");
    expect(byWord.tag.assocMode).toBe("phrase");
    expect(byWord.nacht.assocMode).toBe("word");
  });
});

describe("compounds and partner checks", () => {
  it("accepts Autobahn for Auto + Bahn only when compounds are allowed", () => {
    expect(containsTarget(auto, "Wir fahren auf der Autobahn.", { compound: true })).toBe(true);
    expect(containsTarget(bahn, "Wir fahren auf der Autobahn.", { compound: true })).toBe(true);
    expect(containsTarget(auto, "Wir fahren auf der Autobahn.")).toBe(false);
  });
  it("rejects an AI sentence that leaves out a partner word", () => {
    expect(parseTask('{"source":"The car is fast.","reference":"Das Auto ist schnell."}', auto, [bahn])).toBeNull();
    expect(parseTask('{"source":"The motorway is long.","reference":"Die Autobahn ist lang."}', auto, [bahn])?.reference).toBe("Die Autobahn ist lang.");
  });
});

describe("too easy and learned", () => {
  it("never serves retired words again and counts learned ones", () => {
    const memory = { "n:auto": { ...mem(1), retired: true, learned: true }, "n:bahn": { ...mem(0), learned: true } };
    expect(buildRound(words, memory, now, { size: 10, newMax: 10, tutorReady: false }).map((e) => e.word.lemma)).not.toContain("auto");
    expect(buildTutorSession(words, [], memory, now, { size: 10 }).map((e) => e.word.lemma)).not.toContain("auto");
    expect(levelStats(words, memory, now).learned).toBe(2);
  });
});
