import { useEffect, useState } from "react";
import { loadLevel } from "../lib/store";
import type { Level, Word } from "../lib/types";

export type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; words: Word[] };

export function useLevel(level: Level, attempt = 0): Loaded {
  const [res, setRes] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    setRes({ state: "loading" });
    loadLevel(level)
      .then((words) => alive && setRes({ state: "ready", words }))
      .catch((e: Error) => alive && setRes({ state: "error", message: e.message }));
    return () => {
      alive = false;
    };
  }, [level, attempt]);
  return res;
}

export const estimated = (level: Level) => level === "B2" || level === "C1";
