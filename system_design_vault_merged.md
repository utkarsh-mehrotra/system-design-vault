# Staff Design Vault (merged, grouped)

Private study copy. [mine] = original question; [ref] = title from a third-party list. All answer outlines written independently.

## Scale & Traffic (14)

### Request path & scaling basics
1. **Walk one request from DNS to the database and back. Where does each millisecond go?** [mine · Fundamental · Latency, Networking]
   - Name every hop: DNS, TLS, CDN or edge, load balancer, service, cache, database. Give each hop a latency budget, then say which hops dominate p99 and why.
2. **Read traffic grows 10x in one quarter. What do you change first, and what do you refuse to change?** [mine · Intermediate · Scaling, Caching]
   - Measure the bottleneck before acting. Cache and add read replicas before sharding. Hold the API contract and data model steady so clients and teams do not have to move.
3. **Choose a load balancing strategy for long-lived connections versus short RPCs.** [mine · Intermediate · Load balancing, Networking]
   - Round robin, least-request, power of two choices, consistent hashing. Connection draining, slow start for new instances, and what happens to sticky state on scale-in.
4. **Size a system for 50,000 requests per second with a 100 ms hard deadline.** [mine · Advanced · Capacity, Latency]
   - Back-of-envelope CPU, memory and network per request. Fan-out cost, timeout budget split across calls, 30 to 40 percent headroom, and what you drop when the deadline is about to be missed.
5. **What are the trade-offs between vertical and horizontal scaling?** [ref · Fundamental · Scaling, Distributed systems]
   - Vertical is simple and has a ceiling and a single point of failure. Horizontal needs statelessness or partitioning, adds coordination cost, and scales further. Most systems do vertical first, then horizontal where the data allows.
6. **How does a request flow end-to-end through a production system?** [ref · Fundamental · Distributed systems, Networking]
   - DNS, edge or CDN, load balancer, gateway, service, cache, datastore, and back. State what each hop does, what can fail there, and where latency accumulates.
7. **How do I design a service that can handle 10x more traffic with minimal changes?** [ref · Intermediate · Scalability, Caching]
   - Stateless services behind a load balancer, caching for hot reads, replicas, partitionable data, and autoscaling with tested limits. Find the first bottleneck by load testing, not guessing.

### Monolith vs services
8. **When does splitting a monolith pay for itself?** [mine · Intermediate · Scaling, Architecture]
   - Team ownership lines, different deploy cadence, different scaling profiles. Price in the costs: network failure modes, distributed data, on-call load. A modular monolith is a valid answer.
9. **How do I decide when to split a monolith into services?** [ref · Intermediate · Distributed systems, Scalability]
   - Split along team and data ownership lines when deploy independence or scaling needs diverge. Cost: network failures, distributed data, operational load. A modular monolith may be enough.

### Overload, backpressure & spikes
10. **Design admission control so a service stays up through a 20x spike.** [mine · Advanced · Load shedding, Reliability]
   - Shed by priority, bound every queue, use adaptive concurrency limits, apply per-tenant quotas, and fail fast with Retry-After. Protect the critical path first, batch work last.
11. **How do I design for backpressure in a high-traffic system?** [ref · Advanced · Reliability, Scalability]
   - Bounded queues, propagate pressure upstream (blocking, credits, 429s), shed load deliberately, and size consumers to drain bursts. Unbounded buffers only move the failure later.
12. **How do I protect downstream services from traffic spikes?** [ref · Advanced · Reliability, Load balancing]
   - Rate limits and concurrency caps at the caller, queues that smooth bursts, circuit breakers, load shedding by priority, and caching in front of the dependency.

### Sync, async & queues
13. **How do I choose between synchronous and asynchronous communication?** [ref · Intermediate · Message queues, Distributed systems]
   - Synchronous when the caller needs the answer to proceed and latency is bounded. Asynchronous to decouple availability, absorb bursts and run slow work. Cost of async: eventual results, retries, duplicate handling.
14. **When should I use a queue versus direct RPC?** [ref · Intermediate · Message queues, Distributed systems]
   - Queue for buffering, fan-out, retries and independent consumer speed. RPC for request-scoped answers with a tight deadline. Never put a queue in a path that needs a synchronous response without a reply mechanism.

## Data & Storage (17)

### SQL, NoSQL & OLTP vs OLAP
15. **Where is the boundary between OLTP and OLAP, and how does data cross it?** [mine · Fundamental · OLTP, OLAP]
   - Row store for transactions, columnar store for analytics. Move data by change data capture, not dual writes. Cover lag, backfill, and schema drift between the two sides.
