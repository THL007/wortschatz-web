import { useCallback, useEffect, useState } from "react";
import { load, save } from "../lib/store";
import type { Progress } from "../lib/types";
import { Today } from "./Today";
import { Round } from "./Round";
import { GrammarRound } from "./GrammarRound";
import { ProgressScreen } from "./ProgressScreen";
import { SettingsScreen } from "./SettingsScreen";

export type Route = "today" | "round" | "tutor" | "grammar" | "sprint" | "progress" | "settings";

const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, "");
  if (r === "translate") return "tutor"; // old link
  return r === "round" || r === "tutor" || r === "grammar" || r === "sprint" || r === "progress" || r === "settings" ? r : "today";
};

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [progress, setProgress] = useState<Progress>(load);

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    setProgress((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const go = (r: Route) => {
    location.hash = r === "today" ? "/" : `/${r}`;
  };

  return (
    <div className="shell">
      <header className="topbar">
        <a className="topbar__mark" href="../">Wortschatz</a>
        <nav className="tabs" aria-label="App">
          <a href="#/" aria-current={["today", "round", "tutor", "grammar", "sprint"].includes(route) ? "page" : undefined}>Today</a>
          <a href="#/progress" aria-current={route === "progress" ? "page" : undefined}>Progress</a>
          <a href="#/settings" aria-current={route === "settings" ? "page" : undefined}>Settings</a>
        </nav>
      </header>
      <main className="main">
        {route === "today" && <Today progress={progress} update={update} onStart={() => go("round")} onTutor={() => go("tutor")} onGrammar={() => go("grammar")} onSprint={() => go("sprint")} />}
        {route === "round" && <Round key="mixed" mode="mixed" progress={progress} update={update} onDone={() => go("today")} />}
        {route === "tutor" && <Round key="tutor" mode="tutor" progress={progress} update={update} onDone={() => go("today")} />}
        {route === "grammar" && <GrammarRound progress={progress} update={update} onDone={() => go("today")} />}
        {route === "sprint" && <Round key="sprint" mode="sprint" progress={progress} update={update} onDone={() => go("today")} />}
        {route === "progress" && <ProgressScreen progress={progress} />}
        {route === "settings" && <SettingsScreen progress={progress} update={update} />}
      </main>
    </div>
  );
}
