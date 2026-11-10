// Eval OpenRouter models for Wortschatz: sentence building + translation correction, using the app's own prompts.
// Run: OPENROUTER_API_KEY=... node scripts/eval_models.ts "$PWD" [model ...]   (never commit a key)
import { readFileSync } from "node:fs";

const appDir = process.argv[2];
const { generateTask, correctTranslation, containsTarget } = await import(`${appDir}/src/lib/tutor.ts`);
const key = process.env.OPENROUTER_API_KEY ?? "";
if (!key) throw new Error("missing key");

const load = (lv: string) => JSON.parse(readFileSync(`${appDir}/public/data/${lv}.json`, "utf8"));
const all = [...load("A1"), ...load("A2"), ...load("B1")];
const W = (id: string) => all.find((w: { id: string }) => w.id === id)!;

const MODELS = process.argv.slice(3).length ? process.argv.slice(3) : [
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6.1-sol",
  "openai/gpt-6.1-terra",
  "openai/gpt-6-luna",
  "google/gemini-4-argon",
  "google/gemini-3.8-flash",
  "mistralai/mistral-large-4-0",
  "deepseek/deepseek-v4.1-flash",
  "qwen/qwen3.8-flash",
];

const GEN = [
  { id: "n:nacht", lang: "English" },
  { id: "v:lassen", lang: "English" },
  { id: "v:treffen", lang: "Français" },
  { id: "n:problem", lang: "English" },
];

// Ground truth written by hand (German grammar facts).
const CORR = [
  { id: "n:nacht", source: "The night is long.", ref: "Die Nacht ist lang.", answer: "Die Nacht ist lang.", ok: true },
  { id: "n:zeit", source: "I have no time.", ref: "Ich habe keine Zeit.", answer: "Ich habe keine Zeit.", ok: true },
  { id: "v:treffen", source: "We meet tomorrow.", ref: "Wir treffen uns morgen.", answer: "Morgen treffen wir uns.", ok: true },
  { id: "n:kind", source: "I see the child every day.", ref: "Ich sehe das Kind jeden Tag.", answer: "Jeden Tag sehe ich das Kind.", ok: true },
  { id: "n:zeit", source: "I have no time.", ref: "Ich habe keine Zeit.", answer: "Ich habe kein Zeit.", ok: false, fix: "keine Zeit" },
  { id: "n:nacht", source: "The night is long.", ref: "Die Nacht ist lang.", answer: "Der Nacht ist lang.", ok: false, fix: "Die Nacht" },
  { id: "v:treffen", source: "Yesterday I met my friend.", ref: "Gestern habe ich meinen Freund getroffen.", answer: "Gestern ich habe meinen Freund getroffen.", ok: false, fix: "Gestern habe ich" },
  { id: "n:kind", source: "The children play in the garden.", ref: "Die Kinder spielen im Garten.", answer: "Die Kinder spielen in den Garten.", ok: false, fix: "im Garten" },
];

type Usage = { cost: number };
const usage: Record<string, Usage> = {};
// wrap fetch to read OpenRouter usage cost
const meteredFetch = (model: string) =>
  (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    body.usage = { include: true };
    const res = await fetch(url, { ...init, body: JSON.stringify(body) });
    const j = await res.json();
    usage[model].cost += j?.usage?.cost ?? 0;
    return new Response(JSON.stringify(j), { status: res.status });
  }) as typeof fetch;

const results: string[] = [];
for (const model of MODELS) {
  usage[model] = { cost: 0 };
  const s = { level: "A1", newPerRound: 5, openRouterKey: key, openRouterModel: model, explainIn: "English" };
  const f = meteredFetch(model);
  const t0 = Date.now();
  let genOk = 0;
  const samples: string[] = [];
  for (const g of GEN) {
    try {
      const t = await generateTask(W(g.id), ["das Jahr", "das Kind", "der Vater"], { ...s, explainIn: g.lang }, f);
      const words = t.source.split(/\s+/).length;
      if (words >= 3 && words <= 12) genOk++;
      samples.push(`${g.id}: "${t.source}" -> "${t.reference}"`);
    } catch (e) {
      samples.push(`${g.id}: ERROR ${(e as Error).message}`);
    }
  }
  let judged = 0, fixed = 0, fixNeeded = 0, failures: string[] = [];
  for (const c of CORR) {
    try {
      const r = await correctTranslation(W(c.id), { source: c.source, reference: c.ref }, c.answer, s, f);
      if (r.isCorrect === c.ok) judged++;
      else failures.push(`${c.answer} -> isCorrect=${r.isCorrect}`);
      if (!c.ok) {
        fixNeeded++;
        if (r.corrected.includes(c.fix!)) fixed++;
        else failures.push(`fix missing "${c.fix}" in "${r.corrected}"`);
      }
    } catch (e) {
      failures.push(`${c.answer}: ERROR ${(e as Error).message}`);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const line = `${model} | gen ${genOk}/${GEN.length} | judge ${judged}/${CORR.length} | fix ${fixed}/${fixNeeded} | ${secs}s | $${usage[model].cost.toFixed(4)}`;
  console.log(line);
  for (const x of samples) console.log("   " + x);
  for (const x of failures) console.log("   ! " + x);
  results.push(line);
}
console.log("\nSUMMARY");
for (const r of results) console.log(r);
void containsTarget;
