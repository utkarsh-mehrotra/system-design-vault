# System Design Vault

**Live:** [Vercel](https://system-design-vault.vercel.app/) · [GitHub Pages](https://utkarsh-mehrotra.github.io/system-design-vault/)

Staff-level system design **trap-question** prep: 187 questions in 14 categories (including Security, Delivery & Infrastructure, AI & LLM Systems, and Domain Traps across 12 industries). Each card has the trap (tempting wrong answer and what to say instead), a 60-second answer, key points, numbers, pitfalls and follow-ups. **Trap drill** mode quizzes traps and follow-ups with spaced repetition.

## Files

- `questions.json` — **single source of truth** (questions, categories, topics, tags).
- `scripts/build.mjs` — validates `questions.json` and generates `data.js` and `system_design_vault_merged.md`.
- `index.html` — static page; loads `data.js`. No build needed at deploy time.
- `answers/<id>.json` — in-depth answer per card (trap, thesis, 60-second answer, points, numbers, pitfalls, follow-ups, sources).
- `coverage.json` — concept coverage map; the build checks every card is mapped and writes `docs/coverage.md`.
- `scripts/add-cards.mjs` — adds a batch of new cards (`{id: {meta, answer}}`) and keeps ordering.

## Editing questions

1. Edit `questions.json`. Keep `id` stable once published (progress and deep links are keyed by it).
2. Run `node scripts/build.mjs`.
3. Commit `questions.json`, `data.js` and the regenerated markdown.

`legacy` holds the v1 array indices so old browser progress migrates once; it can be removed later.

## Deploy

Vercel: `npx vercel --prod` from this folder (static, no framework). GitHub Pages serves `main` from the repo root and redeploys on every push.

## Roadmap

See `docs/answer-plan.md` for the plan to add in-depth answers (and the debate on whether they are worth it).

## Browser storage (progress)

| Key | Contents |
|---|---|
| `sdv-done-v2` | Mastered questions `{id: 1}` (kept from earlier versions; set when a card is rated Solid) |
| `sdv-conf-v1` | Confidence per question: `missed` / `shaky` / `solid` |
| `sdv-drill-v1` | Trap drill spaced-repetition state per prompt |
| `sdv-theme` | `light` (default), `dark` or `auto` |
| `sdv-recall` | Whether "Hide outline (test yourself)" is on |
| `sdv-sync-rev` | Revision of the last cloud sync (only when signed in) |

Progress lives in this browser's localStorage; optional Google sign-in syncs it across devices via Firebase (see `docs/google-sync-setup.md`, config in `firebase-config.js`, rules in `firestore.rules`).

## Keyboard

`/` or `⌘K` search · `J`/`K` or `↓`/`↑` next/previous question · `Space` hide outline / reveal next section · `1` `2` `3` rate Missed/Shaky/Solid · Trap drill: `Space` reveal, `1` `2` `3` rate, `←` `→` previous/next.
