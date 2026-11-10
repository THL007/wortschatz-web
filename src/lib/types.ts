import type { Card } from "ts-fsrs";
import type { DayLog, IntensiveSettings } from "./intensive";

export type Level = "A1" | "A2" | "B1" | "B2" | "C1";
export const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1"];

/** One word from public/data/<level>.json (wordhoard, CC BY-SA 4.0). */
export interface Word {
  id: string; // "n:zeit" | "v:sagen"
  lemma: string;
  word: string; // display form (noun capitalised)
  pos: "NOUN" | "VERB";
  rank: number; // frequency rank, 1 = most frequent
  level: Level;
  anchored: boolean; // level calibrated on official lists (A1-B1) vs estimated
  gender?: "der" | "die" | "das";
  plural?: string | null;
  p3?: string | null; // er/sie/es form
  pp?: string | null; // Partizip II
  forms?: string[]; // all attested forms, lowercase (wordhoard)
}

export type ExerciseKind = "article" | "plural" | "p3" | "pp" | "translate" | "write";

/** A grammar topic from the user's curated inventory (Nantia vault, grammar_de.csv). */
export interface GrammarTopic {
  id: string; // "g:PERFEKT"
  name: string;
  label: string; // German label shown to learners, e.g. "Perfekt"
  level: Level;
  category: string;
  order: number; // teaching order
}

export interface Exercise {
  kind: ExerciseKind;
  word: Word;
  /** tutor session: the grammar point this sentence also practises */
  grammar?: GrammarTopic;
  /** tutor session: word / phrase / sentence, from the target's associability */
  assocMode?: "word" | "phrase" | "sentence";
  /** tutor session: partner words that must appear (associability rule) */
  companions?: Word[];
  /** expected answer for deterministic kinds */
  answer?: string;
}

/** Per-word memory: one FSRS card per lemma (Nantia: one KNOWS edge per lemma). */
export interface Memory {
  card: Card;
  streak: number; // consecutive Good/Easy
  seen: number;
  /** associability: 0 = only with its article; higher = combinable with more words (see lib/assoc.ts) */
  assoc?: number;
  /** solved in an exercise within the allowed tries (up to 5) */
  learned?: boolean;
  /** the learner pressed "Too easy": never asked again (may still appear as a partner word) */
  retired?: boolean;
}

export interface Settings {
  level: Level;
  newPerRound: number;
  openRouterKey: string; // stays in this browser only
  openRouterModel: string;
  /** the learner's own language: translation source + explanations */
  explainIn: "English" | "Français";
  intensive: IntensiveSettings;
}

export interface Progress {
  version: 1;
  settings: Settings;
  memory: Record<string, Memory>;
  /** translation sentences not yet solved, revived the next time the word comes up (no new AI call) */
  tasks?: Record<string, { source: string; reference: string; lang: string; grammar?: string; mode?: "word" | "phrase" | "sentence" }>;
  /** Grammatik drills not yet solved, revived next time for that topic (no new AI call) */
  drills?: Record<string, { instruction: string; prompt: string; answer: string; lang: string }>;
  /** per local day: new words introduced and reviews done (intensive goal tracking) */
  daily?: Record<string, DayLog>;
}

export type Verdict = "right" | "close" | "wrong";