16. **How do I decide between SQL, NoSQL, and search engines?** [ref · Fundamental · Databases, Storage]
   - Start from access patterns and consistency needs. Relational for transactions and ad hoc queries, key-value or wide-column for known-key scale, search engines for text and faceting as a derived index, never the source of truth.
17. **How do I model data differently for OLTP versus OLAP workloads?** [ref · Fundamental · Databases, Storage]
   - OLTP: normalized rows, narrow transactions, point lookups. OLAP: denormalized wide tables or star schemas in columnar storage, loaded from OLTP by change data capture or batch.

### Partitioning & hot keys
18. **Pick a partition key for a multi-tenant ledger, then show how it fails.** [mine · Intermediate · Sharding, Databases]
   - Tenant, account or time as candidates. Failure cases: one giant tenant, time-based hot tail, cross-partition queries. Mitigate with composite keys, salting for heavy keys, and a resharding plan.
19. **A hot partition shows up at 2 a.m. Diagnose it and fix it without downtime.** [mine · Advanced · Sharding, Incidents]
   - Confirm skew from per-partition metrics. Short-term: cache the hot key, rate limit, split the range. Long-term: change the key, add a salt, rebalance online. Say how you verify the fix.
20. **How do I shard data by user, tenant, region, or something else?** [ref · Intermediate · Sharding, Databases]
   - Shard on the dimension most queries filter by and that spreads load evenly. Cover cross-shard queries, rebalancing, and tenant or region affinity for locality and compliance.
21. **What does a good partition key look like in a distributed store?** [ref · Intermediate · Databases, Storage]
   - High cardinality, even access, aligned with the dominant query, and stable over time. Avoid monotonically increasing keys that create a hot tail.
22. **How do I avoid hot partitions and skew?** [ref · Intermediate · Databases, Scalability]
   - Choose a well-distributed key, salt or split heavy keys, cache hot reads, and monitor per-partition load so skew is seen before it becomes an outage.

### Indexing
23. **Design indexes for a table that takes 90 percent writes.** [mine · Intermediate · Indexing, Databases]
   - Every index taxes writes. Keep the few that serve real queries, prefer covering indexes, consider LSM engines, and push ad hoc reads to a replica or search store.
24. **How should I index for read-heavy versus write-heavy workloads?** [ref · Intermediate · Indexing, Storage]
   - Read-heavy: more indexes, covering indexes, materialized views. Write-heavy: few indexes, append-friendly storage, deferred or asynchronous secondary structures.

### Migrations & backfills
25. **Migrate a billion-row table to a new schema with zero downtime.** [mine · Advanced · Migration, Reliability]
   - Expand, dual write, throttled backfill, verify with checksums, shadow reads, cut over, then contract. Keep a rollback path until the old column has been unused for a full cycle.
26. **How do I safely backfill data in production?** [ref · Advanced · Migration, Storage]
   - Throttle against production load, make the job idempotent and resumable, process in key ranges, verify with counts and checksums, and keep it observable and stoppable.
27. **How do I do schema changes without downtime?** [ref · Advanced · Migration, Databases]
   - Expand and contract: add nullable, deploy code that writes both, backfill, switch reads, remove the old. Avoid long locks and test the online DDL path against production-size data.
28. **How do I design a migration strategy for a huge table?** [ref · Advanced · Migration, Storage]
   - Expand and contract with dual writes, a throttled resumable backfill, verification before cutover, a rollback window, and cleanup only after the old path is provably idle.

### Retention & deletion
29. **Design retention, soft delete and legal erasure so they do not contradict each other.** [mine · Intermediate · Compliance, Storage]
   - Different clocks for each: soft delete for undo, retention for policy, erasure for law. Cover backups, derived stores, logs, and how you prove deletion happened.
30. **How do I design soft delete, archival, and retention?** [ref · Fundamental · Databases, Storage]
   - Deleted flag or tombstone for undo, tiered storage for old data, retention policies with automated purge, and explicit handling for legal deletion and backups.

### Multi-tenancy
31. **How do I handle multi-tenant data isolation?** [ref · Intermediate · Multi-tenancy, Reliability]
   - Row-level with tenant id on every query and enforced in the data layer, schema per tenant, or database per tenant. Trade isolation strength against cost and operational load. Plan noisy-neighbor controls and tenant export.

## Caching & Performance (7)

### Caching strategy
32. **Where should I cache: client, edge, service, or DB layer?** [ref · Fundamental · Caching, Networking]
   - Closer to the user means lower latency and weaker control over invalidation. Match the layer to data volatility and sharing: edge for public static, service for computed results, DB layer for hot rows.
