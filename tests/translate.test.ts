import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { gradeCorrection } from "../src/lib/check";
import { buildTranslateRound, exerciseFor } from "../src/lib/session";
import { newMemory } from "../src/lib/srs";
import { defaultSettings } from "../src/lib/store";
import { correctTranslation, generateTask, parseTask, type Fetcher } from "../src/lib/tutor";
import type { Memory, Settings, Word } from "../src/lib/types";

const nacht: Word = { id: "n:nacht", lemma: "nacht", word: "Nacht", pos: "NOUN", rank: 198, level: "A1", anchored: true, gender: "die", plural: "Nächte" };
const settings: Settings = { ...defaultSettings, openRouterKey: "test-key", openRouterModel: "test/model" };

/** Fake OpenRouter: returns the given contents in order and records the requests. */
function fakeRouter(contents: string[]) {
  const calls: { body: { messages: { content: string }[]; model: string } }[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    const content = contents.shift() ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as Fetcher;
  return { f, calls };
}

describe("generateTask", () => {
  it("returns the AI sentence when the German reference uses the target word", async () => {
    const { f, calls } = fakeRouter(['{"source":"The night is long.","reference":"Die Nacht ist lang."}']);
    const t = await generateTask(nacht, ["das Jahr"], settings, f);
    expect(t).toEqual({ source: "The night is long.", reference: "Die Nacht ist lang." });
    expect(calls[0].body.model).toBe("test/model");
    expect(calls[0].body.messages[0].content).toContain("English");
    expect(calls[0].body.messages[1].content).toContain("die Nacht");
  });

  it("retries once when the reference misses the target word", async () => {
    const { f, calls } = fakeRouter([
      '{"source":"The day is long.","reference":"Der Tag ist lang."}',
      '{"source":"Good night!","reference":"Gute Nacht!"}',
    ]);
    const t = await generateTask(nacht, [], settings, f);
    expect(t.reference).toBe("Gute Nacht!");
    expect(calls.length).toBe(2);
  });

  it("fails cleanly after two unusable answers", async () => {
    const { f } = fakeRouter(["no json", '{"source":"x"}']);
    await expect(generateTask(nacht, [], settings, f)).rejects.toThrow(/could not build/);
  });

  it("writes the source in French when that is the learner's language", async () => {
    const { f, calls } = fakeRouter(['{"source":"La nuit est longue.","reference":"Die Nacht ist lang."}']);
    await generateTask(nacht, [], { ...settings, explainIn: "Français" }, f);
    expect(calls[0].body.messages[0].content).toContain("Français");
  });

  it("parseTask accepts plural forms of the target", () => {
    expect(parseTask('{"source":"The nights are cold.","reference":"Die Nächte sind kalt."}', nacht)?.reference).toBe("Die Nächte sind kalt.");
  });
});

describe("correctTranslation", () => {
  const task = { source: "The night is long.", reference: "Die Nacht ist lang." };

  it("uses our own target check over the model's claim", async () => {
    const { f } = fakeRouter(['{"isCorrect":true,"corrected":"Der Abend ist lang.","targetUsed":true,"errors":[]}']);
    const c = await correctTranslation(nacht, task, "Der Abend ist lang.", settings, f);
    expect(c.targetUsed).toBe(false);
    expect(gradeCorrection(c)).toEqual({ verdict: "wrong", grade: Rating.Again });
  });

  it("sends source, reference and the learner answer to the tutor", async () => {
    const { f, calls } = fakeRouter(['{"isCorrect":false,"corrected":"Die Nacht ist lang.","targetUsed":true,"errors":[{"wrong":"Der Nacht","fix":"Die Nacht","why":"Nacht is feminine."}]}']);
    const c = await correctTranslation(nacht, task, "Der Nacht ist lang.", settings, f);
    const user = calls[0].body.messages[1].content;
    expect(user).toContain("The night is long.");
    expect(user).toContain("Die Nacht ist lang.");
    expect(user).toContain("Der Nacht ist lang.");
    expect(gradeCorrection(c)).toEqual({ verdict: "close", grade: Rating.Hard });
  });

  it("refuses to grade an unreadable answer", async () => {
    const { f } = fakeRouter(["Sorry, I cannot help."]);
    await expect(correctTranslation(nacht, task, "Die Nacht ist lang.", settings, f)).rejects.toThrow(/Nothing was graded/);
  });
});

describe("gradeCorrection", () => {
  it("maps correct, one error and many errors", () => {
    expect(gradeCorrection({ isCorrect: true, targetUsed: true, errors: [] }).grade).toBe(Rating.Good);
    expect(gradeCorrection({ isCorrect: false, targetUsed: true, errors: [1] }).grade).toBe(Rating.Hard);
    expect(gradeCorrection({ isCorrect: false, targetUsed: true, errors: [1, 2] }).grade).toBe(Rating.Again);
  });
});

describe("translate in rounds", () => {
  const words: Word[] = Array.from({ length: 8 }, (_, i) => ({ ...nacht, id: `n:w${i}`, lemma: `w${i}`, word: `W${i}`, rank: i + 1 }));

  it("puts started words first, then new words by frequency, all as translate", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    const memory: Record<string, Memory> = {
      "n:w5": newMemory(new Date("2026-11-01T00:00:00Z")), // due
      "n:w3": newMemory(new Date("2026-11-20T00:00:00Z")), // started, not due
    };
    const r = buildTranslateRound(words, memory, now, { size: 5 });
    expect(r.map((e) => e.word.lemma)).toEqual(["w5", "w3", "w0", "w1", "w2"]);
    expect(r.every((e) => e.kind === "translate")).toBe(true);
  });

  it("offers translate in mixed rounds from streak 2, only with the tutor", () => {
    const mem = { ...newMemory(new Date()), streak: 2 };
    expect(exerciseFor(nacht, mem, true).kind).toBe("translate");
    expect(exerciseFor(nacht, mem, false).kind).not.toBe("translate");
  });
});

describe("defaults and request shape", () => {
  it("defaults to the recommended model and caps reply length", async () => {
    const { DEFAULT_MODEL } = await import("../src/lib/tutor");
    expect(defaultSettings.openRouterModel).toBe(DEFAULT_MODEL);
    const { f, calls } = fakeRouter(['{"source":"Good night!","reference":"Gute Nacht!"}']);
    await generateTask(nacht, [], settings, f);
    expect((calls[0].body as unknown as { max_tokens: number }).max_tokens).toBe(600);
  });

  it("recognises any attested verb form via forms", async () => {
    const { containsTarget } = await import("../src/lib/tutor");
    const treffen: Word = { id: "v:treffen", lemma: "treffen", word: "treffen", pos: "VERB", rank: 300, level: "B1", anchored: true, p3: "trifft", pp: "getroffen", forms: ["treffe", "traf", "triffst"] };
    expect(containsTarget(treffen, "Ich treffe morgen meinen Freund.")).toBe(true);
    expect(containsTarget(treffen, "Ich sehe morgen meinen Freund.")).toBe(false);
  });
});
