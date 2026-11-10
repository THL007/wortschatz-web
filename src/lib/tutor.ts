import type { GrammarTopic, Settings, Word } from "./types";

/** Structured correction returned by the tutor (validated before use). */
export interface Correction {
  isCorrect: boolean;
  corrected: string;
  targetUsed: boolean;
  /** tutor session with a grammar point: did the learner's German use it correctly? */
  grammarUsed?: boolean;
  /** ids of partner words that really appear in the learner's answer (credited +1 associability on success) */
  companionsUsed?: string[];
  errors: { wrong: string; fix: string; why: string; hint: string }[];
}

/** A sentence in the learner's language to translate into German. Built by the AI, checked by us. */
export interface TranslationTask {
  source: string; // in the learner's language
  reference: string; // one good German translation, uses the target word
  grammar?: string; // GrammarTopic id the sentence practises
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

export type Message = { role: "system" | "user"; content: string };
export type Fetcher = typeof fetch;

export async function chat(messages: Message[], s: Settings, f: Fetcher, temperature: number): Promise<string> {
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

/** Every top-level JSON object in a reply (models sometimes send a draft and then a corrected one). */
export function jsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) found.push(v);
        } catch {
          /* not JSON, keep scanning */
        }
      }
    }
  }
  return found;
}

/** The last JSON object in a reply (the model's final answer). */
export const firstJson = (text: string): Record<string, unknown> | null => {
  const all = jsonObjects(text);
  return all.length ? all[all.length - 1] : null;
};

/** Our own check: the target lemma (or a known form of it) must really appear (Nantia ADR 005). */
export function containsTarget(word: Word, sentence: string, opts: { compound?: boolean } = {}): boolean {
  const s = sentence.toLowerCase();
  const forms = [word.lemma, word.word, word.plural, word.p3, word.pp, ...(word.forms ?? [])].filter(Boolean).map((f) => f!.toLowerCase());
  if (forms.some((f) => new RegExp(`(^|[^a-zäöüß])${f}([^a-zäöüß]|$)`).test(s))) return true;
  // associated words may form a compound (Auto + Bahn -> Autobahn): accept the stem inside a word (4+ letters)
  if (opts.compound) return forms.some((f) => f.length >= 4 && s.includes(f.replace(/(en|e|n)$/, "").length >= 4 ? f.replace(/(en|e|n)$/, "") : f));
  return false;
}

export function parseCorrection(text: string): Correction | null {
  const j = firstJson(text);
  if (!j || typeof j.isCorrect !== "boolean" || typeof j.corrected !== "string" || !Array.isArray(j.errors)) return null;
  return {
    isCorrect: j.isCorrect,
    corrected: j.corrected,
    targetUsed: Boolean(j.targetUsed),
    grammarUsed: typeof j.grammarUsed === "boolean" ? j.grammarUsed : undefined,
    errors: (j.errors as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({ wrong: String(e.wrong ?? ""), fix: String(e.fix ?? ""), why: String(e.why ?? ""), hint: String(e.hint ?? "") })),
  };
}

export function parseTask(text: string, word: Word, companions: Word[] = [], mode: "word" | "phrase" | "sentence" = "sentence"): TranslationTask | null {
  // try the model's candidates from last to first; take the first one that passes our checks
  for (const j of jsonObjects(text).reverse()) {
    if (typeof j.source !== "string" || typeof j.reference !== "string") continue;
    const source = j.source.trim();
    const reference = j.reference.trim();
    if (source.length < 3 || source.length > 160 || !reference) continue;
    const words = reference.replace(/[.!?,]/g, "").split(/\s+/).filter(Boolean).length;
    if (mode === "word" && words > 3) continue; // associability 0: only the word with its article
    if (mode === "phrase" && words > 6) continue;
    const compound = companions.length > 0;
    if (!containsTarget(word, reference, { compound })) continue; // the German answer must teach the target word
    if (companions.some((c) => !containsTarget(c, reference, { compound: true }))) continue; // ...and use every partner word
    return { source, reference };
  }
  return null;
}

export const CORRECTION_SHAPE = '{"isCorrect":boolean,"corrected":string,"targetUsed":boolean,"errors":[{"wrong":string,"fix":string,"why":string,"hint":string}]}';
/** The learner may retry: "hint" must nudge without giving the corrected words away. */
export const HINT_RULE = 'For each error also give "hint": a short nudge that helps the learner fix it without writing the corrected word or sentence (e.g. "Zeit is feminine: check the ending of kein."). Write "why" and "hint" in the learner\'s language, never in German (German words may be quoted). ';

/**
 * Ask the AI for a short sentence in the learner's language whose natural German translation uses the
 * target word. Only simple words at the learner's level; known words are offered as scaffold, never required.
 * Rejected and retried once if the German reference does not contain the target word.
 */