33. **How do I pick between write-through, write-back, and write-around caching?** [ref · Fundamental · Caching]
   - Write-through keeps cache and store aligned at write cost. Write-back is fast but risks loss on cache failure. Write-around avoids polluting the cache with data that is rarely read.
34. **How do I design cache invalidation rules that do not become a nightmare?** [ref · Intermediate · Caching]
   - Prefer TTLs with jitter plus event-driven invalidation for the few cases that need it. Version keys instead of deleting, keep key construction in one place, and accept bounded staleness explicitly.
35. **How do I handle cache stampede and thundering herd?** [ref · Intermediate · Caching, Reliability]
   - Request coalescing so one caller rebuilds, stale-while-revalidate, TTL jitter, early refresh, and a lock or lease with a short timeout.
36. **What is my caching story for hot keys and large objects?** [ref · Intermediate · Caching, Scalability]
   - Replicate hot keys across nodes or add a local near-cache, split large values, compress, and cap object size. Watch for one key saturating one cache shard.
37. **How do I measure whether a cache is actually helping?** [ref · Fundamental · Caching, Observability]
   - Hit ratio by key class, latency with and without, origin load saved, eviction rate, and cost per hit. A high hit ratio on cheap reads can still be pointless.

### Pagination
38. **How do I design pagination for massive datasets efficiently?** [ref · Intermediate · Databases, Scalability]
   - Keyset (cursor) pagination over offset, a stable sort key with a tiebreaker, bounded page size, and a plan for results that change between pages.

## Consistency & Transactions (17)

### Idempotency
39. **Build idempotency for a write API that clients and your own gateway can both retry.** [mine · Advanced · Idempotency, APIs]
   - Client-supplied key, atomic claim of the key with the write, stored response for replays, key expiry, and the in-flight duplicate case. Say what you do when the request body differs.
40. **How do I handle idempotency for write APIs?** [ref · Advanced · Databases, Reliability]
   - Idempotency key per logical operation, atomically recorded with the write, replayed response on duplicates, a defined behavior for a duplicate that arrives while the first is still running, and key expiry.

### Consistency models & CAP
41. **Where is eventual consistency acceptable in a payments flow, and where is it never acceptable?** [mine · Fundamental · Consistency, Payments]
   - Balances and ledger postings need strong guarantees. Notifications, search views and analytics can lag. State the invariant first, then pick the weakest consistency that protects it.
42. **Give users read-your-writes when reads are served from replicas.** [mine · Intermediate · Replication, Consistency]
   - Route a user's reads to the primary for a short window, or carry a log position token and wait for replicas to reach it. Compare cost and complexity.
43. **How do I model consistency levels across services and data stores?** [ref · Intermediate · Consistency, Distributed systems]
   - Decide per data class: strong for money and inventory, read-your-writes for user-facing state, eventual for derived views. Document the guarantee at each service boundary.
44. **How do I reason about CAP trade-offs for a given product requirement?** [ref · Intermediate · CAP, Reliability]
   - CAP only matters during a partition. For each operation decide whether it must refuse (consistency) or may proceed on stale or divergent data (availability), and what reconciliation follows.
45. **When do I accept eventual consistency versus strict consistency?** [ref · Fundamental · Databases, Distributed systems]
   - Strict where a violation causes money, safety or legal harm. Eventual where staleness is invisible or recoverable. Decide from the invariant, not from habit.
46. **How do I handle read your own writes in a distributed system?** [ref · Intermediate · Databases, Distributed systems]
   - Sticky reads from the primary after a write, session tokens tracking a replica position, or client-side caching of the just-written value.

### Distributed transactions & reconciliation
47. **Replace a two-phase commit across three services.** [mine · Advanced · Transactions, Saga]
   - Saga with compensations, transactional outbox, idempotent consumers. Be honest about what you give up: isolation. Show how a half-finished saga is visible and recoverable.
48. **How do I design an outbox and inbox pattern for reliable events?** [ref · Advanced · Outbox, Message queues]
   - Write the event in the same transaction as the state change, relay it to the broker, and dedupe on the consumer with an inbox table keyed by event id. Cover relay lag and ordering.
49. **How do I reconcile divergent data across systems?** [ref · Intermediate · Reconciliation, Distributed systems]
   - Pick a source of truth per field, run periodic comparison jobs, classify differences, auto-repair the safe ones, and route the rest for review. Track drift as a metric.
50. **How do I implement distributed transactions without 2PC pain?** [ref · Advanced · Transactions, Message queues]
   - Sagas with compensating actions, outbox for reliable event emission, idempotent steps, and clear handling for stuck or partially complete flows.

