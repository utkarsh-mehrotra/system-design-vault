# System Design Vault

Staff-level system design **trap-question** prep: 93 questions in 10 categories. Each card has the trap (tempting wrong answer and what to say instead), a 60-second answer, key points, numbers, pitfalls and follow-ups. **Trap drill** mode quizzes traps and follow-ups with spaced repetition.

## Files

- `questions.json` — **single source of truth** (questions, categories, topics, tags).
- `scripts/build.mjs` — validates `questions.json` and generates `data.js` and `system_design_vault_merged.md`.
- `index.html` — static page; loads `data.js`. No build needed at deploy time.

## Editing questions

1. Edit `questions.json`. Keep `id` stable once published (progress and deep links are keyed by it).
2. Run `node scripts/build.mjs`.
3. Commit `questions.json`, `data.js` and the regenerated markdown.

`legacy` holds the v1 array indices so old browser progress migrates once; it can be removed later.

## Deploy

Vercel: `npx vercel --prod` from this folder (static, no framework).

## Roadmap

See `docs/answer-plan.md` for the plan to add in-depth answers (and the debate on whether they are worth it).
