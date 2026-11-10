# Wortschatz

Learn the German words your exam uses most. Words are grouped by CEFR level (A1 to C1) and served **most frequent first**. Reviews are scheduled with **FSRS**, and an optional **AI tutor** (OpenRouter, your own key) corrects the sentences you write.

- Live: https://thl007.github.io/wortschatz-web/
- App (installable PWA): https://thl007.github.io/wortschatz-web/app/

## What is in v0.1

| Part | Status |
|---|---|
| Landing page with a playable der/die/das round | ✓ |
| App: Today, Round, Progress, Settings | ✓ |
| Exercises: article, plural, er/sie/es form, Partizip II | ✓ (from wordhoard forms) |
| Translate into German: AI writes a sentence in English or French with the target word, AI corrects your German | ✓ only with your own OpenRouter key and model id |
| Write-a-sentence with AI correction | ✓ same |
| FSRS-6 scheduling (ts-fsrs, fuzz off), progress in the browser | ✓ |
| Installable, offline after first visit | ✓ |
| Accounts, server sync | — |

## Run

```bash
npm install
npm run dev        # http://localhost:5173/wortschatz-web/
npm test           # unit + property tests
npm run build      # dist/
npm run deploy     # build and push dist/ to the gh-pages branch
```

Rebuild word data (needs the wordhoard CSV): `WORDHOARD_CSV=path/to/de_wordhoard.csv npm run data`.

## Data and licences

- Code: MIT (`LICENSE`).
- Word lists in `public/data/` are derived from [wordhoard](https://github.com/natema/wordhoard) v0.1.0 (CC BY-SA 4.0) with frequencies from OpenSubtitles 2018 via [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0). They are shared under **CC BY-SA 4.0** (`DATA_LICENSE.md`).
- Levels A1 to B1 are calibrated by wordhoard on official word lists; B2 and C1 are frequency estimates and are labelled as such.
- Goethe-Institut and Hueber material is **not** in this repository (local use only). Not affiliated with Goethe-Institut or telc.

## AI models

Default: `anthropic/claude-haiku-5.5`. Presets: Claude Sonnet 5.5 (strongest), GPT-6 Luna (cheap, slower). Picked with `scripts/eval_models.ts` on 2026-11-10: 4 AI-built sentences + 8 hand-checked translations (4 correct, 4 with gender/case/word-order errors) per model, using the app's own prompts. All three presets scored 4/4, 8/8 and 4/4 fixes. Small test; real use may differ.

## Design

Built with the Hallmark design skill, theme Hum (playful): cream paper, card-stock controls, Chillax type. Stamps and waivers are at the top of `src/styles/landing.css` and `src/styles/app/app.css`.

## AI tutor and privacy

Your OpenRouter key is stored in your browser's local storage and sent only to `openrouter.ai`. A translation exercise makes one call to build the sentence (retried once if its German does not contain the target word) and one to correct your answer. Only the target word's FSRS card is graded, and only if your German really contains it. Progress never leaves your device unless you export it. Tutor corrections can be wrong.