### Consensus & distributed IDs
51. **Generate unique IDs across regions without a central counter.** [mine · Intermediate · IDs, Distributed systems]
   - Snowflake-style, ULID, UUIDv7. Clock skew, sortability, index locality, and what breaks if a node reuses a worker id.
52. **Where do Raft, Paxos, quorums and gossip appear in a system you would really build?** [mine · Intermediate · Consensus, Distributed systems]
   - Coordination and metadata on a consensus log, tunable quorums for data, gossip for membership and failure detection. Show that you use them, not reimplement them.
53. **How do I design id generation that works across regions?** [ref · Intermediate · Distributed systems, Networking]
   - Time-ordered unique ids (Snowflake, ULID, UUIDv7), per-node identifiers, clock skew handling, and index-friendly ordering. Avoid a global counter on the hot path.
54. **B. How do Raft, Paxos, gossip, and quorum based replication actually fit into my design?** [ref · Intermediate · Distributed systems, Ordering]
   - Consensus for leader election and metadata, quorum reads and writes for tunable consistency, gossip for membership and failure detection. Use proven implementations.
55. **How do Raft, Paxos, gossip, and quorum based replication actually fit into my design?** [ref · Advanced · PAXOS, RAFT, Reliability]
   - Explain the guarantee each one provides, what it costs in latency and availability, and where it sits in the design (coordination service, replication layer, membership). Name a real system for each.

## Reliability & Failure (15)

### Failure modes & degradation
56. **List the ways a three-tier service fails under real load before drawing any boxes.** [mine · Fundamental · Failure modes, Reliability]
   - Slow dependencies, retries, queue growth, GC pauses, connection pool exhaustion, bad deploys, clock drift, partial network partitions. Slow is worse than down.
57. **How do I design for graceful degradation instead of hard failure?** [ref · Fundamental · Reliability]
   - Rank features by importance, define a fallback for each dependency (cached, default, hidden), and test the degraded modes. Decide in advance what the user sees.
58. **What are all the ways my system can fail under real traffic?** [ref · Fundamental · Monitoring, Reliability]
   - Overload, slow or failing dependencies, resource exhaustion, bad deploys, data corruption, network partitions, cascading retries, and operator error. Group by blast radius.

### Retries, breakers & bulkheads
59. **Retries are amplifying an outage. Design retries that do not.** [mine · Intermediate · Retries, Reliability]
   - Retry budgets, exponential backoff with jitter, deadline propagation, retry at one layer only, idempotent operations only, and a kill switch.
60. **Choose and size circuit breakers, bulkheads and timeouts.** [mine · Intermediate · Resilience, Reliability]
   - Timeout below the caller's deadline, bulkhead per dependency, breaker thresholds from observed error rate. Cover half-open probing and fallback behavior.
61. **How do I implement retries without causing storms and loops?** [ref · Intermediate · Distributed systems, Reliability]
   - Capped attempts, exponential backoff with jitter, retry budgets, deadline propagation, retries at a single layer, and only for idempotent operations.
62. **How do I design circuit breakers and bulkheads correctly?** [ref · Intermediate · Distributed systems, Reliability]
   - Breaker opens on error or latency thresholds and probes in half-open state. Bulkheads isolate thread or connection pools per dependency. Tune from measured behavior and test them.

### Multi-region & outages
63. **Fail over between two regions without split brain.** [mine · Advanced · Multi-region, Reliability]
   - Single writer per partition, fencing tokens, health-based traffic shifting, data loss window (RPO) and recovery time (RTO) stated up front. Practice the failover, do not just draw it.
64. **How do I design for data center outage scenarios?** [ref · Advanced · Multi-region, Reliability]
   - Spread across zones first, then regions. Know your capacity after losing one site, replicate data with a stated loss window, and keep traffic shifting and runbooks tested.
65. **How do I run in multiple regions and fail over cleanly?** [ref · Advanced · Networking, Reliability]
   - Active-active or active-passive, a single writer per data partition, replication lag and loss window stated, health-driven DNS or traffic management, and regular failover drills.

### Releases & rollback
66. **Plan a rollback for a release that has already migrated data.** [mine · Advanced · Release, Migration]
   - Backward compatible schema, feature flags, forward-fix versus rollback decision rule, and data written by the new code that the old code must still read.
67. **How do I design a rollback strategy for bad releases?** [ref · Intermediate · Reliability]
   - Canary and progressive rollout, automatic rollback on SLO regression, backward-compatible schemas, feature flags, and a clear rule for rolling back versus fixing forward.

