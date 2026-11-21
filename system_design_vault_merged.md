# Staff Design Vault

Generated from questions.json. [mine] = original question; [ref] = title from a third-party list. All answer outlines written independently.

## Scale & Traffic (10)

### Request path & scaling basics
1. **Walk one request from DNS to the database and back. Where does each millisecond go?** [mine + ref · Fundamental · Latency]
   - Name every hop: DNS, TLS, CDN or edge, load balancer, service, cache, database. Give each hop a latency budget, then say which hops dominate p99 and why.
   - DNS, edge or CDN, load balancer, gateway, service, cache, datastore, and back. State what each hop does, what can fail there, and where latency accumulates.
   - _Also asked as:_ How does a request flow end-to-end through a production system?
2. **Read traffic grows 10x in one quarter. What do you change first, and what do you refuse to change?** [mine + ref · Intermediate · Scaling, Caching]
   - Measure the bottleneck before acting. Cache and add read replicas before sharding. Hold the API contract and data model steady so clients and teams do not have to move.
   - Stateless services behind a load balancer, caching for hot reads, replicas, partitionable data, and autoscaling with tested limits. Find the first bottleneck by load testing, not guessing.
   - _Also asked as:_ How do I design a service that can handle 10x more traffic with minimal changes?
3. **Choose a load balancing strategy for long-lived connections versus short RPCs.** [mine · Intermediate · Scaling, Latency]
   - Round robin, least-request, power of two choices, consistent hashing. Connection draining, slow start for new instances, and what happens to sticky state on scale-in.
4. **Size a system for 50,000 requests per second with a 100 ms hard deadline.** [mine · Advanced · Scaling, Latency]
   - Back-of-envelope CPU, memory and network per request. Fan-out cost, timeout budget split across calls, 30 to 40 percent headroom, and what you drop when the deadline is about to be missed.
5. **What are the trade-offs between vertical and horizontal scaling?** [ref · Fundamental · Scaling]
   - Vertical is simple and has a ceiling and a single point of failure. Horizontal needs statelessness or partitioning, adds coordination cost, and scales further. Most systems do vertical first, then horizontal where the data allows.

### Monolith vs services
6. **When does splitting a monolith pay for itself?** [mine + ref · Intermediate · Scaling, Architecture]
   - Team ownership lines, different deploy cadence, different scaling profiles. Price in the costs: network failure modes, distributed data, on-call load. A modular monolith is a valid answer.
   - Split along team and data ownership lines when deploy independence or scaling needs diverge. Cost: network failures, distributed data, operational load. A modular monolith may be enough.
   - _Also asked as:_ How do I decide when to split a monolith into services?

### Overload, backpressure & spikes
7. **Design admission control so a service stays up through a 20x spike.** [mine + ref · Advanced · Scaling, Reliability]
   - Shed by priority, bound every queue, use adaptive concurrency limits, apply per-tenant quotas, and fail fast with Retry-After. Protect the critical path first, batch work last.
   - Rate limits and concurrency caps at the caller, queues that smooth bursts, circuit breakers, load shedding by priority, and caching in front of the dependency.
   - _Also asked as:_ How do I protect downstream services from traffic spikes?
8. **How do I design for backpressure in a high-traffic system?** [ref · Advanced · Reliability, Scaling]
   - Bounded queues, propagate pressure upstream (blocking, credits, 429s), shed load deliberately, and size consumers to drain bursts. Unbounded buffers only move the failure later.

### Sync, async & queues
9. **How do I choose between synchronous and asynchronous communication?** [ref · Intermediate · Messaging]
   - Synchronous when the caller needs the answer to proceed and latency is bounded. Asynchronous to decouple availability, absorb bursts and run slow work. Cost of async: eventual results, retries, duplicate handling.
10. **When should I use a queue versus direct RPC?** [ref · Intermediate · Messaging]
   - Queue for buffering, fan-out, retries and independent consumer speed. RPC for request-scoped answers with a tight deadline. Never put a queue in a path that needs a synchronous response without a reply mechanism.

## Data & Storage (12)

### SQL, NoSQL & OLTP vs OLAP
11. **Where is the boundary between OLTP and OLAP, and how does data cross it?** [mine · Fundamental · Databases]
   - Row store for transactions, columnar store for analytics. Move data by change data capture, not dual writes. Cover lag, backfill, and schema drift between the two sides.
