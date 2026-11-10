import type { Settings, Word } from "./types";

/** Structured correction returned by the tutor (validated before use). */
export interface Correction {
  isCorrect: boolean;
  corrected: string;
  targetUsed: boolean;
  errors: { wrong: string; fix: string; why: string }[];
}

/** A sentence in the learner's language to translate into German. Built by the AI, checked by us. */
export interface TranslationTask {
  source: string; // in the learner's language
  reference: string; // one good German translation, uses the target word
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model presets, picked by a 12-item eval on 2026-11-10 (sentence building + 8 graded translations,
 * same prompts as the app). All three scored 8/8 judging and 4/4 fixes; see docs in the vault.
 */
export const MODEL_PRESETS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", note: "Recommended: fastest, about $0.0001 per sentence" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", note: "Strongest model, about $0.002 per sentence" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", note: "Same low cost as Haiku, about 3 times slower" },
] as const;
export const DEFAULT_MODEL = MODEL_PRESETS[0].id;

export const tutorReady = (s: Settings) => s.openRouterKey.trim().length > 0 && s.openRouterModel.trim().length > 0;

export const targetLabel = (w: Word) => (w.pos === "NOUN" ? `${w.gender} ${w.word}` : w.word);

type Message = { role: "system" | "user"; content: string };
export type Fetcher = typeof fetch;

async function chat(messages: Message[], s: Settings, f: Fetcher, temperature: number): Promise<string> {
  const res = await f(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.openRouterKey}`, "Content-Type": "application/json", "X-Title": "Wortschatz" },
    // max_tokens bounds cost and credit reservation; it also counts hidden reasoning, so keep headroom
    // and ask reasoning models for low effort (ignored by models without reasoning).
    body: JSON.stringify({ model: s.openRouterModel, messages, temperature, max_tokens: 2000, reasoning: { effort: "low" } }),
  });
  if (!res.ok)
    throw new Error(
      res.status === 401 ? "OpenRouter rejected the key (401). Check it in Settings."
      : res.status === 402 ? "OpenRouter says the account is out of credit (402). Top up at openrouter.ai or pick a cheaper model."
      : `OpenRouter answered ${res.status}.`,
    );
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

const firstJson = (text: string): Record<string, unknown> | null => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

/** Our own check: the target lemma (or a known form of it) must really appear (Nantia ADR 005). */
export function containsTarget(word: Word, sentence: string): boolean {
  const s = sentence.toLowerCase();
  const forms = [word.lemma, word.word, word.plural, word.p3, word.pp, ...(word.forms ?? [])].filter(Boolean).map((f) => f!.toLowerCase());
  return forms.some((f) => new RegExp(`(^|[^a-zäöüß])${f}([^a-zäöüß]|$)`).test(s));
}

export function parseCorrection(text: string): Correction | null {
  const j = firstJson(text);
  if (!j || typeof j.isCorrect !== "boolean" || typeof j.corrected !== "string" || !Array.isArray(j.errors)) return null;
  return {
    isCorrect: j.isCorrect,
    corrected: j.corrected,
    targetUsed: Boolean(j.targetUsed),
    errors: (j.errors as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({ wrong: String(e.wrong ?? ""), fix: String(e.fix ?? ""), why: String(e.why ?? "") })),
  };
}

export function parseTask(text: string, word: Word): TranslationTask | null {
  const j = firstJson(text);
  if (!j || typeof j.source !== "string" || typeof j.reference !== "string") return null;
  const source = j.source.trim();
  const reference = j.reference.trim();
  if (source.length < 3 || source.length > 160 || !reference) return null;
  if (!containsTarget(word, reference)) return null; // the German answer must teach the target word
  return { source, reference };
}

const CORRECTION_SHAPE = '{"isCorrect":boolean,"corrected":string,"targetUsed":boolean,"errors":[{"wrong":string,"fix":string,"why":string}]}';

/**
 * Ask the AI for a short sentence in the learner's language whose natural German translation uses the
 * target word. Only simple words at the learner's level; known words are offered as scaffold, never required.
 * Rejected and retried once if the German reference does not contain the target word.
 */
export async function generateTask(word: Word, known: string[], s: Settings, f: Fetcher = fetch): Promise<TranslationTask> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        `You write translation exercises for a learner of German (CEFR ${word.level}) whose own language is ${s.explainIn}. ` +
        `Write ONE short, natural, everyday sentence in ${s.explainIn} (4 to 10 words) whose German translation must use the target word. ` +
        `Keep every other word simple, at CEFR ${word.level} or below. You may reuse these German words the learner knows: ${known.slice(0, 40).join(", ") || "(none yet)"}. ` +
        'Reply with JSON only: {"source": "<sentence in the learner language>", "reference": "<one correct German translation>"}',
    },
    { role: "user", content: `Target word: ${targetLabel(word)}` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const task = parseTask(await chat(messages, s, f, 0.7), word);
    if (task) return task;
  }
  throw new Error("The tutor could not build a usable sentence for this word.");
}

export async function correctTranslation(word: Word, task: TranslationTask, answer: string, s: Settings, f: Fetcher = fetch): Promise<Correction> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a strict, kind German teacher for exam learners. The learner translated a sentence into German. " +
        "Judge the learner's German: accept any correct, natural translation, not only the reference. " +
        "Fix only real errors (grammar, spelling, gender, case, word order, wrong meaning); keep the learner's words when they are correct. " +
        `If correct, "corrected" repeats the learner's sentence. List at most 3 errors; explain each in ${s.explainIn} in under 20 words. ` +
        `Reply with JSON only: ${CORRECTION_SHAPE}`,
    },
    {
      role: "user",
      content: `Sentence (${s.explainIn}): ${task.source}\nReference German: ${task.reference}\nTarget word: ${targetLabel(word)}\nLearner's German: ${answer}`,
    },
  ];
  const parsed = parseCorrection(await chat(messages, s, f, 0));
  if (!parsed) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  parsed.targetUsed = containsTarget(word, answer); // our check wins over the model's claim
  return parsed;
}

/** Free sentence writing with the target word. */
export async function correct(word: Word, sentence: string, s: Settings, f: Fetcher = fetch): Promise<Correction> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a strict, kind German teacher for exam learners. Correct the learner's German sentence. " +
        "Only fix real errors; keep the learner's meaning and words when possible. " +
        `List at most 3 errors; explain each in ${s.explainIn} in under 20 words. ` +
        `Reply with JSON only: ${CORRECTION_SHAPE}`,
    },
    { role: "user", content: `Target word: ${targetLabel(word)}\nLearner sentence: ${sentence}` },
  ];
  const parsed = parseCorrection(await chat(messages, s, f, 0));
  if (!parsed) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  parsed.targetUsed = containsTarget(word, sentence);
  return parsed;
}
