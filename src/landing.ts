import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });

// Landing page: the live article round (signature), the level picker and the install button.
// Content is complete without scripting; this file only adds interaction.

// The five most frequent A1 nouns in public/data/A1.json (wordhoard, CC BY-SA 4.0).
const ROUND = [
  { word: "Jahr", gender: "das" },
  { word: "Kind", gender: "das" },
  { word: "Vater", gender: "der" },
  { word: "Geld", gender: "das" },
  { word: "Nacht", gender: "die" },
] as const;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

function initRound() {
  const wordEl = $("#round-word");
  const countEl = $("#round-count");
  const resultEl = $("#round-result");
  const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".tile"));
  if (!wordEl || !countEl || !resultEl) return;
  let i = 0;
  let right = 0;
  let locked = false;

  const show = () => {
    wordEl.textContent = ROUND[i].word;
    countEl.textContent = `${i + 1} of ${ROUND.length}`;
    tiles.forEach((t) => (t.dataset.state = ""));
    locked = false;
  };

  tiles.forEach((tile) =>
    tile.addEventListener("click", () => {
      if (locked) return;
      locked = true;
      const item = ROUND[i];
      const ok = tile.dataset.g === item.gender;
      if (ok) right++;
      tile.dataset.state = ok ? "right" : "wrong";
      if (!ok) tiles.find((t) => t.dataset.g === item.gender)!.dataset.state = "right";
      resultEl.textContent = ok ? `Richtig: ${item.gender} ${item.word}.` : `It is ${item.gender} ${item.word}.`;
      window.setTimeout(() => {
        i++;
        if (i < ROUND.length) return show();
        wordEl.textContent = `${right} / ${ROUND.length}`;
        countEl.textContent = "Done";
        resultEl.textContent = "570 more A1 words wait in the app.";
        tiles.forEach((t) => (t.disabled = true));
      }, 1100);
    }),
  );
}

function initLevels() {
  const pills = Array.from(document.querySelectorAll<HTMLButtonElement>(".pill"));
  const out = $("#level-out");
  if (!out) return;
  pills.forEach((pill) =>
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.setAttribute("aria-checked", String(p === pill)));
      const { level, n, first } = pill.dataset;
      const note = level === "B2" || level === "C1" ? " Levels here are estimates." : "";
      out.innerHTML = "";
      out.append(`${level} has `);
      const mark = document.createElement("mark");
      mark.textContent = `${n} nouns and verbs`;
      out.append(mark, `. You start with `);
      const w = document.createElement("span");
      w.lang = "de";
      w.textContent = first ?? "";
      out.append(w, `.${note}`);
    }),
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function initInstall() {
  const btn = $<HTMLButtonElement>("#install-btn");
  let deferred: InstallPromptEvent | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    if (btn) btn.hidden = false;
  });
  btn?.addEventListener("click", async () => {
    if (!deferred) return;
    await deferred.prompt();
    deferred = null;
    btn.hidden = true;
  });
}

initRound();
initLevels();
initInstall();