12. **How do I decide between SQL, NoSQL, and search engines?** [ref · Fundamental · Databases]
   - Start from access patterns and consistency needs. Relational for transactions and ad hoc queries, key-value or wide-column for known-key scale, search engines for text and faceting as a derived index, never the source of truth.
13. **How do I model data differently for OLTP versus OLAP workloads?** [ref · Fundamental · Databases]
   - OLTP: normalized rows, narrow transactions, point lookups. OLAP: denormalized wide tables or star schemas in columnar storage, loaded from OLTP by change data capture or batch.

### Partitioning & hot keys
14. **Pick a partition key for a multi-tenant ledger, then show how it fails.** [mine + ref · Intermediate · Sharding, Databases]
   - Tenant, account or time as candidates. Failure cases: one giant tenant, time-based hot tail, cross-partition queries. Mitigate with composite keys, salting for heavy keys, and a resharding plan.
   - High cardinality, even access, aligned with the dominant query, and stable over time. Avoid monotonically increasing keys that create a hot tail.
   - _Also asked as:_ What does a good partition key look like in a distributed store?
15. **A hot partition shows up at 2 a.m. Diagnose it and fix it without downtime.** [mine + ref · Advanced · Sharding, Operations, Databases]
   - Confirm skew from per-partition metrics. Short-term: cache the hot key, rate limit, split the range. Long-term: change the key, add a salt, rebalance online. Say how you verify the fix.
   - Choose a well-distributed key, salt or split heavy keys, cache hot reads, and monitor per-partition load so skew is seen before it becomes an outage.
   - _Also asked as:_ How do I avoid hot partitions and skew?
16. **How do I shard data by user, tenant, region, or something else?** [ref · Intermediate · Sharding, Databases]
   - Shard on the dimension most queries filter by and that spreads load evenly. Cover cross-shard queries, rebalancing, and tenant or region affinity for locality and compliance.

### Indexing
17. **Design indexes for a table that takes 90 percent writes.** [mine + ref · Intermediate · Databases]
   - Every index taxes writes. Keep the few that serve real queries, prefer covering indexes, consider LSM engines, and push ad hoc reads to a replica or search store.
   - Read-heavy: more indexes, covering indexes, materialized views. Write-heavy: few indexes, append-friendly storage, deferred or asynchronous secondary structures.
   - _Also asked as:_ How should I index for read-heavy versus write-heavy workloads?

### Migrations & backfills
18. **Migrate a billion-row table to a new schema with zero downtime.** [mine + ref · Advanced · Migration, Reliability, Databases]
   - Expand, dual write, throttled backfill, verify with checksums, shadow reads, cut over, then contract. Keep a rollback path until the old column has been unused for a full cycle.
   - Expand and contract with dual writes, a throttled resumable backfill, verification before cutover, a rollback window, and cleanup only after the old path is provably idle.
   - _Also asked as:_ How do I design a migration strategy for a huge table?
19. **How do I safely backfill data in production?** [ref · Advanced · Migration, Databases]
   - Throttle against production load, make the job idempotent and resumable, process in key ranges, verify with counts and checksums, and keep it observable and stoppable.
20. **How do I do schema changes without downtime?** [ref · Advanced · Migration, Databases]
   - Expand and contract: add nullable, deploy code that writes both, backfill, switch reads, remove the old. Avoid long locks and test the online DDL path against production-size data.

### Retention & deletion
21. **Design retention, soft delete and legal erasure so they do not contradict each other.** [mine + ref · Intermediate · Cost & compliance, Databases]
   - Different clocks for each: soft delete for undo, retention for policy, erasure for law. Cover backups, derived stores, logs, and how you prove deletion happened.
   - Deleted flag or tombstone for undo, tiered storage for old data, retention policies with automated purge, and explicit handling for legal deletion and backups.
   - _Also asked as:_ How do I design soft delete, archival, and retention?

### Multi-tenancy
22. **How do I handle multi-tenant data isolation?** [ref · Intermediate · Sharding, Reliability]
   - Row-level with tenant id on every query and enforced in the data layer, schema per tenant, or database per tenant. Trade isolation strength against cost and operational load. Plan noisy-neighbor controls and tenant export.

## Caching & Performance (7)

### Caching strategy
23. **Where should I cache: client, edge, service, or DB layer?** [ref · Fundamental · Caching, Latency]
   - Closer to the user means lower latency and weaker control over invalidation. Match the layer to data volatility and sharing: edge for public static, service for computed results, DB layer for hot rows.
