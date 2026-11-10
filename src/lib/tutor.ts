import type { Settings, Word } from "./types";

/** Structured correction returned by the tutor (validated before use). */
export interface Correction {
  isCorrect: boolean;
  corrected: string;
  targetUsed: boolean;
  errors: { wrong: string; fix: string; why: string }[];
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const tutorReady = (s: Settings) => s.openRouterKey.trim().length > 0 && s.openRouterModel.trim().length > 0;

function prompt(word: Word, sentence: string, lang: string) {
  const target = word.pos === "NOUN" ? `${word.gender} ${word.word}` : word.word;
  return [
    {
      role: "system",
      content:
        "You are a strict, kind German teacher for exam learners. Correct the learner's German sentence. " +
        "Only fix real errors; keep the learner's meaning and words when possible. " +
        `Explain each error in ${lang}, one short sentence. ` +
        'Reply with JSON only: {"isCorrect":boolean,"corrected":string,"targetUsed":boolean,"errors":[{"wrong":string,"fix":string,"why":string}]}',
    },
    { role: "user", content: `Target word: ${target}\nLearner sentence: ${sentence}` },
  ];
}

/** Server-side style check: the target lemma (or a known form) must really appear. */
export function containsTarget(word: Word, sentence: string): boolean {
  const s = sentence.toLowerCase();
  const forms = [word.lemma, word.word, word.plural, word.p3, word.pp].filter(Boolean).map((f) => f!.toLowerCase());
  return forms.some((f) => new RegExp(`(^|[^a-zäöüß])${f}([^a-zäöüß]|$)`).test(s));
}

export function parseCorrection(text: string): Correction | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (typeof j.isCorrect !== "boolean" || typeof j.corrected !== "string" || !Array.isArray(j.errors)) return null;
    return {
      isCorrect: j.isCorrect,
      corrected: j.corrected,
      targetUsed: Boolean(j.targetUsed),
      errors: j.errors
        .filter((e: unknown) => e && typeof e === "object")
        .map((e: { wrong?: unknown; fix?: unknown; why?: unknown }) => ({ wrong: String(e.wrong ?? ""), fix: String(e.fix ?? ""), why: String(e.why ?? "") })),
    };
  } catch {
    return null;
  }
}

export async function correct(word: Word, sentence: string, s: Settings): Promise<Correction> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.openRouterKey}`, "Content-Type": "application/json", "X-Title": "Wortschatz" },
    body: JSON.stringify({ model: s.openRouterModel, messages: prompt(word, sentence, s.explainIn), temperature: 0 }),
  });
  if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
  const data = await res.json();
  const parsed = parseCorrection(data?.choices?.[0]?.message?.content ?? "");
  if (!parsed) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  // our own check wins over the model's claim (Nantia ADR 005)
  parsed.targetUsed = containsTarget(word, sentence);
  return parsed;
}
