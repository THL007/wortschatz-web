import { DEFAULT_MODEL } from "./tutor";
import type { Level, Progress, Settings, Word } from "./types";

const KEY = "wortschatz.progress.v1";

export const defaultSettings: Settings = {
  level: "A1",
  newPerRound: 5,
  openRouterKey: "",
  openRouterModel: DEFAULT_MODEL,
  explainIn: "English",
  intensive: { on: false, examDate: "", minutes: 30 },
};

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (p.version === 1) return { ...p, settings: { ...defaultSettings, ...p.settings, openRouterModel: p.settings?.openRouterModel || DEFAULT_MODEL, intensive: { ...defaultSettings.intensive, ...p.settings?.intensive } } };
    }
  } catch {
    /* corrupted storage: start fresh */
  }
  return { version: 1, settings: defaultSettings, memory: {} };
}

export function save(p: Progress) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function reset() {
  localStorage.removeItem(KEY);
}

const cache = new Map<Level, Promise<Word[]>>();
export function loadLevel(level: Level): Promise<Word[]> {
  if (!cache.has(level)) {
    cache.set(
      level,
      fetch(`${import.meta.env.BASE_URL}data/${level}.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${level} words (${r.status})`);
        return r.json() as Promise<Word[]>;
      }),
    );
  }
  return cache.get(level)!;
}