24. **How do I pick between write-through, write-back, and write-around caching?** [ref · Fundamental · Caching]
   - Write-through keeps cache and store aligned at write cost. Write-back is fast but risks loss on cache failure. Write-around avoids polluting the cache with data that is rarely read.
25. **How do I design cache invalidation rules that do not become a nightmare?** [ref · Intermediate · Caching]
   - Prefer TTLs with jitter plus event-driven invalidation for the few cases that need it. Version keys instead of deleting, keep key construction in one place, and accept bounded staleness explicitly.
26. **How do I handle cache stampede and thundering herd?** [ref · Intermediate · Caching, Reliability]
   - Request coalescing so one caller rebuilds, stale-while-revalidate, TTL jitter, early refresh, and a lock or lease with a short timeout.
27. **What is my caching story for hot keys and large objects?** [ref · Intermediate · Caching, Scaling]
   - Replicate hot keys across nodes or add a local near-cache, split large values, compress, and cap object size. Watch for one key saturating one cache shard.
28. **How do I measure whether a cache is actually helping?** [ref · Fundamental · Caching, Observability]
   - Hit ratio by key class, latency with and without, origin load saved, eviction rate, and cost per hit. A high hit ratio on cheap reads can still be pointless.

### Pagination
29. **How do I design pagination for massive datasets efficiently?** [ref · Intermediate · Databases, Scaling]
   - Keyset (cursor) pagination over offset, a stable sort key with a tiebreaker, bounded page size, and a plan for results that change between pages.

## Consistency & Transactions (10)

### Idempotency
30. **Build idempotency for a write API that clients and your own gateway can both retry.** [mine + ref · Advanced · Consistency, APIs, Databases]
   - Client-supplied key, atomic claim of the key with the write, stored response for replays, key expiry, and the in-flight duplicate case. Say what you do when the request body differs.
   - Idempotency key per logical operation, atomically recorded with the write, replayed response on duplicates, a defined behavior for a duplicate that arrives while the first is still running, and key expiry.
   - _Also asked as:_ How do I handle idempotency for write APIs?

### Consistency models & CAP
31. **Where is eventual consistency acceptable in a payments flow, and where is it never acceptable?** [mine + ref · Fundamental · Consistency, Transactions, Databases]
   - Balances and ledger postings need strong guarantees. Notifications, search views and analytics can lag. State the invariant first, then pick the weakest consistency that protects it.
   - Strict where a violation causes money, safety or legal harm. Eventual where staleness is invisible or recoverable. Decide from the invariant, not from habit.
   - _Also asked as:_ When do I accept eventual consistency versus strict consistency?
32. **Give users read-your-writes when reads are served from replicas.** [mine + ref · Intermediate · Databases, Consistency]
   - Route a user's reads to the primary for a short window, or carry a log position token and wait for replicas to reach it. Compare cost and complexity.
   - Sticky reads from the primary after a write, session tokens tracking a replica position, or client-side caching of the just-written value.
   - _Also asked as:_ How do I handle read your own writes in a distributed system?
33. **How do I model consistency levels across services and data stores?** [ref · Intermediate · Consistency]
   - Decide per data class: strong for money and inventory, read-your-writes for user-facing state, eventual for derived views. Document the guarantee at each service boundary.
34. **How do I reason about CAP trade-offs for a given product requirement?** [ref · Intermediate · Consistency, Reliability]
   - CAP only matters during a partition. For each operation decide whether it must refuse (consistency) or may proceed on stale or divergent data (availability), and what reconciliation follows.

### Distributed transactions & reconciliation
35. **Replace a two-phase commit across three services.** [mine + ref · Advanced · Transactions, Messaging]
   - Saga with compensations, transactional outbox, idempotent consumers. Be honest about what you give up: isolation. Show how a half-finished saga is visible and recoverable.
   - Sagas with compensating actions, outbox for reliable event emission, idempotent steps, and clear handling for stuck or partially complete flows.
   - _Also asked as:_ How do I implement distributed transactions without 2PC pain?
36. **How do I design an outbox and inbox pattern for reliable events?** [ref · Advanced · Transactions, Messaging]
   - Write the event in the same transaction as the state change, relay it to the broker, and dedupe on the consumer with an inbox table keyed by event id. Cover relay lag and ordering.
