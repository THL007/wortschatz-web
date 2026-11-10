import { useState } from "react";
import { reset } from "../lib/store";
import { MODEL_PRESETS } from "../lib/tutor";
import type { Minutes } from "../lib/intensive";
import type { Progress, Settings } from "../lib/types";

interface Props {
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
}

export function SettingsScreen({ progress, update }: Props) {
  const s = progress.settings;
  const [key, setKey] = useState(s.openRouterKey);
  const [model, setModel] = useState(s.openRouterModel);
  const [saved, setSaved] = useState(false);
  const isCustom = !MODEL_PRESETS.some((m) => m.id === model);
  const [confirming, setConfirming] = useState(false);

  const set = (patch: Partial<Settings>) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify({ ...progress, settings: { ...progress.settings, openRouterKey: "" } }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wortschatz-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="screen settings" aria-labelledby="settings-head">
      <h1 id="settings-head">Settings</h1>

      <div className="panel form">
        <h2>Practice</h2>
        <fieldset className="field">
          <legend>New words per round</legend>
          <div className="segmented" role="radiogroup" aria-label="New words per round">
            {[3, 5, 10].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={s.newPerRound === n} className="seg" onClick={() => set({ newPerRound: n })}>{n}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Your language (sentences to translate and explanations)</legend>
          <div className="segmented" role="radiogroup" aria-label="Your language">
            {(["English", "Français"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={s.explainIn === l} className="seg" onClick={() => set({ explainIn: l })}>{l}</button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="panel form">
        <h2>Intensive mode</h2>
        <p className="note">For an exam soon: the same tutor, word and Grammatik rounds, just more of them. A daily new-word goal from your exam date, official-list words first, and no review scheduled after your exam.</p>
        <fieldset className="field">
          <legend>Status</legend>
          <div className="segmented" role="radiogroup" aria-label="Intensive mode">
            {[false, true].map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={s.intensive.on === on} className="seg" onClick={() => set({ intensive: { ...s.intensive, on } })}>{on ? "On" : "Off"}</button>
            ))}
          </div>
        </fieldset>
        {s.intensive.on && (
          <>
            <label className="field">
              <span>Exam date</span>
              <input type="date" value={s.intensive.examDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ intensive: { ...s.intensive, examDate: e.target.value } })} />
            </label>
            <fieldset className="field">
              <legend>Time per day</legend>
              <div className="segmented" role="radiogroup" aria-label="Minutes per day">
                {([15, 30, 60] as Minutes[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={s.intensive.minutes === m} className="seg" onClick={() => set({ intensive: { ...s.intensive, minutes: m } })}>{m} min</button>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>

      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          set({ openRouterKey: key.trim(), openRouterModel: model.trim() });
          setSaved(true);
        }}
      >
        <h2>AI tutor</h2>
        <p className="note">
          Translation sentences and corrections use your own <a href="https://openrouter.ai/keys">OpenRouter</a> key. The key stays in this browser and is sent only to openrouter.ai. Without it, rounds use the word exercises only. A translated sentence costs two model calls on your OpenRouter account (well under a cent with the recommended model).
        </p>
        <label className="field">
          <span>OpenRouter API key</span>
          <input type="password" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); }} autoComplete="off" spellCheck={false} />
        </label>
        <fieldset className="field">
          <legend>Model</legend>
          <div className="choices" role="radiogroup" aria-label="Model">
            {MODEL_PRESETS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={model === m.id} className="choice" onClick={() => { setModel(m.id); setSaved(false); }}>
                <strong>{m.label}</strong>
                <span>{m.note}</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={isCustom} className="choice" onClick={() => { setModel(isCustom ? model : ""); setSaved(false); }}>
              <strong>Other model</strong>
              <span>Any model id from openrouter.ai/models</span>
            </button>
          </div>
          {isCustom && (
            <label className="field">
              <span>Model id</span>
              <input value={model} onChange={(e) => { setModel(e.target.value); setSaved(false); }} placeholder="provider/model-name" autoComplete="off" spellCheck={false} />
            </label>
          )}
        </fieldset>
        <div className="form__actions">
          <button className="btn btn--primary" type="submit">Save tutor settings</button>
          {saved && <span role="status">Saved.</span>}
        </div>
      </form>

      <div className="panel form">
        <h2>Your data</h2>
        <p className="note">Progress is stored only on this device. Export it to keep a copy; the key is left out.</p>
        <div className="form__actions">
          <button className="btn" type="button" onClick={exportProgress}>Export progress</button>
          {!confirming ? (
            <button className="btn btn--danger" type="button" onClick={() => setConfirming(true)}>Reset progress</button>
          ) : (
            <span className="confirm" role="alert">
              Delete all progress on this device?
              <button className="btn btn--danger" type="button" onClick={() => { reset(); location.reload(); }}>Delete</button>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>Keep it</button>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
