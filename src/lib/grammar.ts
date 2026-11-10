// Grammatik drills: short AI-built exercises for one grammar topic of the learner's level.
// Topics come from the user's curated inventory (grammar.json); the AI only writes the exercise.
import { isDue } from "./srs";
import { chat, CORRECTION_SHAPE, firstJson, HINT_RULE, parseCorrection, type Correction, type Fetcher, type Message } from "./tutor";
import type { GrammarTopic, Level, Memory, Settings } from "./types";

export interface Drill {
  instruction: string; // in the learner's language
  prompt: string; // German, with ___ for a gap or a sentence to transform
  answer: string; // the expected German (the gap filler or the full transformed sentence)
}

let topicsCache: Promise<GrammarTopic[]> | null = null;
export function loadGrammar(): Promise<GrammarTopic[]> {
  topicsCache ??= fetch(`${import.meta.env.BASE_URL}data/grammar.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load the grammar topics (${r.status})`);
    return r.json() as Promise<GrammarTopic[]>;
  });
  return topicsCache;
}

export const topicsFor = (all: GrammarTopic[], level: Level) => all.filter((t) => t.level === level).sort((a, b) => a.order - b.order);

/** Due topics first (oldest first), then unseen topics in teaching order, then the rest by due date. */
export function pickTopics(topics: GrammarTopic[], memory: Record<string, Memory>, now: Date, n: number): GrammarTopic[] {
  const due = topics.filter((t) => memory[t.id] && isDue(memory[t.id], now)).sort((a, b) => +new Date(memory[a.id].card.due) - +new Date(memory[b.id].card.due));
  const fresh = topics.filter((t) => !memory[t.id]);
  const rest = topics.filter((t) => memory[t.id] && !isDue(memory[t.id], now)).sort((a, b) => +new Date(memory[a.id].card.due) - +new Date(memory[b.id].card.due));
  return [...due, ...fresh, ...rest].slice(0, n);
}

export function parseDrill(text: string): Drill | null {
  const j = firstJson(text);
  if (!j) return null;
  const instruction = String(j.instruction ?? "").trim();
  const prompt = String(j.prompt ?? "").trim();
  const answer = String(j.answer ?? "").trim();
  if (!instruction || !prompt || !answer || prompt.length > 220 || answer.length > 220) return null;
  return { instruction, prompt, answer };
}

export async function generateDrill(topic: GrammarTopic, s: Settings, f: Fetcher = fetch): Promise<Drill> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        `You write one short German grammar exercise for an exam learner at CEFR ${topic.level} whose own language is ${s.explainIn}. ` +
        `Topic: ${topic.label} (${topic.name}). Make it a gap fill (use ___ for the gap) or a short transformation (e.g. present to Perfekt), whichever fits the topic. ` +
        `One sentence, everyday vocabulary at CEFR ${topic.level} or below, exactly one correct answer. ` +
        `"instruction" is in ${s.explainIn} and says precisely what to do (e.g. which form, which case, what is in brackets). ` +
        '"answer" is only the words for the gap, or the full new sentence for a transformation. ' +
        'Reply with JSON only: {"instruction": string, "prompt": string, "answer": string}',
    },
    { role: "user", content: `Topic: ${topic.label}` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = parseDrill(await chat(messages, s, f, 0.8));
    if (d) return d;
  }
  throw new Error("The tutor could not build an exercise for this topic.");
}

const norm = (x: string) => x.toLowerCase().replace(/[.!?,;:"„“”]/g, "").replace(/\s+/g, " ").trim();

/** Exact match (ignoring case, punctuation, spacing) is right without asking the AI. */
export const exactDrillMatch = (drill: Drill, answer: string) => norm(answer) === norm(drill.answer);

export async function checkDrill(topic: GrammarTopic, drill: Drill, answer: string, s: Settings, f: Fetcher = fetch): Promise<Correction> {
  if (exactDrillMatch(drill, answer)) return { isCorrect: true, corrected: drill.answer, targetUsed: true, errors: [] };
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a strict, kind German teacher. Judge the learner's answer to a grammar exercise. " +
        "Accept any answer that is correct German and does what the instruction asks; the expected answer is one option. " +
        `Topic: ${topic.label}. "corrected" is the right answer for the gap or the full right sentence. List at most 3 errors; explain each in ${s.explainIn} in under 20 words. ` +
        HINT_RULE +
        `Set "targetUsed": true. Reply with JSON only: ${CORRECTION_SHAPE}`,
    },
    { role: "user", content: `Instruction: ${drill.instruction}\nExercise: ${drill.prompt}\nExpected: ${drill.answer}\nLearner: ${answer}` },
  ];
  const c = parseCorrection(await chat(messages, s, f, 0));
  if (!c) throw new Error("The tutor's answer could not be read. Nothing was graded.");
  c.targetUsed = true; // no target word in a drill
  return c;
}
