import { describe, expect, it } from "vitest";
import { checkDrill, exactDrillMatch, generateDrill, parseDrill, pickTopics, topicsFor } from "../src/lib/grammar";
import { buildTutorSession } from "../src/lib/session";
import { newMemory } from "../src/lib/srs";
import { defaultSettings } from "../src/lib/store";
import { correctTranslation, generateTask, type Fetcher } from "../src/lib/tutor";
import type { GrammarTopic, Memory, Settings, Word } from "../src/lib/types";

const settings: Settings = { ...defaultSettings, openRouterKey: "test-key", openRouterModel: "test/model" };
const T = (name: string, order: number, level: "A1" | "A2" = "A1"): GrammarTopic => ({ id: `g:${name}`, name, label: name.toLowerCase(), level, category: "x", order });
const topics = [T("PRESENT_SIMPLE", 0), T("ACCUSATIVE_CASE", 3), T("NOMINATIVE_CASE", 2), T("PERFEKT", 20, "A2")];
const now = new Date("2026-11-10T10:00:00Z");

function fakeRouter(contents: string[]) {
  const calls: { body: { messages: { content: string }[] } }[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: contents.shift() ?? "" } }] }), { status: 200 });
  }) as unknown as Fetcher;
  return { f, calls };
}

describe("topics", () => {
  it("filters by level in teaching order", () => {
    expect(topicsFor(topics, "A1").map((t) => t.name)).toEqual(["PRESENT_SIMPLE", "NOMINATIVE_CASE", "ACCUSATIVE_CASE"]);
  });
  it("picks due topics first, then unseen in order", () => {
    const a1 = topicsFor(topics, "A1");
    const memory: Record<string, Memory> = {
      "g:ACCUSATIVE_CASE": newMemory(new Date("2026-11-01T00:00:00Z")), // due
      "g:PRESENT_SIMPLE": newMemory(new Date("2026-12-01T00:00:00Z")), // not due
    };
    expect(pickTopics(a1, memory, now, 3).map((t) => t.name)).toEqual(["ACCUSATIVE_CASE", "NOMINATIVE_CASE", "PRESENT_SIMPLE"]);
  });
});

describe("tutor session", () => {
  const words: Word[] = Array.from({ length: 8 }, (_, i) => ({ id: `n:w${i}`, lemma: `w${i}`, word: `W${i}`, pos: "NOUN", rank: i + 1, level: "A1", anchored: true, gender: "der", plural: null }));
  it("gives phrase and sentence items a grammar topic of the level, new words none", () => {
    const fresh = buildTutorSession(words, topicsFor(topics, "A1"), {}, now, { size: 6 });
    expect(fresh.every((e) => e.assocMode === "word" && !e.grammar)).toBe(true);
    const known: Record<string, Memory> = Object.fromEntries(words.map((w) => [w.id, { ...newMemory(new Date("2026-11-01T00:00:00Z")), assoc: 2 }]));
    const s = buildTutorSession(words, topicsFor(topics, "A1"), known, now, { size: 6 });
    expect(s.length).toBe(6);
    expect(s.every((e) => e.kind === "translate" && e.assocMode === "sentence" && e.grammar?.level === "A1")).toBe(true);
    expect(s.map((e) => e.grammar!.name).slice(0, 3)).toEqual(["PRESENT_SIMPLE", "NOMINATIVE_CASE", "ACCUSATIVE_CASE"]);
  });
  it("works without topics", () => {
    expect(buildTutorSession(words, [], {}, now, { size: 3 }).every((e) => !e.grammar)).toBe(true);
  });
  it("asks the AI for the grammar point and reads grammarUsed", async () => {
    const w = words[0];
    const g = topics[1];
    const { f, calls } = fakeRouter(['{"source":"I see W0.","reference":"Ich sehe den W0."}', '{"isCorrect":true,"corrected":"Ich sehe den W0.","targetUsed":true,"grammarUsed":true,"errors":[]}']);
    const task = await generateTask(w, [], settings, f, g);
    expect(task.grammar).toBe("g:ACCUSATIVE_CASE");
    expect(calls[0].body.messages[0].content).toContain("accusative_case");
    const c = await correctTranslation(w, task, "Ich sehe den W0.", settings, f, g);
    expect(c.grammarUsed).toBe(true);
    expect(calls[1].body.messages[0].content).toContain("grammarUsed");
  });
});

describe("drills", () => {
  const drill = { instruction: "Fill in the article in the accusative.", prompt: "Ich sehe ___ Mann.", answer: "den" };
  it("parses and validates a drill", () => {
    expect(parseDrill(JSON.stringify(drill))).toEqual(drill);
    expect(parseDrill('{"instruction":"x","prompt":""}')).toBeNull();
  });
  it("accepts an exact answer without calling the AI", async () => {
    expect(exactDrillMatch(drill, "  Den. ")).toBe(true);
    const { f, calls } = fakeRouter([]);
    const c = await checkDrill(topics[1], drill, "den", settings, f);
    expect(c.isCorrect).toBe(true);
    expect(calls.length).toBe(0);
  });
  it("asks the AI to judge other answers", async () => {
    const { f, calls } = fakeRouter(['{"isCorrect":false,"corrected":"den","targetUsed":true,"errors":[{"wrong":"der","fix":"den","why":"Akkusativ","hint":"Which case follows sehen?"}]}']);
    const c = await checkDrill(topics[1], drill, "der", settings, f);
    expect(c.isCorrect).toBe(false);
    expect(c.errors[0].hint).toContain("case");
    expect(calls[0].body.messages[1].content).toContain("Learner: der");
  });
  it("builds a drill for a topic, retrying once on bad JSON", async () => {
    const { f, calls } = fakeRouter(["oops", JSON.stringify(drill)]);
    expect(await generateDrill(topics[1], settings, f)).toEqual(drill);
    expect(calls.length).toBe(2);
  });
});
