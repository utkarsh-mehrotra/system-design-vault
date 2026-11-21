# Expansion plan: 93 → ~187 cards (approved 2026-11-21: "cover all domains, do everything")

Workflow per batch: write `{id: {meta, answer}}` → `node scripts/add-cards.mjs batch.json` → `node scripts/build.mjs` → commit. Every card uses the full answer schema including `trap`. Avoid repeating existing cards: link to them in `related` instead.

Final step: `coverage.json` concept map + build check, then deploy.

## Concept cards (46)
- [ ] data: isolation-levels-anomalies, optimistic-pessimistic-concurrency, replication-topologies (topic "Concurrency & replication"); secondary-indexes-sharded (topic "Partitioning & hot keys"); large-file-uploads, approximate-counting-sketches, geospatial-nearby-queries (topic "Specialised storage & queries")
- [ ] consistency: distributed-locks-fencing, clocks-ordering-lww ("Locks & clocks"); flash-sale-never-oversell, double-entry-ledger-design ("Money & inventory correctness"); event-sourcing-cqrs-trap ("Event sourcing & CQRS")
- [ ] caching: redis-down-fail-open, eviction-policies-working-set ("Caching strategy")
- [ ] reliability: health-checks-liveness-readiness, graceful-shutdown-draining ("Health checks & lifecycle"); metastable-failures, third-party-worse-sla ("Failure modes & degradation")
- [ ] streaming: feed-fanout-celebrity ("Fan-out & feeds"); outgoing-webhooks-design ("Webhooks"); stream-windows-late-data, kafka-partitions-rebalance ("Stream processing")
- [ ] apis: rest-grpc-graphql, realtime-delivery-polling-websockets, bulk-batch-apis-partial ("API styles & real-time")
- [ ] security (8): sessions-vs-jwt-revocation, authorization-models-idor, service-to-service-auth, secrets-rotation, encryption-key-management, tokenization-pci-pii, credential-stuffing-ato, audit-logs-tamper-evident
- [ ] infra (6): deploy-strategies-compared, global-config-pushes, autoscaling-pitfalls, serverless-connection-exhaustion, active-active-cost, estimation-dau-qps-storage
- [ ] observability: incident-commander-first-15 ("Incident response")
- [ ] judgment (6): cross-team-migration-no-authority, push-back-deadline-vp, incident-you-caused, tech-debt-vs-features ("Influence & delivery"); consistency-vs-local-optimisation, measure-architecture-change ("Measuring & standardising")

## AI & LLM (7)
- [ ] rag-design-traps, vector-index-tradeoffs ("Retrieval & vectors"); llm-serving-latency-cost, caching-llm-outputs, llm-provider-limits-fallback ("Serving & cost"); llm-rollouts-evals, llm-guardrails-abuse ("Quality & safety")

## Domain traps (41)
- [ ] Fintech & lending (5): payment-state-machine-provider, chargebacks-refunds-reversals, money-rounding-currency, interest-accrual-eod-batch, kyc-aml-pipeline
- [ ] Adtech (4): rtb-bidding-100ms, budget-pacing-overspend, frequency-capping-scale, ad-event-counting-attribution
- [ ] E-commerce & marketplaces (4): checkout-promotions-consistency, catalog-search-freshness, marketplace-split-payouts, listing-review-fraud
- [ ] Ride-hailing & delivery (3): dispatch-matching-shortage, driver-location-updates-scale, surge-pricing-eta
- [ ] Supply chain & logistics (4): available-to-promise-inventory, offline-scanner-events-ordering, partner-integrations-reconcile, route-optimisation-batch-realtime
- [ ] Edtech (4): exam-deadline-submission-spike, proctoring-time-integrity, live-classes-scale, offline-progress-sync
- [ ] Media & streaming (3): video-transcoding-pipeline, adaptive-bitrate-cdn-live, view-counting-trending
- [ ] Social & messaging (3): chat-ordering-receipts-multidevice, presence-at-scale, content-moderation-pipeline
- [ ] Travel & booking (3): booking-holds-no-double, stale-prices-external-inventory, overbooking-policy
- [ ] SaaS & B2B (2): usage-metering-billing, per-tenant-customisation
- [ ] Gaming (3): realtime-game-state-sync, leaderboards-scale, matchmaking-fair-fast
- [ ] Healthcare (3): consent-audit-access, interoperability-fhir, break-glass-access
