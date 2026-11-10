import { useCallback, useEffect, useState } from "react";
import { load, save } from "../lib/store";
import type { Progress } from "../lib/types";
import { Today } from "./Today";
import { Round } from "./Round";
import { ProgressScreen } from "./ProgressScreen";
import { SettingsScreen } from "./SettingsScreen";

export type Route = "today" | "round" | "progress" | "settings";

const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, "");
  return r === "round" || r === "progress" || r === "settings" ? r : "today";
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
          <a href="#/" aria-current={route === "today" || route === "round" ? "page" : undefined}>Today</a>
          <a href="#/progress" aria-current={route === "progress" ? "page" : undefined}>Progress</a>
          <a href="#/settings" aria-current={route === "settings" ? "page" : undefined}>Settings</a>
        </nav>
      </header>
      <main className="main">
        {route === "today" && <Today progress={progress} update={update} onStart={() => go("round")} />}
        {route === "round" && <Round progress={progress} update={update} onDone={() => go("today")} />}
        {route === "progress" && <ProgressScreen progress={progress} />}
        {route === "settings" && <SettingsScreen progress={progress} update={update} />}
      </main>
    </div>
  );
}