export async function generateTask(
  word: Word,
  known: string[],
  s: Settings,
  f: Fetcher = fetch,
  grammar?: GrammarTopic,
  assoc: { mode?: "word" | "phrase" | "sentence"; companions?: Word[] } = {},
): Promise<TranslationTask> {
  const mode = assoc.mode ?? "sentence";
  const companions = assoc.companions ?? [];
  const partners = companions.map(targetLabel).join(", ");
  const g = grammar ? `The German translation must ALSO use this grammar point naturally: ${grammar.label} (${grammar.name}, CEFR ${grammar.level}). ` : "";
  const messages: Message[] = [
    {
      role: "system",
      content:
        `You write translation exercises for a learner of German (CEFR ${word.level}) whose own language is ${s.explainIn}. ` +
        (mode === "word"
          ? `Give ONLY the target word in ${s.explainIn}: a noun with its article (e.g. "the night"), a verb as infinitive (e.g. "to meet"). "reference" is the German word with its article (e.g. "die Nacht") or the infinitive. No other words. `
          : mode === "phrase"
            ? `Write ONE short phrase in ${s.explainIn} (2 to 5 words) whose German translation combines the target word${partners ? ` with: ${partners}` : ""}, plus only articles, prepositions or "und". `
            : `Write ONE short, natural, everyday sentence in ${s.explainIn} (4 to 12 words) whose German translation must use the target word${partners ? ` together with: ${partners} (they may also form a compound or a genitive, e.g. Auto + Bahn -> "Autobahn" or "die Bahn des Autos")` : ""}. `) +
        (mode === "word" ? "" : `Keep every other word simple, at CEFR ${word.level} or below. You may reuse these German words the learner knows: ${known.slice(0, 40).join(", ") || "(none yet)"}. `) +
        g +
        'Reply with JSON only: {"source": "<sentence in the learner language>", "reference": "<one correct German translation>"}',
    },
    {
      role: "user",
      content:
        mode === "word"
          ? `Target word: ${targetLabel(word)}\nOnly the word, no sentence.`
          : `Target word: ${targetLabel(word)}${partners ? `\nThe German MUST also contain: ${partners}` : ""}`,
    },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = parseTask(await chat(messages, s, f, 0.7), word, mode === "word" ? [] : companions, mode);
    if (task) return grammar ? { ...task, grammar: grammar.id } : task;
  }
  throw new Error("The tutor could not build a usable sentence for this word.");
}

export async function correctTranslation(
  word: Word,
  task: TranslationTask,
  answer: string,
  s: Settings,
  f: Fetcher = fetch,
  grammar?: GrammarTopic,
  companions: Word[] = [],
): Promise<Correction> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a strict, kind German teacher for exam learners. The learner translated a sentence into German. " +
        "Judge the learner's German: accept any correct, natural translation, not only the reference. " +
        "Fix only real errors (grammar, spelling, gender, case, word order, wrong meaning); keep the learner's words when they are correct. " +
        `If correct, "corrected" repeats the learner's sentence. List at most 3 errors; explain each in ${s.explainIn} in under 20 words. ` +
        HINT_RULE +
        (grammar ? `Also set "grammarUsed": true only if the learner's German correctly uses the grammar point ${grammar.label} (${grammar.name}). ` : "") +
        `Reply with JSON only: ${grammar ? CORRECTION_SHAPE.replace('"targetUsed":boolean,', '"targetUsed":boolean,"grammarUsed":boolean,') : CORRECTION_SHAPE}`,
    },
    {
      role: "user",
      content: `Sentence (${s.explainIn}): ${task.source}\nReference German: ${task.reference}\nTarget word: ${targetLabel(word)}${companions.length ? `\nAlso required: ${companions.map(targetLabel).join(", ")} (a compound or genitive is fine)` : ""}${grammar ? `\nGrammar point: ${grammar.label}` : ""}\nLearner's German: ${answer}`,
    },
  ];
  const parsed = parseCorrection(await chat(messages, s, f, 0));
  if (!parsed) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  parsed.targetUsed = containsTarget(word, answer, { compound: companions.length > 0 }); // our check wins over the model's claim
  parsed.companionsUsed = companions.filter((c) => containsTarget(c, answer, { compound: true })).map((c) => c.id);
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
        HINT_RULE +
        `Reply with JSON only: ${CORRECTION_SHAPE}`,
    },
    { role: "user", content: `Target word: ${targetLabel(word)}\nLearner sentence: ${sentence}` },
  ];
  const parsed = parseCorrection(await chat(messages, s, f, 0));
  if (!parsed) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  parsed.targetUsed = containsTarget(word, sentence);
  return parsed;
}