37. **How do I reconcile divergent data across systems?** [ref · Intermediate · Transactions]
   - Pick a source of truth per field, run periodic comparison jobs, classify differences, auto-repair the safe ones, and route the rest for review. Track drift as a metric.

### Consensus & distributed IDs
38. **Generate unique IDs across regions without a central counter.** [mine + ref · Intermediate · Consistency, Databases]
   - Snowflake-style, ULID, UUIDv7. Clock skew, sortability, index locality, and what breaks if a node reuses a worker id.
   - Time-ordered unique ids (Snowflake, ULID, UUIDv7), per-node identifiers, clock skew handling, and index-friendly ordering. Avoid a global counter on the hot path.
   - _Also asked as:_ How do I design id generation that works across regions?
39. **Where do Raft, Paxos, quorums and gossip appear in a system you would really build?** [mine + ref · Intermediate · Consistency, Reliability]
   - Coordination and metadata on a consensus log, tunable quorums for data, gossip for membership and failure detection. Show that you use them, not reimplement them.
   - Explain the guarantee each one provides, what it costs in latency and availability, and where it sits in the design (coordination service, replication layer, membership). Name a real system for each.
   - Consensus for leader election and metadata, quorum reads and writes for tunable consistency, gossip for membership and failure detection. Use proven implementations.
   - _Also asked as:_ How do Raft, Paxos, gossip, and quorum based replication actually fit into my design?

## Reliability & Failure (9)

### Failure modes & degradation
40. **List the ways a three-tier service fails under real load before drawing any boxes.** [mine + ref · Fundamental · Reliability, Observability]
   - Slow dependencies, retries, queue growth, GC pauses, connection pool exhaustion, bad deploys, clock drift, partial network partitions. Slow is worse than down.
   - Overload, slow or failing dependencies, resource exhaustion, bad deploys, data corruption, network partitions, cascading retries, and operator error. Group by blast radius.
   - _Also asked as:_ What are all the ways my system can fail under real traffic?
41. **How do I design for graceful degradation instead of hard failure?** [ref · Fundamental · Reliability]
   - Rank features by importance, define a fallback for each dependency (cached, default, hidden), and test the degraded modes. Decide in advance what the user sees.

### Retries, breakers & bulkheads
42. **Retries are amplifying an outage. Design retries that do not.** [mine + ref · Intermediate · Reliability]
   - Retry budgets, exponential backoff with jitter, deadline propagation, retry at one layer only, idempotent operations only, and a kill switch.
   - Capped attempts, exponential backoff with jitter, retry budgets, deadline propagation, retries at a single layer, and only for idempotent operations.
   - _Also asked as:_ How do I implement retries without causing storms and loops?
43. **Choose and size circuit breakers, bulkheads and timeouts.** [mine + ref · Intermediate · Reliability]
   - Timeout below the caller's deadline, bulkhead per dependency, breaker thresholds from observed error rate. Cover half-open probing and fallback behavior.
   - Breaker opens on error or latency thresholds and probes in half-open state. Bulkheads isolate thread or connection pools per dependency. Tune from measured behavior and test them.
   - _Also asked as:_ How do I design circuit breakers and bulkheads correctly?

### Multi-region & outages
44. **Fail over between two regions without split brain.** [mine + ref · Advanced · Reliability, Consistency]
   - Single writer per partition, fencing tokens, health-based traffic shifting, data loss window (RPO) and recovery time (RTO) stated up front. Practice the failover, do not just draw it.
   - Active-active or active-passive, a single writer per data partition, replication lag and loss window stated, health-driven DNS or traffic management, and regular failover drills.
   - _Also asked as:_ How do I run in multiple regions and fail over cleanly?
45. **How do I design for data center outage scenarios?** [ref · Advanced · Reliability]
   - Spread across zones first, then regions. Know your capacity after losing one site, replicate data with a stated loss window, and keep traffic shifting and runbooks tested.

### Releases & rollback
46. **Plan a rollback for a release that has already migrated data.** [mine + ref · Advanced · Migration, Reliability]
   - Backward compatible schema, feature flags, forward-fix versus rollback decision rule, and data written by the new code that the old code must still read.
   - Canary and progressive rollout, automatic rollback on SLO regression, backward-compatible schemas, feature flags, and a clear rule for rolling back versus fixing forward.
   - _Also asked as:_ How do I design a rollback strategy for bad releases?