### SLOs
68. **Define SLOs for a lending platform and derive alerts from the error budget.** [mine · Advanced · SLO, Observability]
   - User-visible indicators such as approval latency and disbursal success. Multi-window burn rate alerts. Link budget exhaustion to a release freeze policy.
69. **How do I define SLOs and design around them?** [ref · Advanced · Monitoring, Reliability]
   - Pick user-visible indicators, set targets from user need and cost, track error budget, alert on burn rate, and let budget exhaustion change release behavior.

### Recovery
70. **How do I make rebuild from scratch possible if everything is lost?** [ref · Advanced · Recovery, Storage]
   - Infrastructure as code, tested backups with restore drills, a replayable event log as source of truth, documented bootstrap order, and a measured recovery time.

## Streaming & Async (15)

### Event-driven design
71. **Event-driven or request-response for order placement? Decide and defend it.** [mine · Fundamental · Events, Architecture]
   - Customer needs an answer now, so the order write is synchronous. Downstream work (fulfilment, notifications) is asynchronous. Say where you need a durable event and where a call is enough.
72. **When do I choose event-driven over request-response?** [ref · Fundamental · Distributed systems, Message queues]
   - When producers should not wait or know about consumers, when work can be asynchronous, when many consumers need the same fact, or when you need replay. Not when the caller needs an immediate answer.

### Delivery semantics
73. **Exactly-once in practice: what do Kafka and Flink give you, and what do you still own?** [mine · Advanced · Kafka, Flink]
   - Idempotent producers, transactions, checkpointed state. The sink and any external side effect still need idempotency. Be precise: exactly-once processing, not exactly-once delivery.
74. **How do I handle exactly once versus at least once semantics in practice?** [ref · Advanced · Distributed systems, Message queues]
   - Assume at-least-once delivery and make consumers idempotent. Use transactional or idempotent producers and checkpointed processing where available, and note that external side effects need their own dedupe.

### Poison messages & dead letters
75. **A poison message blocks a partition. Design the handling.** [mine · Advanced · Kafka, Reliability]
   - Bounded retries, retry topics with delay, dead-letter topic with context, alert on DLQ depth, and a safe replay tool. Decide when skipping is acceptable.
76. **How do I design dead-letter queues and retry policies?** [ref · Intermediate · Message queues, Reliability]
   - Bounded retries with backoff, delayed retry queues, a dead-letter queue carrying error context, alerting on its depth, and a safe replay path.
77. **How do I avoid processing the same event forever due to poison messages?** [ref · Advanced · Message queues, Reliability]
   - Attempt counters, routing to a dead-letter destination after a limit, per-message isolation so one bad record does not block the stream, and alerts for investigation.

### Ordering
78. **Keep ordering when you also need parallelism.** [mine · Advanced · Ordering, Kafka]
   - Key by the entity whose order matters, choose partition count for peak consumers, sequence numbers per key, and what happens during rebalance.
79. **How do I handle ordering of events when it matters?** [ref · Advanced · Ordering, Message queues]
   - Partition by the key whose order matters, sequence numbers for detecting gaps and duplicates, single consumer per partition, and care during rebalances and retries.

### Schedulers & long-running jobs
80. **Design a scheduler for millions of delayed jobs a day.** [mine · Advanced · Scheduling, Scalability]
   - Time-bucketed storage, a sharded poller with leases, at-least-once execution with idempotent jobs, clock skew, backlog catch-up after an outage.
81. **How do I track the status of long-running jobs for users?** [ref · Intermediate · Jobs, Message queues]
   - A job record with state, progress and error, returned immediately with an id. Clients poll or subscribe. Make states resumable and make the record the source of truth, not the queue.
82. **How do I design a fan-out and fan-in pipeline for heavy computations?** [ref · Advanced · Scalability, Message queues]
   - Split into idempotent tasks, track completion by counter or barrier, handle partial failure and stragglers, and bound concurrency to protect shared resources.
83. **How do I design a job scheduler for millions of jobs a day?** [ref · Advanced · Scheduling, Scalability]
   - Sharded time-bucketed storage, workers claiming jobs with leases, idempotent job execution, retry with backoff, and recovery of jobs held by crashed workers.

### Event schema evolution
84. **Evolve an event schema without breaking consumers.** [mine · Intermediate · Schema, Events]
   - Schema registry with compatibility mode, additive changes, tolerant readers, versioned topics only as a last resort, and a deprecation window with consumer inventory.
85. **How do I design an event schema that can evolve safely?** [ref · Intermediate · Distributed systems, Message queues]
   - Schema registry with a compatibility rule, additive-only changes by default, tolerant readers, explicit versioning for breaks, and a plan to retire old versions.

