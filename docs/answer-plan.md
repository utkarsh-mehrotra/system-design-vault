# Plan: in-depth answers for the vault

Status: proposal · 2026-11-21

Today every card has a one-paragraph outline: a list of the things a strong answer mentions. This document first asks whether deeper answers are worth writing at all, then lays out how to write them if so.

---

## Part 1 — Are detailed answers even needed?

### The case for detailed answers

1. **Outlines assume you already know the material.** "Fencing tokens, single writer per partition, RPO/RTO" is a good checklist for someone who can already explain each term. For anyone who can't, it's a list of words to look up. The vault can't teach a gap it only names.
2. **Staff interviews are won on the follow-ups.** The opening answer is rarely the problem. The trouble starts at "the lease holder pauses for 40 seconds, what now?" or "your idempotency store is down, do you fail open or closed?" An outline gives you nothing for the second and third question.
3. **Numbers need context.** "30–40% headroom", "p99 dominated by…", "10x read growth". Without the reasoning behind a figure, you can't defend it when an interviewer pushes back.
4. **Recall is checked against something.** Practice works when you answer first, then compare with a reference. A one-line reference makes the comparison shallow: you "covered" it if you said the right nouns.
5. **The page is now public and shareable.** A reference that explains its reasoning helps other readers too, not just its author.

### The case against

1. **Interviews punish recitation.** Interviewers spot memorised essays quickly, and a scripted answer to a question that has drifted slightly reads worse than a thinner answer that is your own. Long model answers push people toward memorising.
2. **The depth already exists elsewhere.** *Designing Data-Intensive Applications*, the Google SRE books, the original papers, and engineering blogs from Stripe, AWS and Cloudflare cover this material better than 93 short essays can. Re-writing it is low value and invites mistakes.
3. **Volume is a maintenance burden.** 93 × 1,500 words is about 140k words. Every error is a trap you study into yourself, and every update has to be made in many places.
4. **Generating beats reading.** For retention, writing your own answer and then checking it beats reading a polished one. Long answers make passive reading the easy path.
5. **The index stops being scannable.** The vault works because a pass over 93 questions takes minutes. Essays turn a drill tool into a textbook.
6. **Staff signal is judgment, not coverage.** The bar is choosing well under constraints and explaining why. Encyclopedic answers optimise the wrong thing.

### Verdict

**Yes, add depth, but not essays.** The weak spot in the current outlines isn't missing facts. It's that they leave out the four things interviews actually probe:

| Missing today | What to add |
|---|---|
| *Why* | A decision rule ("choose X when…, Y when…") and the trade-off being made |
| *How much* | The few numbers that matter, with how they were derived |
| *What breaks* | Failure modes and pitfalls specific to this design |
| *What next* | The 3–4 follow-up questions an interviewer will ask, each with a short hint |

Hard limits that address the "against" side:

- **Length budget:** 250–450 words per card, all structured fields, no flowing prose. The full set is roughly 30–40k words, not 140k.
- **Answer hidden by default:** in practice mode you attempt the answer first, then reveal it (see Phase 4). This keeps generating ahead of reading.
- **Link instead of re-explaining:** each card cites 1–3 canonical sources for background. The card holds only what's specific to the question.
- **Deep dives only where they pay off:** about 15 "anchor" questions get a worked example (Part 2, Phase 3). These are the topics most interviews eventually reach, and where a walk-through shows something the bullets can't.

---

## Part 2 — The plan

### Answer schema (added to `questions.json`)

```jsonc
"answer": {
  "thesis": "One or two sentences: the position you'd open with.",
  "points": ["4–7 key points, each one line, in the order you'd say them"],
  "decision": "When to choose what. The rule of thumb and the trade-off.",
  "numbers": ["Only numbers you can derive or defend, with the derivation"],
  "pitfalls": ["Specific ways this goes wrong in production or in the interview"],
  "followups": [{ "q": "Likely follow-up", "hint": "One-line direction" }],
  "example": "Optional: a 3–6 sentence concrete scenario",
  "deepDive": "Optional, anchor questions only: markdown worked example",
  "related": ["question-ids"],
  "sources": [{ "title": "…", "url": "…" }]
}
```