### SLOs
47. **Define SLOs for a lending platform and derive alerts from the error budget.** [mine + ref · Advanced · Observability, Reliability]
   - User-visible indicators such as approval latency and disbursal success. Multi-window burn rate alerts. Link budget exhaustion to a release freeze policy.
   - Pick user-visible indicators, set targets from user need and cost, track error budget, alert on burn rate, and let budget exhaustion change release behavior.
   - _Also asked as:_ How do I define SLOs and design around them?

### Recovery
48. **How do I make rebuild from scratch possible if everything is lost?** [ref · Advanced · Reliability, Databases]
   - Infrastructure as code, tested backups with restore drills, a replayable event log as source of truth, documented bootstrap order, and a measured recovery time.

## Streaming & Async (9)

### Event-driven design
49. **Event-driven or request-response for order placement? Decide and defend it.** [mine + ref · Fundamental · Messaging, Architecture]
   - Customer needs an answer now, so the order write is synchronous. Downstream work (fulfilment, notifications) is asynchronous. Say where you need a durable event and where a call is enough.
   - When producers should not wait or know about consumers, when work can be asynchronous, when many consumers need the same fact, or when you need replay. Not when the caller needs an immediate answer.
   - _Also asked as:_ When do I choose event-driven over request-response?

### Delivery semantics
50. **Exactly-once in practice: what do Kafka and Flink give you, and what do you still own?** [mine + ref · Advanced · Messaging]
   - Idempotent producers, transactions, checkpointed state. The sink and any external side effect still need idempotency. Be precise: exactly-once processing, not exactly-once delivery.
   - Assume at-least-once delivery and make consumers idempotent. Use transactional or idempotent producers and checkpointed processing where available, and note that external side effects need their own dedupe.
   - _Also asked as:_ How do I handle exactly once versus at least once semantics in practice?

### Poison messages & dead letters
51. **A poison message blocks a partition. Design the handling.** [mine + ref · Advanced · Messaging, Reliability]
   - Bounded retries, retry topics with delay, dead-letter topic with context, alert on DLQ depth, and a safe replay tool. Decide when skipping is acceptable.
   - Attempt counters, routing to a dead-letter destination after a limit, per-message isolation so one bad record does not block the stream, and alerts for investigation.
   - _Also asked as:_ How do I avoid processing the same event forever due to poison messages?
52. **How do I design dead-letter queues and retry policies?** [ref · Intermediate · Messaging, Reliability]
   - Bounded retries with backoff, delayed retry queues, a dead-letter queue carrying error context, alerting on its depth, and a safe replay path.

### Ordering
53. **Keep ordering when you also need parallelism.** [mine + ref · Advanced · Consistency, Messaging]
   - Key by the entity whose order matters, choose partition count for peak consumers, sequence numbers per key, and what happens during rebalance.
   - Partition by the key whose order matters, sequence numbers for detecting gaps and duplicates, single consumer per partition, and care during rebalances and retries.
   - _Also asked as:_ How do I handle ordering of events when it matters?

### Schedulers & long-running jobs
54. **Design a scheduler for millions of delayed jobs a day.** [mine + ref · Advanced · Messaging, Scaling]
   - Time-bucketed storage, a sharded poller with leases, at-least-once execution with idempotent jobs, clock skew, backlog catch-up after an outage.
   - Sharded time-bucketed storage, workers claiming jobs with leases, idempotent job execution, retry with backoff, and recovery of jobs held by crashed workers.
   - _Also asked as:_ How do I design a job scheduler for millions of jobs a day?
55. **How do I track the status of long-running jobs for users?** [ref · Intermediate · Messaging]
   - A job record with state, progress and error, returned immediately with an id. Clients poll or subscribe. Make states resumable and make the record the source of truth, not the queue.
56. **How do I design a fan-out and fan-in pipeline for heavy computations?** [ref · Advanced · Scaling, Messaging]
   - Split into idempotent tasks, track completion by counter or barrier, handle partial failure and stragglers, and bound concurrency to protect shared resources.

### Event schema evolution
57. **Evolve an event schema without breaking consumers.** [mine + ref · Intermediate · Migration, Messaging]
   - Schema registry with compatibility mode, additive changes, tolerant readers, versioned topics only as a last resort, and a deprecation window with consumer inventory.
   - Schema registry with a compatibility rule, additive-only changes by default, tolerant readers, explicit versioning for breaks, and a plan to retire old versions.
   - _Also asked as:_ How do I design an event schema that can evolve safely?

