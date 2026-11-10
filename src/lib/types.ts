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

export interface Exercise {
  kind: ExerciseKind;
  word: Word;
  /** expected answer for deterministic kinds */
  answer?: string;
}

/** Per-word memory: one FSRS card per lemma (Nantia: one KNOWS edge per lemma). */
export interface Memory {
  card: Card;
  streak: number; // consecutive Good/Easy
  seen: number;
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
  /** per local day: new words introduced and reviews done (intensive goal tracking) */
  daily?: Record<string, DayLog>;
}

export type Verdict = "right" | "close" | "wrong";