- `a` (today's outline) stays until a card's `answer` is written. The page shows `answer` when present and falls back to `a`.
- `scripts/build.mjs` gets new checks: required fields, word budget per card, `related` ids exist, no duplicate sources, and a warning when `numbers` is empty for Scale and Data cards.

### Phase 0 — Calibrate (1 session)

- Add the schema, the renderer (structured sections in the right-hand pane, collapsible on mobile), and the build checks.
- Write **3 pilot cards** covering different kinds of question: one technical, one diagnostic, one judgment call:
  1. `build-idempotency-write-api-clients` (technical)
  2. `hot-partition-shows-up-2` (incident/diagnosis)
  3. `defend-design-trade-off-skeptical` (judgment)
- **You review them.** Length, tone and depth get fixed here before anything scales up. Every later card copies the pilots' shape.

### Phase 1 — Clean up the merged outlines (1 session)

The 48 merged cards show two overlapping outlines. Fold each pair into a single outline with no repetition. This is fast, improves the page immediately, and gives Phase 2 a clean starting point.

### Phase 2 — Write the cards by category ✅ done (all 93, 2026-11-21)

Order by how often each topic comes up in staff loops and how much depth it needs:

| # | Category | Cards | Notes |
|---|---|---|---|
| 1 | Consistency & Transactions | 10 | Highest follow-up density; many anchors |
| 2 | Reliability & Failure | 9 | |
| 3 | Data & Storage | 12 | Numbers required (sizes, throughput) |
| 4 | Scale & Traffic | 10 | Numbers required (capacity math) |
| 5 | Streaming & Async | 9 | |
| 6 | Caching & Performance | 7 | |
| 7 | APIs & Boundaries | 9 | |
| 8 | Observability & Operations | 8 | |
| 9 | Evolution, Cost & Trade-offs | 8 | Shorter; decision rules matter most |
| 10 | Judgment & Leadership | 11 | No `numbers`; `example` is a short story instead |

For each batch:
1. Draft the cards against the schema and the pilots.
2. **Check the accuracy** of anything specific: protocol behaviour, product guarantees (e.g. what Kafka transactions do and don't cover), and every number. Check sources by actually opening them; never cite from memory.
3. Re-check the level (Fundamental / Intermediate / Advanced). Several are mislabelled today, e.g. SLO and runbook questions marked Fundamental.
4. Fill in `related` links within the category and to earlier ones.
5. Run `node scripts/build.mjs`, deploy, and you skim the batch in the side-by-side view.

### Phase 3 — Anchor deep dives (about 3 sessions, 15 topics)

A worked example of 800–1,500 words, shown behind a "Deep dive" toggle:

1. Idempotency keys end to end, including the duplicate that arrives while the first request is still running
2. Saga + outbox + inbox for a three-service order flow
3. Hot partition: detection → mitigation → re-keying online
4. Zero-downtime migration of a billion-row table (expand/contract with timings)
5. Two-region failover with fencing, and the RPO/RTO arithmetic
6. Exactly-once in Kafka/Flink: what is and isn't covered, sink idempotency
7. Rate limiting: token bucket maths, distributed counters, the local-approximation error
8. Cache stampede: coalescing vs early refresh vs leases, with a timeline
9. Capacity sizing: 50k RPS at a 100 ms deadline, as a full back-of-envelope calculation
10. Retry storms: the amplification maths and retry budgets
11. SLO burn-rate alerts: multi-window maths with a worked lending example
12. Delayed-job scheduler for millions of jobs a day: storage layout, leases, catch-up
13. Debugging p99: a worked investigation from metric → exemplar → trace → cause
14. Where consensus actually sits: etcd/ZooKeeper vs quorum stores vs gossip
15. Partial failure with fan-out: required vs optional calls, a degraded-response design

### Trap focus (added 2026-11-21) ✅ done

The vault's main job is trap questions (full design prep happens elsewhere). Every card now has a `trap` block (tempting wrong answer, why it fails, what's probed, what to say) shown first, and a **Trap drill** mode drills 93 traps + 281 follow-ups with Missed/Shaky/Got-it ratings: missed returns in a minute, shaky in a day, got-it after 3, 6, 12… days (max 60). Drill state is included in export/import.

### Phase 4 — Practice mode (superseded by Trap drill above)

- "Practice" toggle: the right-hand pane shows only the question and an empty notes box. **Reveal** shows the answer.
- After revealing, rate yourself: *Got it / Shaky / Missed*. This replaces the plain "reviewed" checkbox, and old "reviewed" ticks become *Got it*.
- Review queue: *Missed* comes back soonest, then *Shaky*; *Got it* returns after a longer, growing interval (simple spaced repetition, stored per browser and included in export/import).
- Drill a single card's follow-ups: each follow-up becomes its own mini prompt.

### Quality rules (apply to every card)

- Open with a position, not a survey. The `thesis` must commit to something.
- Every number has a derivation or a source.
- Name real systems only where you're sure of the behaviour; otherwise describe the mechanism.
- No more than 450 words outside `deepDive`. If it doesn't fit, it's either two questions or belongs in `sources`.
- Pitfalls are specific ("the idempotency key is stored after the side effect, so a crash between them double-charges"), never generic ("watch out for edge cases").

### Effort and sequencing

| Phase | Sessions | Output |
|---|---|---|
| 0 Calibrate | 1 | Schema, renderer, checks, 3 approved pilots |
| 1 Clean merged outlines | 1 | 48 clean outlines |
| 2 Cards by category | ~9 | 93 structured answers |
| 3 Deep dives | ~3 | 15 worked examples |
| 4 Practice mode | 1 | Reveal, self-rating, review queue |

Phase 0 gates everything else. Phases 1 and 4 can happen in any order. Phase 3 starts once each anchor's category is done in Phase 2.

---

## Appendix — calibration sample (illustrative, not final)

**Build idempotency for a write API that clients and your own gateway can both retry.**

- **Thesis:** Make the client name the operation with an idempotency key, record that key atomically with the effect, and replay the stored result for any repeat. Everything else is handling the edge cases of that one rule.
- **Points:**
  1. Client generates a key per *logical* operation (not per HTTP attempt) and resends it on every retry. The gateway forwards it untouched and never mints its own.
  2. Scope the key per tenant/account, and store it with a hash of the request body.
  3. Claim the key and perform the write in the same transaction (or claim, write, and finalise with a state machine if the effect is external).
  4. A repeat with a completed key returns the stored status code and body.
  5. A repeat while the first attempt is still running returns 409/425 with Retry-After. Don't block, and don't run it twice.
  6. Same key but a different body → 422. That's a client bug, not a retry.
  7. Keys expire after a window longer than the longest client retry horizon (often 24 h).
- **Decision:** Same-database transactional claim when the effect is local. For external side effects (payments, email), use a `pending → done/failed` record and make the downstream call idempotent with the same key.
- **Numbers:** Storage ≈ writes/day × (key + hash + response size) × retention. At 5M writes/day, 1 KB stored per key and 24 h retention, that's about 5 GB, small enough for the primary database.
- **Pitfalls:** Storing the key *after* the side effect (a crash in between double-applies). Gateway-generated keys (each retry looks new). Caching the error from a transient failure as if it were final. Expiry shorter than the client's retry window.
- **Follow-ups:**
  - *The idempotency store is down. Fail open or closed?* → Closed for money movement, open (with dedupe downstream) for low-risk writes. Say which and why.
  - *How does this interact with sagas?* → Each step reuses the parent key plus the step name.
  - *Multi-region?* → Route a key to its home region, or accept a dedupe window across regions. The key's scope decides.
- **Sources:** Stripe API docs, "Idempotent requests"; Brandur Leach, "Implementing Stripe-like idempotency keys in Postgres".