## APIs & Boundaries (17)

### Service boundaries & gateway
86. **Draw service boundaries for a lending platform: origination, underwriting, servicing, collections.** [mine · Intermediate · Boundaries, Domain design]
   - Bound by data ownership and change rate, not by nouns. Decide which data is copied by event and which is queried live. Show where a loan's state machine lives.
87. **Design a gateway that can evolve independently of the services behind it.** [mine · Intermediate · Gateway, Architecture]
   - Keep it thin: routing, auth, limits, observability. No business logic. Config-driven routes, canary support, and its own failure budget.
88. **How do I define clear boundaries between services?** [ref · Intermediate · Boundaries, Scalability]
   - One owner per piece of data, interfaces that match business capabilities, low coupling on change, and a test: can a team ship without coordinating with others?
89. **How do I design a gateway that can evolve independently of services?** [ref · Intermediate · Distributed systems, Scalability]
   - Thin gateway with routing, auth and limits only, declarative configuration, versioned routes, and no knowledge of service internals.

### Versioning, compatibility & deprecation
90. **Version a public API when you cannot force clients to upgrade.** [mine · Fundamental · Versioning, APIs]
   - Additive changes by default, explicit versions for breaking ones, a support policy with dates, usage telemetry per version, and contract tests.
91. **Deprecate an endpoint safely.** [mine · Intermediate · Deprecation, APIs]
   - Find real callers from logs, announce with dates, add Sunset headers, brown-out in staging then production, and keep a path for stragglers.
92. **How do I design APIs so they can evolve without breaking clients?** [ref · Intermediate · APIs, Scalability]
   - Additive changes only, optional fields with defaults, tolerant readers, explicit versioning for breaks, and contract tests against real client usage.
93. **How do I design for backward compatibility with older clients?** [ref · Intermediate · APIs, Compatibility]
   - Support-window policy, version telemetry, feature negotiation, and server-side shims for the oldest supported clients. Know when you can finally stop supporting one.
94. **How do I handle breaking change scenarios with minimal disruption?** [ref · Intermediate · APIs, Compatibility]
   - Run old and new in parallel, migrate clients with tooling and dates, monitor who still calls the old path, and offer a rollback during the cutover.
95. **How do I design versioning for public APIs?** [ref · Fundamental · APIs, Scalability]
   - Additive changes within a version, a new version for breaking changes, a published support policy, usage metrics per version, and clear deprecation dates.
96. **How do I design for backward compatibility when schemas change?** [ref · Intermediate · Distributed systems, Reliability]
   - Additive fields, defaults for missing values, never reuse or repurpose a field, readers that ignore unknown fields, and compatibility checks in CI.
97. **How do I design a safe deprecation process?** [ref · Intermediate · Distributed systems, Reliability]
   - Identify callers from telemetry, announce with dates, warn in responses, run brownouts, support stragglers, and only then remove.

### Rate limits & quotas
98. **Design per-tenant rate limits that do not punish well-behaved bursty clients.** [mine · Intermediate · Rate limiting, APIs]
   - Token bucket with burst allowance, shared counters in a fast store, local approximation to cut round trips, clear 429 responses, and tiered quotas.
99. **How do I design rate limiting that does not break good users?** [ref · Intermediate · Reliability, Scalability]
   - Token bucket with burst headroom, limits per identity rather than per IP where possible, clear 429 responses with retry hints, and separate limits for abusive and normal traffic.
100. **How do I design tenant-level rate limits and quotas?** [ref · Intermediate · Rate limiting, Reliability]
   - Limits per tenant and per plan, burst allowance, shared counters in a fast store, fair sharing under contention, and visibility so tenants see their usage.

### Partial failure
101. **One request fans out to five services and two fail. What do you return?** [mine · Advanced · Partial failure, APIs]
   - Classify calls as required or optional, return degraded results with a marker, set per-call timeouts, never block the whole response on the slowest optional call.
102. **How do I handle partial failures in multi-service calls?** [ref · Advanced · Distributed systems, Reliability]
   - Timeouts per call, required versus optional dependencies, degraded responses, compensations for completed steps, and idempotency so retries are safe.

## Observability & Operations (14)

### Logging & tracing
103. **What should each layer log, and what must never be logged?** [mine · Fundamental · Logging, Security]
   - Structured logs with a request id at every layer. Never log secrets, tokens, full card numbers or personal data. Sampling for high-volume paths and retention by sensitivity.