## APIs & Boundaries (9)

### Service boundaries & gateway
58. **Draw service boundaries for a lending platform: origination, underwriting, servicing, collections.** [mine + ref · Intermediate · APIs, Architecture]
   - Bound by data ownership and change rate, not by nouns. Decide which data is copied by event and which is queried live. Show where a loan's state machine lives.
   - One owner per piece of data, interfaces that match business capabilities, low coupling on change, and a test: can a team ship without coordinating with others?
   - _Also asked as:_ How do I define clear boundaries between services?
59. **Design a gateway that can evolve independently of the services behind it.** [mine + ref · Intermediate · APIs, Architecture]
   - Keep it thin: routing, auth, limits, observability. No business logic. Config-driven routes, canary support, and its own failure budget.
   - Thin gateway with routing, auth and limits only, declarative configuration, versioned routes, and no knowledge of service internals.
   - _Also asked as:_ How do I design a gateway that can evolve independently of services?

### Versioning, compatibility & deprecation
60. **Version a public API when you cannot force clients to upgrade.** [mine + ref · Fundamental · APIs, Migration]
   - Additive changes by default, explicit versions for breaking ones, a support policy with dates, usage telemetry per version, and contract tests.
   - Additive changes within a version, a new version for breaking changes, a published support policy, usage metrics per version, and clear deprecation dates.
   - Additive changes only, optional fields with defaults, tolerant readers, explicit versioning for breaks, and contract tests against real client usage.
   - _Also asked as:_ How do I design versioning for public APIs? / How do I design APIs so they can evolve without breaking clients?
61. **Deprecate an endpoint safely.** [mine + ref · Intermediate · Migration, APIs, Reliability]
   - Find real callers from logs, announce with dates, add Sunset headers, brown-out in staging then production, and keep a path for stragglers.
   - Identify callers from telemetry, announce with dates, warn in responses, run brownouts, support stragglers, and only then remove.
   - _Also asked as:_ How do I design a safe deprecation process?
62. **How do I design for backward compatibility with older clients?** [ref · Intermediate · APIs, Migration]
   - Support-window policy, version telemetry, feature negotiation, and server-side shims for the oldest supported clients. Know when you can finally stop supporting one.
63. **How do I handle breaking change scenarios with minimal disruption?** [ref · Intermediate · APIs, Migration]
   - Run old and new in parallel, migrate clients with tooling and dates, monitor who still calls the old path, and offer a rollback during the cutover.
64. **How do I design for backward compatibility when schemas change?** [ref · Intermediate · Migration, APIs]
   - Additive fields, defaults for missing values, never reuse or repurpose a field, readers that ignore unknown fields, and compatibility checks in CI.

### Rate limits & quotas
65. **Design per-tenant rate limits that do not punish well-behaved bursty clients.** [mine + ref · Intermediate · APIs, Reliability, Scaling]
   - Token bucket with burst allowance, shared counters in a fast store, local approximation to cut round trips, clear 429 responses, and tiered quotas.
   - Limits per tenant and per plan, burst allowance, shared counters in a fast store, fair sharing under contention, and visibility so tenants see their usage.
   - Token bucket with burst headroom, limits per identity rather than per IP where possible, clear 429 responses with retry hints, and separate limits for abusive and normal traffic.
   - _Also asked as:_ How do I design tenant-level rate limits and quotas? / How do I design rate limiting that does not break good users?

### Partial failure
66. **One request fans out to five services and two fail. What do you return?** [mine + ref · Advanced · Reliability, APIs]
   - Classify calls as required or optional, return degraded results with a marker, set per-call timeouts, never block the whole response on the slowest optional call.
   - Timeouts per call, required versus optional dependencies, degraded responses, compensations for completed steps, and idempotency so retries are safe.
   - _Also asked as:_ How do I handle partial failures in multi-service calls?

## Observability & Operations (8)

### Logging & tracing
67. **What should each layer log, and what must never be logged?** [mine + ref · Fundamental · Observability, Cost & compliance, Reliability]
   - Structured logs with a request id at every layer. Never log secrets, tokens, full card numbers or personal data. Sampling for high-volume paths and retention by sensitivity.
   - Structured logs with correlation ids, entry and exit of requests, errors with context, and decisions. Never secrets, tokens, full payment data or unnecessary personal data.
   - _Also asked as:_ What should I log at each layer, and what should I never log?