104. **Trace a request across 50 services without a runaway bill.** [mine · Advanced · Tracing, Cost]
   - Context propagation everywhere, tail-based sampling that keeps errors and slow traces, span attributes that are queryable, and a budget per team.
105. **What should I log at each layer, and what should I never log?** [ref · Fundamental · Monitoring, Reliability]
   - Structured logs with correlation ids, entry and exit of requests, errors with context, and decisions. Never secrets, tokens, full payment data or unnecessary personal data.
106. **How do I design tracing across 50+ microservices?** [ref · Advanced · Distributed systems, Monitoring]
   - Standard context propagation, consistent span naming, tail-based sampling to keep slow and failed traces, and links from metrics and logs to traces.

### Metrics, dashboards & alerts
107. **Alert on user pain, not on noise.** [mine · Intermediate · Alerting, SLO]
   - Page on symptoms such as error rate and latency against SLOs, ticket on causes. Every page needs an owner and a runbook link. Delete alerts that nobody acted on.
108. **How do I design metrics that actually tell me system health?** [ref · Intermediate · Metrics, Observability]
   - Latency, traffic, errors and saturation per service and per dependency, with histograms rather than averages and business metrics alongside technical ones.
109. **How do I design dashboards that help during incidents?** [ref · Intermediate · Dashboards, Incidents]
   - One top-level health view, then drill-down by service and dependency. Put symptoms first, show deploy markers, and keep the layout the same across services.
110. **How do I design alerting that catches real issues but avoids noise?** [ref · Intermediate · Monitoring, Reliability]
   - Alert on user-facing symptoms and SLO burn, attach runbooks, deduplicate and group, review noisy alerts regularly, and delete the ones that never lead to action.

### Latency debugging
111. **p50 is flat but p99 doubled. How do you debug it?** [mine · Advanced · Latency, Debugging]
   - Look for queueing, GC, noisy neighbors, a slow shard, retries, lock contention. Compare by instance, endpoint and dependency. Use exemplars to jump from a metric to a trace.
112. **How do I debug high tail latency in a distributed system?** [ref · Advanced · Distributed systems, Monitoring]
   - Compare percentiles by instance, endpoint and dependency, look for queueing, GC, retries and hot shards, and use traces to find the slow span. Hedged requests can mask but not fix it.

### Runbooks & failure drills
113. **Rehearse failure before production does it for you.** [mine · Intermediate · Chaos, Reliability]
   - Game days, dependency fault injection, region evacuation drills, restore-from-backup tests. Start in staging with a hypothesis and a stop condition.
114. **Write a runbook the on-call engineer can follow at 3 a.m.** [mine · Fundamental · Runbooks, Operations]
   - Symptom first, then checks in order, then safe actions with exact commands, then when to escalate. Tested by someone who did not write it.
115. **How do I design runbooks so on-call engineers can act fast?** [ref · Fundamental · Monitoring, Reliability]
   - Start from the alert, give ordered checks, exact commands, safe mitigations, escalation paths, and keep them tested and reviewed after incidents.
116. **How do I simulate failures before they hit production?** [ref · Intermediate · Monitoring, Reliability]
   - Fault injection for dependencies and infrastructure, game days, load and soak tests, and restore drills, starting with a hypothesis and a clear abort condition.

## Evolution, Cost & Trade-offs (9)

### MVP, platforms & cost
117. **How do I design something MVP-first that can still grow?** [ref · Fundamental · Scalability, Architecture]
   - Make the cheapest design that satisfies today's load, but keep the seams that are expensive to add later: identifiers, data ownership, API contracts and observability.
118. **How do I choose between building a platform and a one-off service?** [ref · Intermediate · Architecture, Trade-offs]
   - Build a platform when three or more teams need the same capability and the interface is stable. Otherwise ship the one-off and extract later from real usage.
119. **How do I design for cost visibility and optimization from day one?** [ref · Intermediate · Cost, Observability]
   - Tag every resource by team and service, expose cost per request or per tenant, set budgets and alerts, and review the top spenders on a schedule.

### Build vs buy
120. **Decide what to buy and what to build.** [mine · Intermediate · Build vs buy, Trade-offs]
   - Build what differentiates you and what you must control. Buy commodity. Count integration, lock-in, data egress and the people cost of running either.
121. **How do I decide what to buy versus what to build?** [ref · Intermediate · Reliability, Scalability]
   - Build what differentiates you or needs deep control. Buy commodity capability. Weigh lock-in, integration cost, data portability, and the ongoing cost of operating either choice.