68. **Trace a request across 50 services without a runaway bill.** [mine + ref · Advanced · Observability, Cost & compliance]
   - Context propagation everywhere, tail-based sampling that keeps errors and slow traces, span attributes that are queryable, and a budget per team.
   - Standard context propagation, consistent span naming, tail-based sampling to keep slow and failed traces, and links from metrics and logs to traces.
   - _Also asked as:_ How do I design tracing across 50+ microservices?

### Metrics, dashboards & alerts
69. **Alert on user pain, not on noise.** [mine + ref · Intermediate · Observability, Reliability]
   - Page on symptoms such as error rate and latency against SLOs, ticket on causes. Every page needs an owner and a runbook link. Delete alerts that nobody acted on.
   - Alert on user-facing symptoms and SLO burn, attach runbooks, deduplicate and group, review noisy alerts regularly, and delete the ones that never lead to action.
   - _Also asked as:_ How do I design alerting that catches real issues but avoids noise?
70. **How do I design metrics that actually tell me system health?** [ref · Intermediate · Observability]
   - Latency, traffic, errors and saturation per service and per dependency, with histograms rather than averages and business metrics alongside technical ones.
71. **How do I design dashboards that help during incidents?** [ref · Intermediate · Observability, Operations]
   - One top-level health view, then drill-down by service and dependency. Put symptoms first, show deploy markers, and keep the layout the same across services.

### Latency debugging
72. **p50 is flat but p99 doubled. How do you debug it?** [mine + ref · Advanced · Latency, Observability]
   - Look for queueing, GC, noisy neighbors, a slow shard, retries, lock contention. Compare by instance, endpoint and dependency. Use exemplars to jump from a metric to a trace.
   - Compare percentiles by instance, endpoint and dependency, look for queueing, GC, retries and hot shards, and use traces to find the slow span. Hedged requests can mask but not fix it.
   - _Also asked as:_ How do I debug high tail latency in a distributed system?

### Runbooks & failure drills
73. **Rehearse failure before production does it for you.** [mine + ref · Intermediate · Reliability, Observability]
   - Game days, dependency fault injection, region evacuation drills, restore-from-backup tests. Start in staging with a hypothesis and a stop condition.
   - Fault injection for dependencies and infrastructure, game days, load and soak tests, and restore drills, starting with a hypothesis and a clear abort condition.
   - _Also asked as:_ How do I simulate failures before they hit production?
74. **Write a runbook the on-call engineer can follow at 3 a.m.** [mine + ref · Fundamental · Operations, Observability, Reliability]
   - Symptom first, then checks in order, then safe actions with exact commands, then when to escalate. Tested by someone who did not write it.
   - Start from the alert, give ordered checks, exact commands, safe mitigations, escalation paths, and keep them tested and reviewed after incidents.
   - _Also asked as:_ How do I design runbooks so on-call engineers can act fast?

## Evolution, Cost & Trade-offs (8)

### MVP, platforms & cost
75. **How do I design something MVP-first that can still grow?** [ref · Fundamental · Scaling, Architecture]
   - Make the cheapest design that satisfies today's load, but keep the seams that are expensive to add later: identifiers, data ownership, API contracts and observability.
76. **How do I choose between building a platform and a one-off service?** [ref · Intermediate · Architecture]
   - Build a platform when three or more teams need the same capability and the interface is stable. Otherwise ship the one-off and extract later from real usage.
77. **How do I design for cost visibility and optimization from day one?** [ref · Intermediate · Cost & compliance, Observability]
   - Tag every resource by team and service, expose cost per request or per tenant, set budgets and alerts, and review the top spenders on a schedule.

### Build vs buy
78. **Decide what to buy and what to build.** [mine + ref · Intermediate · Architecture, Cost & compliance]
   - Build what differentiates you and what you must control. Buy commodity. Count integration, lock-in, data egress and the people cost of running either.
   - Build what differentiates you or needs deep control. Buy commodity capability. Weigh lock-in, integration cost, data portability, and the ongoing cost of operating either choice.
   - _Also asked as:_ How do I decide what to buy versus what to build?

### Extensibility, experiments & compliance
79. **How do I design systems that multiple teams can safely extend?** [ref · Advanced · Architecture, Leadership]
   - Clear extension points, stable contracts, isolation so one team's plugin cannot take down others, and ownership documented per component.
80. **How do I plan for data residency and regional regulations?** [ref · Intermediate · Cost & compliance, Reliability]
   - Tag data by jurisdiction, pin storage and processing to regions, control cross-region replication and logs, and design deletion and access requests per region.
81. **How do I design to support experiments such as A/B tests and flags cleanly?** [ref · Intermediate · Architecture]
   - Central flag service with stable user bucketing, exposure logging, kill switches, and a cleanup process for dead flags. Keep experiment logic out of business code paths where possible.

### Legacy migration
82. **How do I design migration paths when the legacy system cannot just die?** [ref · Advanced · Migration, Architecture]
   - Strangler pattern: route slices of traffic to the new system, keep both in sync during the overlap, migrate data by domain, and define an exit criterion for the old system.

## Judgment & Leadership (11)

### Trade-offs & design reviews
83. **Defend a design trade-off to a skeptical architect in five minutes.** [mine + ref · Intermediate · Leadership, Architecture]
   - State the constraint, the options you rejected and why, what would change your mind, and how you will find out cheaply if you are wrong.
   - State requirements and constraints, show alternatives with costs, say what you are giving up, and name the signal that would make you reverse the decision.
   - _Also asked as:_ How do I defend trade-offs to a sceptical architect?
84. **Review a peer's design deeply and still be easy to work with.** [mine + ref · Advanced · Leadership]
   - Ask questions that expose assumptions, separate blocking concerns from preferences, propose an alternative when you object, and credit what is good.
   - Understand the goal first, ask questions about failure and scale, separate must-fix from preference, suggest alternatives, and acknowledge what is solid.
   - _Also asked as:_ How do I review someone else's design deeply but respectfully?
85. **How do I explain my design to a junior developer so they truly get it?** [ref · Intermediate · Leadership]
   - Start from the problem and one request path, add pieces only as the problem demands them, use a single diagram, and check understanding by asking them to predict a failure.

### Simplicity & over/under-engineering
86. **How do you tell when a design is over-engineered?** [mine + ref · Intermediate · Leadership, Architecture]
   - Components with no current requirement behind them, flexibility nobody has asked for, more moving parts than people to run them.
   - Complexity without a current requirement, abstractions with one user, more services than teams, and anything you cannot explain the need for in a sentence.
   - _Also asked as:_ How do I know when a design is over-engineered?
87. **How do you tell when a design is dangerously under-engineered?** [mine + ref · Intermediate · Leadership, Reliability]
   - No answer for the failure you can name, no way to roll back, no capacity numbers, one person who understands it.
   - No failure handling for known risks, no capacity estimate, no rollback or recovery path, unclear ownership, and a single point of failure on a critical path.
   - _Also asked as:_ How do I know when a design is dangerously under-engineered?
88. **How do I simplify a complex design without losing guarantees?** [ref · Advanced · Leadership, Reliability]
   - List the guarantees that must hold, remove components that do not protect one, merge things that always change together, and prove the invariants still hold.
89. **How do I design for boring reliability instead of cleverness?** [ref · Intermediate · Leadership, Reliability]
   - Choose proven components, minimize moving parts, prefer simple failure modes, and spend novelty budget only where it creates real advantage.
90. **How do I decide what not to build into a system?** [ref · Intermediate · Leadership, Architecture]
   - Tie each feature to a present requirement or measured risk, defer what is cheap to add later, and write the non-goals down.
91. **How do I design so that mistakes are cheap, not catastrophic?** [ref · Advanced · Reliability, Leadership]
   - Small blast radius, progressive rollout, reversible changes, backups and restore tests, feature flags, and guardrails on destructive operations.

### Design docs & ownership
92. **Write a design doc that is still useful in three years.** [mine + ref · Advanced · Leadership]
   - Context and constraints, alternatives considered, decisions with reasons, non-goals, and open questions. The reasons age better than the diagrams.
   - Record context, goals and non-goals, alternatives considered, decisions and their reasons, and known risks. Date it, link follow-ups, and keep diagrams simple.
   - _Also asked as:_ How do I write a design doc that survives 3 years of evolution?
93. **How do I design systems that can be owned by teams, not heroes?** [ref · Advanced · Leadership, Operations]
   - Documented runbooks, shared on-call, boring technology, clear ownership boundaries, and no component only one person understands.