### Extensibility, experiments & compliance
122. **How do I design systems that multiple teams can safely extend?** [ref · Advanced · Architecture, Leadership]
   - Clear extension points, stable contracts, isolation so one team's plugin cannot take down others, and ownership documented per component.
123. **How do I plan for data residency and regional regulations?** [ref · Intermediate · Compliance, Multi-region]
   - Tag data by jurisdiction, pin storage and processing to regions, control cross-region replication and logs, and design deletion and access requests per region.
124. **How do I design to support experiments such as A/B tests and flags cleanly?** [ref · Intermediate · Experimentation, Architecture]
   - Central flag service with stable user bucketing, exposure logging, kill switches, and a cleanup process for dead flags. Keep experiment logic out of business code paths where possible.

### Legacy migration
125. **How do I design migration paths when the legacy system cannot just die?** [ref · Advanced · Migration, Architecture]
   - Strangler pattern: route slices of traffic to the new system, keep both in sync during the overlap, migrate data by domain, and define an exit criterion for the old system.

## Judgment & Leadership (16)

### Trade-offs & design reviews
126. **Defend a design trade-off to a skeptical architect in five minutes.** [mine · Intermediate · Communication, Trade-offs]
   - State the constraint, the options you rejected and why, what would change your mind, and how you will find out cheaply if you are wrong.
127. **Review a peer's design deeply and still be easy to work with.** [mine · Advanced · Reviews, Leadership]
   - Ask questions that expose assumptions, separate blocking concerns from preferences, propose an alternative when you object, and credit what is good.
128. **How do I explain my design to a junior developer so they truly get it?** [ref · Intermediate · Communication]
   - Start from the problem and one request path, add pieces only as the problem demands them, use a single diagram, and check understanding by asking them to predict a failure.
129. **How do I defend trade-offs to a sceptical architect?** [ref · Intermediate · Distributed systems]
   - State requirements and constraints, show alternatives with costs, say what you are giving up, and name the signal that would make you reverse the decision.
130. **How do I review someone else's design deeply but respectfully?** [ref · Advanced · Distributed systems]
   - Understand the goal first, ask questions about failure and scale, separate must-fix from preference, suggest alternatives, and acknowledge what is solid.

### Simplicity & over/under-engineering
131. **How do you tell when a design is over-engineered?** [mine · Intermediate · Judgment, Architecture]
   - Components with no current requirement behind them, flexibility nobody has asked for, more moving parts than people to run them.
132. **How do you tell when a design is dangerously under-engineered?** [mine · Intermediate · Judgment, Reliability]
   - No answer for the failure you can name, no way to roll back, no capacity numbers, one person who understands it.
133. **How do I simplify a complex design without losing guarantees?** [ref · Advanced · Judgment, Reliability]
   - List the guarantees that must hold, remove components that do not protect one, merge things that always change together, and prove the invariants still hold.
134. **How do I design for boring reliability instead of cleverness?** [ref · Intermediate · Judgment, Reliability]
   - Choose proven components, minimize moving parts, prefer simple failure modes, and spend novelty budget only where it creates real advantage.
135. **How do I decide what not to build into a system?** [ref · Intermediate · Judgment, Scalability]
   - Tie each feature to a present requirement or measured risk, defer what is cheap to add later, and write the non-goals down.
136. **How do I know when a design is over-engineered?** [ref · Intermediate · Distributed systems, Scalability]
   - Complexity without a current requirement, abstractions with one user, more services than teams, and anything you cannot explain the need for in a sentence.
137. **How do I know when a design is dangerously under-engineered?** [ref · Intermediate · Distributed systems, Scalability]
   - No failure handling for known risks, no capacity estimate, no rollback or recovery path, unclear ownership, and a single point of failure on a critical path.
138. **How do I design so that mistakes are cheap, not catastrophic?** [ref · Advanced · Distributed systems, Reliability]
   - Small blast radius, progressive rollout, reversible changes, backups and restore tests, feature flags, and guardrails on destructive operations.

### Design docs & ownership
139. **Write a design doc that is still useful in three years.** [mine · Advanced · Documentation, Leadership]
   - Context and constraints, alternatives considered, decisions with reasons, non-goals, and open questions. The reasons age better than the diagrams.
140. **How do I design systems that can be owned by teams, not heroes?** [ref · Advanced · Leadership, Operations]
   - Documented runbooks, shared on-call, boring technology, clear ownership boundaries, and no component only one person understands.
141. **How do I write a design doc that survives 3 years of evolution?** [ref · Advanced · Distributed systems, Reliability]
   - Record context, goals and non-goals, alternatives considered, decisions and their reasons, and known risks. Date it, link follow-ups, and keep diagrams simple.

