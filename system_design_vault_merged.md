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
   - **Thesis:** Prove it's skew and find the key, buy time with the cheapest mitigation aimed at that key, then fix the key design online. Don't start by adding capacity: a hot key stays on one partition however many nodes you add.
   - **60-second answer:** At 2 a.m. I'm mitigating, not redesigning. First I confirm from per-partition metrics that one partition is saturated while the rest are mostly idle; that rules out general overload. Then I find the hot key from top-key sampling or access logs and work out why it's hot: one huge tenant, a client stuck in a retry loop, a viral item, or a monotonically increasing key piling writes onto the newest range. The mitigation targets that key: rate-limit or block the offending client, put a short-TTL cache in front of hot reads, or split the range if the store supports it. Once things are stable, the real fix is the key design (a composite key, salting only the heavy keys, or moving a giant tenant to dedicated partitions), rolled out with dual writes and an online backfill. I call it fixed when the per-partition load distribution has flattened, not just when errors stop.
   - **Key points:**
     1. **Confirm it's skew, not overload.** Look at per-partition throughput, latency and throttling. Skew looks like one partition at its limit while the cluster average is low. Cluster-level dashboards hide it: a 30% average can contain one partition at 100%.
     2. **Find the key and the cause.** Use whatever the store offers for top keys (key sampling, per-partition metrics, consumer lag per partition) plus access logs. Typical causes: one very large tenant, a retry storm from one client, a celebrity item, or timestamp and auto-increment keys concentrating writes at the tail of the range.
     3. **Mitigate in minutes.** Hot reads: cache in front with a short TTL and request coalescing. Hot writes: rate-limit the offender, queue or shed non-critical writes, or flip a feature flag that turns off the trigger. If the store can split a range or rebalance automatically, let it or force it.
     4. **Protect everyone else on that partition.** Isolate the hot tenant or client (bulkhead, per-tenant limits) so the other tenants sharing the partition recover first. Post status updates in the incident channel while you work.
     5. **Fix the key shape.** Options: a composite key such as (tenant, entity) instead of (tenant); salt only the heavy keys with N suffixes and scatter-gather on read; prefix time-based keys with a hash bucket; give giant tenants dedicated partitions or cells.
     6. **Migrate without downtime.** Dual-write to the new key layout, backfill with throttling, verify with counts and checksums, switch reads, then stop writing the old layout. Changing a partition key in place is usually a full rewrite, so treat it as a migration.
     7. **Verify and prevent.** Watch the ratio of the hottest partition to the median until it flattens. Add alerts on per-partition saturation, track top tenants by load, and load test with skewed traffic instead of uniform.
   - **When to choose what:** Hot reads: cache and replicate. Hot writes: split or salt the key. One tenant hot: isolate the tenant. Keys drifting hot over time (monotonic): change the key shape. Adding nodes doesn't help any of these, because a single key always maps to a single partition.
   - **Numbers:**
     - DynamoDB documents a ceiling of 3,000 read units and 1,000 write units per second per partition. A key that needs more is throttled however much capacity the table has.
     - Salting a heavy key into N buckets divides its per-partition write load by N but multiplies read fan-out by N. With N = 10, one logical read becomes 10 parallel reads, which is why you salt only the heavy keys.
     - Working heuristic for spotting skew: the hottest partition at its limit while the median sits at a fraction of it, for example 100% against 20%.
   - **Pitfalls:**
     - Scaling out the cluster: the hot key still lives on one partition.
     - Stopping at the cache: it hides the hot read while the key keeps growing, and the next spike hits writes.
     - Salting every key instead of only the heavy ones: every read becomes a scatter-gather.
     - Changing the partition key in place without planning the data rewrite.
     - Declaring victory when errors stop instead of checking that load per partition has evened out.
   - **Follow-ups:**
     - _The hot key is a single counter, such as likes on a viral post._ Shard the counter: N sub-counters, write to a random one, sum them on read or aggregate periodically. Accept that the displayed total is slightly stale.
     - _How would you have caught this before 2 a.m.?_ Alert on per-partition saturation and on the max-to-median ratio, track the top tenants by load over time, and run load tests with skewed (Zipf-like) traffic instead of uniform traffic.
     - _The hot tenant is your largest customer. Do you rate-limit them?_ Short term, protect everyone else and talk to them. Long term, give them a dedicated cell or partitions so their growth becomes their own capacity, priced accordingly.
     - _Walk me through re-keying without downtime._ Expand and contract: dual-write to the new layout, run a throttled and resumable backfill, verify, move reads, stop the old writes, then clean up after a full cycle with no reads on the old layout.
   - **Example:** A multi-tenant orders table is partitioned by tenant_id. A large retailer runs a flash sale; its partition throttles, failing writes for the 40 smaller tenants that share it. On-call caps the retailer's write rate and queues its non-urgent updates, and the other tenants recover. The follow-up changes the key to (tenant_id, hash bucket of order_id) for tenants above a size threshold, migrated with dual writes over a week.
   - **Sources:** [AWS DynamoDB: Designing partition keys to distribute your workload](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-uniform-load.html); [AWS DynamoDB: Best practices for partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 6 (Partitioning)](https://dataintensive.net/)
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
   - **Thesis:** The client names each logical operation with an idempotency key; the server records that key atomically with the effect and replays the stored result for any repeat. Everything else is handling the edges of that one rule.
   - **60-second answer:** I'd require an Idempotency-Key header on every mutating endpoint, generated by the client once per logical operation and reused on every retry. On the server, the first request inserts the key, scoped to the account and stored with a hash of the request, in the same transaction as the business write; when it finishes we store the response. A retry with a finished key gets that stored response replayed. A retry that arrives while the original is still running gets a 409 with Retry-After instead of running twice. The same key with a different body is a 422, because that's a client bug, not a retry. Keys live longer than the longest client retry window, typically 24 hours. The gateway forwards the key and never mints one, or every gateway retry would look like a new operation.
   - **Key points:**
     1. **One key per logical operation, owned by the client.** Generated before the first attempt (a UUID is fine) and persisted client-side, so a retry after an app restart reuses it. SDK and gateway retries pass the key through. If the gateway generated keys, its own retries would each look new and dedupe would never fire.
     2. **Scope and fingerprint the key.** Make (account_id, key) unique, not the key alone, so tenants can't collide or see each other's responses. Store a hash of method, path and canonical body so a reused key with different parameters is detected and rejected.
     3. **Claim the key atomically with the effect.** Insert the key row with status 'started' in the same database transaction as the business write. The unique constraint makes a concurrent duplicate lose. Either the effect and the key both commit, or neither does, so a crash can't leave a half-applied operation.
     4. **Replay what executed; don't save what never ran.** Once execution has started, store the status code and body (including failures produced during execution) and return them byte-for-byte on a repeat. Requests rejected before execution, such as validation errors or a concurrent conflict, are not saved, so the client can fix the request and retry with the same key.
     5. **Handle the in-flight duplicate explicitly.** If the key exists with status 'started', return 409 Conflict with Retry-After rather than waiting or running again. If a 'started' row is older than a takeover timeout, a later retry may resume it, guarded by a version check so two takeovers can't both proceed.
     6. **External side effects need recovery points.** A card charge or an email can't join your database transaction. Model the request as a state machine (started, charge_requested, charged, completed), commit progress between steps, and pass a key derived from the client's key to the provider so it dedupes too. A retry resumes from the last recovery point.
     7. **Expire keys deliberately.** Keep keys longer than the longest client retry horizon, then purge. After expiry the same key is a new operation; document that so clients don't retry days later and get charged again.
   - **When to choose what:** If the effect is a write in one database, claim the key and write in a single transaction: simplest and correct. If the effect is external, use the recovery-point state machine plus a downstream idempotency key. If the operation can be made naturally idempotent (PUT of full state, conditional write on a version, set-based update), do that and skip the key store entirely.
   - **Numbers:**
     - Key storage ≈ writes/day × bytes per key × retention days. At 5M writes/day, about 1 KB per key (key, request hash, stored response) and 1 day of retention: about 5 GB, small enough to live in the primary database.
     - Latency cost of the same-database design is one extra indexed insert inside a transaction you already run. A separate key store adds a network round trip per write and, worse, a window where the key and the effect can disagree.
   - **Pitfalls:**
     - Recording the key after the side effect: a crash in between means the retry applies the effect twice.
     - Letting the gateway or load balancer generate keys: every retry gets a fresh key and nothing is deduplicated.
     - Saving a transient failure (timeout, 503 from a dependency) as the final result: that key can now never succeed.
     - Making keys globally unique instead of per account: one tenant's key can collide with another's or return their response.
     - Expiry shorter than the client's retry window, for example a mobile app that retries after hours offline.
     - Keys in a separate store such as a cache, with no transaction spanning it and the write: the double-apply window is back.
   - **Follow-ups:**
     - _The idempotency store is down. Do you fail open or closed?_ If keys live in the same database as the write, the question disappears: no database means no write. With a separate store, fail closed for money movement (return 503 and let the client retry) and fail open only for low-risk writes that are deduplicated downstream. Say which and why.
     - _Two requests with the same key arrive 5 ms apart on different servers._ The unique constraint on (account_id, key) decides. One insert wins; the other hits the conflict and returns 409 with Retry-After. No distributed lock is needed when the database enforces uniqueness.
     - _How does this extend to a saga across several services?_ Derive child keys deterministically from the parent key plus the step name, for example parent:reserve-stock. Every step is idempotent on its own, and replaying the saga hits the same keys.
     - _What changes in an active-active, multi-region setup?_ Uniqueness has to be enforced in one place per key. Pin each account's writes to a home region, which account-scoped keys make natural, or accept a cross-region dedupe window and run a reconciliation job.
   - **Example:** A mobile app sends POST /payments with key k1. The server commits the charge, but the response is lost when the phone switches networks. The app retries with k1 a few seconds later; the server finds k1 completed and replays the original 201 with the same payment id. The user is charged once and sees one payment.
   - **Sources:** [Stripe API reference: Idempotent requests](https://docs.stripe.com/api/idempotent_requests); [Brandur Leach: Implementing Stripe-like idempotency keys in Postgres](https://brandur.org/idempotency-keys); [IETF draft: The Idempotency-Key HTTP header field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
   - _Also asked as:_ How do I handle idempotency for write APIs?

### Consistency models & CAP
31. **Where is eventual consistency acceptable in a payments flow, and where is it never acceptable?** [mine + ref · Fundamental · Consistency, Transactions, Databases]
   - **Thesis:** Start from the invariants, not the components. Anything that can create or lose money (balances, ledger postings, the authorisation decision) needs strong consistency; everything derived from those facts can lag.
   - **60-second answer:** In a payments flow I'd first write down the invariants: a ledger entry is never lost or duplicated, debits equal credits, and a balance never goes below its limit because of a race. The ledger write and the balance check that guards it must be strongly consistent, usually a single transactional store with the check and the posting in one transaction. The decision returned to the merchant has to reflect that committed state. Everything downstream (notifications, the customer's transaction list, search, analytics, fraud features, the statement) is derived from the ledger and can be eventually consistent, as long as it converges and is idempotent. The rule is: pick the weakest consistency that still protects the invariant, and make the boundary explicit so nobody reads a derived view to make a money decision.
   - **Key points:**
     1. **Name the invariants first.** No double spend, no lost or duplicated postings, debits equal credits, balance never below limit. Each component's consistency need follows from which invariant it protects. Without this list, consistency debates turn into taste.
     2. **Strong where money is decided.** The authorisation check and the ledger posting happen in one transaction against one source of truth, or under a per-account serialisation (single writer per account). This is where linearizable reads or serializable transactions earn their cost.
     3. **Eventual where state is derived.** Notifications, activity feeds, search indexes, analytics and reporting are projections of the ledger. They can lag seconds or minutes as long as they converge and replays don't double-count.
     4. **The dangerous middle: reads used for decisions.** A 'available balance' shown in the app can be stale; a balance used to approve a transfer cannot. Make sure decision paths read from the primary, not from a cache or replica built for display.
     5. **External systems are always eventually consistent.** Card networks, banks and payment providers settle later and sometimes disagree. Model states explicitly (pending, authorised, captured, settled, reversed) and reconcile against their reports daily.
     6. **Make the boundary visible.** Label stores and APIs with their guarantee, for example 'ledger: serializable' and 'activity feed: eventual, under 30 s typical'. Teams then can't accidentally build a money decision on a lagging view.
   - **When to choose what:** Strong consistency for anything that changes or authorises money and for reads that feed those decisions. Eventual consistency for projections, notifications and analytics, with idempotent consumers and reconciliation. If you can't say which invariant a component protects, it probably doesn't need strong consistency.
   - **Numbers:**
     - Typical acceptable lag for derived views: seconds for a customer's activity list, minutes for analytics, a day for settlement reconciliation. State the number per view so it can be monitored.
   - **Pitfalls:**
     - Approving a payment from a cached or replica balance: a race lets two payments both see enough funds.
     - Treating the payment provider's webhook as the source of truth without reconciliation; webhooks are delayed, duplicated and occasionally missing.
     - Making everything strongly consistent 'to be safe': it couples services, hurts availability and doesn't improve correctness for derived data.
     - Notifications sent before the ledger commit, so customers are told about payments that later roll back.
   - **Follow-ups:**
     - _Two transfers from the same account arrive at the same moment. How do you prevent overdraft?_ Serialise per account: a conditional update (balance >= amount) in one transaction, row locking, or routing all writes for an account to a single writer. The check and the debit must be atomic.
     - _The ledger and the notification service disagree. Which wins?_ The ledger, always. Notifications are a projection; fix them by replaying from the ledger. That's why the projection must be idempotent.
     - _Can the balance shown in the app be stale?_ Yes, if it's labelled and never used for decisions. Many products show 'available' and 'pending' separately for exactly this reason.
   - **Example:** A wallet app debits the ledger in a serializable transaction and returns success. An outbox event then updates the activity feed and sends a push notification within a few seconds. A nightly job reconciles the ledger against the bank's settlement file and flags mismatches for review.
   - **Sources:** [Werner Vogels: Eventually consistent](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html); [Jepsen: Consistency models](https://jepsen.io/consistency)
   - _Also asked as:_ When do I accept eventual consistency versus strict consistency?
32. **Give users read-your-writes when reads are served from replicas.** [mine + ref · Intermediate · Databases, Consistency]
   - **Thesis:** Read-your-writes is a per-session guarantee, so solve it per session: either route a user's reads to the primary for a short window after they write, or carry a replication position with the session and only read from replicas that have caught up to it.
   - **60-second answer:** With replicas, a user can write, refresh, and not see their own change, which feels like data loss. I wouldn't make all reads go to the primary; the guarantee only matters for the writer. The simple option is sticky-to-primary: after a write, mark the session and route that user's reads to the primary for a window a bit longer than typical replication lag. The precise option is a position token: the write returns the primary's log position, the client or session carries it, and a read is served only by a replica at or past that position, otherwise it waits briefly or falls back to the primary. For a single page you can also just render the value you wrote. I'd pick sticky-to-primary first and move to tokens if primary read load becomes a problem.
   - **Key points:**
     1. **Scope the guarantee correctly.** Only the session that wrote needs to see the write immediately. Other users can tolerate lag. Making all reads strongly consistent wastes the replicas.
     2. **Option 1: sticky reads to the primary.** After a write, set a session flag or cookie with an expiry (for example 5–10 seconds, above p99 replication lag) and route that session's reads to the primary. Simple and robust; costs extra primary reads proportional to write rate.
     3. **Option 2: replication position tokens.** The write returns a log position (an LSN, GTID or commit timestamp). Reads carry it; the router picks a replica whose applied position is at least that, or waits up to a small timeout, then falls back to the primary.
     4. **Option 3: client-side echo.** The client renders the value it just wrote instead of re-reading it. Works for simple forms; breaks when the server computes derived fields or other devices are involved.
     5. **Monitor replication lag as a first-class metric.** Every option depends on lag staying bounded. Alert on p99 lag, and have the router stop using replicas that fall too far behind.
     6. **Cross-device needs a server-side session.** If the user writes on a phone and reads on a laptop, a cookie on one device doesn't help. Store the last-write position against the user id instead.
   - **When to choose what:** Sticky-to-primary when write volume is modest and primary has headroom. Position tokens when primary read capacity is the bottleneck or lag varies widely. Client echo for single-screen flows. Always pair with lag monitoring and replica eviction.
   - **Numbers:**
     - Sticky window sizing: set it above p99 replication lag. If p99 lag is 800 ms, a 5 second window is generous and costs one primary read per page view for 5 seconds after each write.
     - Extra primary load ≈ writes/sec × reads per session in the window. 200 writes/sec × 10 reads in the window = 2,000 extra primary reads/sec.
   - **Pitfalls:**
     - Fixed sticky window shorter than lag spikes: the bug reappears during peak, exactly when it's hardest to debug.
     - Ignoring cross-device and cross-service reads: a write through service A and a read through service B with its own replica.
     - Caches in front of replicas: the replica caught up but the cache still holds the old value.
     - Routing all reads to the primary after an incident 'temporarily' and never undoing it.
   - **Follow-ups:**
     - _What about monotonic reads, so a user never sees time go backwards?_ Pin a session to one replica, or carry the highest position seen and never read from a replica behind it. Position tokens give you both guarantees with one mechanism.
     - _A replica falls 30 seconds behind. What happens?_ With tokens, reads for recent writers fall back to the primary automatically. The router should also eject the replica from rotation past a lag threshold.
     - _How do you do this with a cache in front?_ Invalidate or update the cache on write in the same request path, or version cache entries with the position so a stale entry is detectable.
   - **Example:** A user updates their shipping address and is redirected to the profile page. The write sets a 'recent-write' marker valid for 5 seconds, so the profile read goes to the primary and shows the new address. After 5 seconds the user's reads return to replicas.
   - **Sources:** [Jepsen: Read your writes](https://jepsen.io/consistency/models/read-your-writes); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 5 (Replication)](https://dataintensive.net/)
   - _Also asked as:_ How do I handle read your own writes in a distributed system?
33. **How do I model consistency levels across services and data stores?** [ref · Intermediate · Consistency]
   - **Thesis:** Assign a consistency level to each kind of data, not to the whole system, and publish it as part of every service's contract. Strong for money and inventory, session guarantees for user-facing state, eventual for derived views.
   - **60-second answer:** I'd classify data rather than services. Money, inventory counts and uniqueness constraints get strong consistency inside one owning service. User-facing state like profiles and settings gets session guarantees, read-your-writes and monotonic reads, which is what users actually notice. Derived data, such as search, feeds, recommendations and analytics, is eventual with a stated lag. Then I'd make the guarantee explicit at every boundary: an API that serves from a cache says so, an event stream states its ordering and delivery guarantees. Across services you generally can't have strong consistency without coupling, so cross-service flows use sagas and reconciliation, and each service owns the strong guarantees for its own data.
   - **Key points:**
     1. **Classify data by invariant.** Money, inventory, uniqueness (usernames, seat bookings): strong. User-visible state: session guarantees. Derived and aggregated data: eventual. The class drives the store and the access path.
     2. **One owner per piece of strongly consistent data.** Strong consistency is cheap inside one database and expensive across many. Put each invariant inside one service's transactional boundary; others ask that service rather than copy the data.
     3. **Session guarantees are the user-facing sweet spot.** Read-your-writes, monotonic reads and consistent prefix cover most 'the app looks broken' complaints without global coordination.
     4. **State lag and ordering for every projection.** A search index or feed should publish its expected lag and whether it preserves per-entity ordering. That makes it monitorable and stops people treating it as a source of truth.
     5. **Document guarantees in the contract.** API docs and event schemas say: source of truth or projection, staleness bound, ordering, delivery semantics (at-least-once, deduplicate by id).
     6. **Cross-service invariants use sagas and reconciliation.** If an invariant spans services, accept temporary inconsistency, drive convergence with sagas, and detect drift with reconciliation jobs.
   - **When to choose what:** Default to eventual plus idempotency across service boundaries. Upgrade to session guarantees where users see their own changes. Reserve strong consistency for invariants that cost money, safety or legal standing, and keep each one inside a single owner.
   - **Numbers:**
     - Write the staleness bound as a number per view, for example 'search: p99 under 60 s', so it can be alerted on rather than argued about.
   - **Pitfalls:**
     - One global setting ('we're eventually consistent') that's wrong for half the data.
     - Copying strongly consistent data into other services and making decisions from the copy.
     - Undocumented caches in an API path that silently weaken its guarantee.
     - Distributed transactions across services to get strong consistency that a single owner could provide.
   - **Follow-ups:**
     - _How do you enforce uniqueness, such as usernames, across regions?_ Route the uniqueness check to one authority (a single home region or a consensus-backed store), or partition the namespace so each region owns a slice. Uniqueness can't be eventual.
     - _What's the difference between session guarantees and strong consistency for users?_ Session guarantees only promise that a user sees their own history consistently; strong consistency promises everyone sees one global order. The first is far cheaper and usually enough.
     - _How would you test that the guarantees hold?_ Contract tests for the documented bounds, lag metrics with alerts, and fault-injection tests (partitions, replica lag) for the strong paths. Tools in the style of Jepsen exist for the latter.
   - **Example:** An e-commerce platform: orders and inventory are strongly consistent inside the order service; the product catalogue page reads from a cache with a 5-minute TTL; the customer's order history uses read-your-writes; search and recommendations lag by up to a minute.
   - **Sources:** [Jepsen: Consistency models](https://jepsen.io/consistency); [Werner Vogels: Eventually consistent](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html)
34. **How do I reason about CAP trade-offs for a given product requirement?** [ref · Intermediate · Consistency, Reliability]
   - **Thesis:** CAP only bites during a network partition, and then it's a per-operation choice: refuse the request to stay consistent, or serve it and accept divergence you'll reconcile later. Most of the time the real trade-off is latency against consistency.
   - **60-second answer:** I treat CAP as a question I ask per operation: when a partition separates replicas, should this operation fail or proceed? Placing an order against limited inventory should probably fail or queue rather than oversell. Adding an item to a cart or liking a post should proceed and merge later. Outside partitions, which is most of the time, the trade-off is latency against consistency, which is what PACELC adds: synchronous cross-region replication costs a round trip on every write. So for each operation I state what happens on a partition, what the user sees, and how divergent state is reconciled afterwards. 'We chose AP' as a system-wide label is usually too coarse to be useful.
   - **Key points:**
     1. **CAP is about behaviour during partitions.** Partitions will happen, so the real choice is what each operation does when replicas can't talk: refuse (consistent) or proceed (available). It's not a choice between three properties.
     2. **Decide per operation.** Booking the last seat: refuse or queue. Updating a shopping cart: proceed and merge. Reading a product description: serve stale. Different operations in one product make different choices.
     3. **Most of the time it's latency vs consistency.** Without a partition you still pay for consistency: synchronous replication across zones or regions adds round-trip latency to every write. PACELC names this: else, latency or consistency.
     4. **Available choices need a reconciliation story.** If you accept writes on both sides, define how divergence resolves: last-writer-wins (loses data), merge functions or CRDTs, or flagging conflicts for a human.
     5. **Consistent choices need a user story.** If you refuse, decide what the user sees: an error, a retry later, or a queued request with a promise. 'Unavailable' must still be designed.
     6. **Shrink the blast radius.** Partition data so a network split only affects the slice whose owner is unreachable. A home region per account keeps most operations available and consistent.
   - **When to choose what:** Refuse during partitions when divergence would violate a money, safety or uniqueness invariant. Proceed when operations commute or merge cleanly (counters, sets, carts). For everything, state the normal-case latency cost of the consistency you pick.
   - **Numbers:**
     - Synchronous replication cost: a cross-region round trip is often tens of milliseconds and can exceed 100 ms between distant continents, added to every consistent write. In-zone replication is typically around a millisecond or less.
   - **Pitfalls:**
     - Labelling the whole system 'AP' or 'CP' and ignoring that operations differ.
     - Choosing availability without designing conflict resolution; last-writer-wins silently drops writes.
     - Forgetting the normal-case latency cost and blaming the database for slow writes.
     - Treating CAP's 'consistency' as the C in ACID; CAP's C means linearizability.
   - **Follow-ups:**
     - _Give an example where you'd choose availability._ A shopping cart: accept adds on both sides of a partition and merge as a union, accepting that a removed item might reappear. Amazon's Dynamo paper describes this trade-off.
     - _How do CRDTs help?_ They're data types whose concurrent updates merge deterministically (counters, sets, registers with defined rules), so replicas converge without coordination. They suit collaborative and counter-style data, not invariants like 'balance never negative'.
     - _What does the user see when you choose consistency during a partition?_ Design it: a clear message, a retry with backoff, or accept the request into a durable queue and confirm later. Silent hangs are the worst choice.
   - **Example:** A ticketing system keeps seat reservation consistent (a partition makes the minority side refuse bookings) but keeps event browsing and wish-lists available from local replicas, merging wish-list changes afterwards.
   - **Sources:** [Eric Brewer: CAP twelve years later](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/); [DeCandia et al.: Dynamo, Amazon's highly available key-value store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)

### Distributed transactions & reconciliation
35. **Replace a two-phase commit across three services.** [mine + ref · Advanced · Transactions, Messaging]
   - **Thesis:** Replace 2PC with a saga: a sequence of local transactions, each publishing its outcome reliably through an outbox, with a compensating action for every step that can be undone. You give up isolation, so design for visible intermediate states.
   - **60-second answer:** Two-phase commit across three services couples their availability: any participant or the coordinator being slow blocks everyone holding locks. I'd replace it with a saga. Each service does a local transaction and records an event in an outbox table in the same transaction, so state change and event can't diverge. The next step consumes that event idempotently. For each step I define a compensation, like releasing reserved stock or refunding a charge, that runs if a later step fails. I'd use orchestration, with one coordinator holding the saga's state machine, when there are more than two or three steps, because it makes progress and failures visible. The honest cost is isolation: other readers can see the order as 'pending' between steps, so the domain needs explicit pending states, and some steps, like sending an email, can't be compensated and should go last.
   - **Key points:**
     1. **Why 2PC hurts across services.** Participants hold locks while waiting for the coordinator; a coordinator failure can leave them blocked. Every service's availability now depends on all the others, and many brokers and APIs don't support XA anyway.
     2. **Local transactions plus an outbox.** Each step commits its state change and an outgoing event row in one local transaction. A relay publishes the outbox to the broker. This removes the dual-write gap between database and message.
     3. **Idempotent consumers.** Events are delivered at least once, so each step dedupes by event or saga id (an inbox table or idempotency key) before acting.
     4. **Compensations, not rollbacks.** Every step that can be undone gets a semantic inverse: release stock, refund payment, cancel shipment. Compensations must themselves be idempotent and retryable.
     5. **Order steps by reversibility.** Put easily reversed steps first and irreversible ones (shipping, notifying the customer) last, after every step that can fail has succeeded.
     6. **Orchestration vs choreography.** Choreography (services react to each other's events) is fine for two or three steps. Beyond that, an orchestrator with an explicit state machine makes the flow, timeouts and stuck sagas observable.
     7. **Make stuck sagas visible.** Persist saga state with timestamps; alert on sagas stuck in a state too long; provide tooling to retry, compensate or resolve manually.
   - **When to choose what:** Use a saga with outbox and idempotent consumers for cross-service workflows. Keep 2PC only inside one database or between components that natively support it and share an availability fate. If an invariant truly needs atomicity across services, reconsider the service boundary instead.
   - **Numbers:**
     - Latency: a saga's end-to-end time is the sum of steps plus broker hops, often tens to hundreds of milliseconds, so return to the client after the first step with a pending status rather than blocking on the whole saga.
   - **Pitfalls:**
     - Publishing the event outside the local transaction (dual write): a crash between commit and publish loses the event.
     - Compensations that aren't idempotent, so a retried compensation refunds twice.
     - No timeouts: a saga waits forever on a step that will never answer.
     - Ignoring isolation: another flow reads the half-finished state and acts on it.
     - Putting the irreversible step in the middle.
   - **Follow-ups:**
     - _A compensation fails. Now what?_ Retry with backoff; compensations must be idempotent. If it keeps failing, park the saga in a 'needs attention' state with full context and alert. Some failures need a human and a runbook.
     - _How do you handle the lack of isolation?_ Semantic locks (mark the order 'pending' so other flows wait or skip it), commutative updates where possible, and reading only committed final states for decisions.
     - _Orchestrator or choreography for this case?_ Three services with compensations: orchestrator. It centralises the state machine, timeouts and visibility, while each service keeps its own data and logic.
   - **Example:** Order placement: the order service creates an order (pending) and an outbox event; inventory reserves stock; payment charges the card; then the order is confirmed and the confirmation email is sent last. If payment fails, the orchestrator triggers 'release stock' and marks the order failed.
   - **Sources:** [microservices.io: Saga pattern](https://microservices.io/patterns/data/saga.html); [microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
   - _Also asked as:_ How do I implement distributed transactions without 2PC pain?
36. **How do I design an outbox and inbox pattern for reliable events?** [ref · Advanced · Transactions, Messaging]
   - **Thesis:** The outbox makes 'change state and publish an event' atomic by writing both in one local transaction; the inbox makes 'consume and apply' idempotent by recording processed event ids in the consumer's own transaction. Together they give effectively-once processing over at-least-once delivery.
   - **60-second answer:** The problem is the dual write: updating the database and publishing to a broker are two systems, so a crash between them loses or invents events. With an outbox, the service writes its state change and an event row into an outbox table in the same transaction. A relay, either a poller or change data capture on the outbox table, publishes those rows to the broker and marks them sent. Delivery is at least once, so on the consumer side an inbox table keyed by event id is written in the same transaction as the consumer's state change; a duplicate hits the unique key and is skipped. I'd care about ordering, since a per-aggregate key and a single relay per partition preserve it, about relay lag as a metric, and about cleaning up old outbox and inbox rows.
   - **Key points:**
     1. **Outbox: one transaction for state and event.** INSERT/UPDATE business rows and INSERT INTO outbox(id, aggregate_id, type, payload, created_at) in one transaction. Either both commit or neither does.
     2. **Relay: polling or CDC.** A poller selects unsent rows in order and publishes them; simple but adds load and latency. CDC tails the database log and streams outbox inserts; lower latency and load, more infrastructure.
     3. **Inbox: dedupe in the consumer's transaction.** The consumer inserts the event id into its inbox table with a unique constraint and applies the change in the same transaction. A redelivered event fails the insert and is acknowledged without reapplying.
     4. **Preserve per-aggregate ordering.** Use the aggregate id as the message key so events for one entity land on one partition, and publish outbox rows for that aggregate in commit order.
     5. **Monitor relay lag and backlog.** Alert on the age of the oldest unsent outbox row. A stuck relay looks like 'events stopped' downstream, which is easy to miss.
     6. **Retention and cleanup.** Delete or archive sent outbox rows after a period, and keep inbox ids at least as long as the broker can redeliver (its retention plus replay window).
   - **When to choose what:** Use the outbox whenever a service must publish events about its own state changes. Choose a poller for modest volume and simplicity; CDC for high volume or low latency. Use an inbox (or a natural idempotency key) on every consumer that changes state.
   - **Numbers:**
     - Poller tuning: polling every 100–500 ms adds that much latency on average; batch sizes of hundreds keep database load low. CDC latency is typically lower, bounded by log shipping.
     - Inbox size ≈ events/day × retention days × ~50–100 bytes per id row. At 10M events/day and 7 days, about 70M rows, which needs a cleanup job and an index on the id.
   - **Pitfalls:**
     - Publishing directly to the broker inside the transaction 'just to be safe': the broker call can succeed while the transaction rolls back.
     - Multiple pollers without coordination publishing the same rows out of order.
     - Consumers that dedupe in a cache rather than in their own transaction; the cache and the state change can disagree.
     - Never cleaning the outbox, so the poller's query slows down over months.
   - **Follow-ups:**
     - _Why not just make the consumer idempotent and skip the outbox?_ Idempotency fixes duplicates, not loss. Without the outbox a crash after commit but before publish loses the event entirely.
     - _How do you scale the relay?_ Partition the outbox by aggregate key and run one relay per partition, or use CDC, which reads the log sequentially and scales with the broker.
     - _What if the consumer's side effect is external, like sending an email?_ Record the inbox entry and a 'to send' state in one transaction, then send with a provider idempotency key derived from the event id, and mark it sent.
   - **Example:** The order service writes order status 'paid' and an OrderPaid outbox row together. Debezium streams the row to Kafka keyed by order id. The fulfilment service inserts the event id into its inbox and creates a shipment in one transaction; a redelivery is skipped.
   - **Sources:** [microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html); [Debezium: change data capture](https://debezium.io/)
37. **How do I reconcile divergent data across systems?** [ref · Intermediate · Transactions]
   - **Thesis:** Divergence is inevitable between systems that share facts, so plan for it: pick a source of truth per field, compare systematically, classify differences, auto-repair the safe classes, and route the rest to people. Track drift as a metric, not a surprise.
   - **60-second answer:** Whenever two systems hold the same fact, such as our ledger and the bank, the order service and the warehouse, or a database and its search index, they will drift because of bugs, missed events and partial failures. I'd first decide, per field, which system is the source of truth. Then run reconciliation jobs that compare the two on a schedule, matching on stable ids, and classify each difference: missing on one side, value mismatch, timing difference that will resolve itself, or genuinely unexplained. Safe classes, like a projection missing a record, are repaired automatically by replaying from the source of truth. Money-affecting or ambiguous ones go to a review queue with context. And I'd publish drift counts as a metric with an alert, because a sudden rise is often the first sign of a broken pipeline.
   - **Key points:**
     1. **Source of truth per field, not per system.** The bank is authoritative for settled amounts; your ledger is authoritative for what you authorised. Ambiguity about authority is the root of most reconciliation pain.
     2. **Match on stable identifiers.** Carry a shared reference (payment id, order id, external transaction id) through every system. Fuzzy matching on amount and date is a last resort and a source of false matches.
     3. **Classify differences.** Missing in target, missing in source, value mismatch, timing (in flight, will settle), duplicate. Each class has a different owner and action.
     4. **Auto-repair the safe classes.** Replay missing events into projections, rebuild a search document from the database. Repairs must be idempotent and logged.
     5. **Human review for the rest.** Money mismatches and unexplained differences go to a queue with both records, history and suggested action. Track time to resolution.
     6. **Measure drift continuously.** Count differences per class per run; alert on spikes. Run incremental checks frequently and full scans less often.
   - **When to choose what:** Automate repair where the source of truth is clear and the fix is replayable. Escalate where money or customer impact is involved, or where authority is ambiguous. Run small, frequent incremental reconciliations plus periodic full ones.
   - **Numbers:**
     - Cadence example: incremental reconciliation of the last 24 hours every hour, full reconciliation weekly. Use a grace window (for example 2 hours) so in-flight items aren't flagged as missing.
   - **Pitfalls:**
     - No shared id, so matching relies on heuristics and produces false positives.
     - Auto-repairing in the wrong direction because authority wasn't defined.
     - Flagging in-flight records as mismatches and drowning reviewers in noise.
     - Treating reconciliation as a one-off cleanup instead of a permanent control.
   - **Follow-ups:**
     - _Reconciliation finds 0.1% of payments mismatched with the provider. What do you do?_ Classify first: timing, fees, currency rounding, duplicates, missing webhooks. Fix the systematic causes (often a missed webhook path or rounding rule) and send the residue to review.
     - _How do you reconcile huge tables cheaply?_ Compare checksums of key ranges or time buckets first, and only diff rows inside buckets whose checksums differ (a Merkle-tree style approach).
     - _Who owns reconciliation?_ The team owning the source of truth owns the job and the metric; finance or operations often owns the review queue for money cases.
   - **Example:** A lender reconciles its loan ledger with the payment processor's daily settlement file. 98% match by transaction id; timing differences clear the next day; the remainder, mostly reversals the webhook never delivered, are auto-imported or queued for the finance team.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 12 (derived data and integrity)](https://dataintensive.net/)

### Consensus & distributed IDs
38. **Generate unique IDs across regions without a central counter.** [mine + ref · Intermediate · Consistency, Databases]
   - **Thesis:** Generate IDs locally from time plus node identity plus randomness or a sequence, so no request waits on a central counter. Choose the format for the properties you need: sortability, index locality, size, and how much clock skew you can tolerate.
   - **60-second answer:** A central counter is a single point of failure and a cross-region round trip on every insert. Instead, each node generates IDs locally. The common choices are Snowflake-style 64-bit IDs (timestamp, worker id, per-millisecond sequence), which are compact and time-ordered but need unique worker ids and care with clock skew; ULID or UUIDv7, 128 bits with a timestamp prefix plus randomness, which need no coordination and are roughly time-ordered, so they index well; and random UUIDv4, which needs no coordination but scatters inserts across a B-tree. For most systems today I'd pick UUIDv7: no worker-id management, good index locality, and a standard. I'd choose Snowflake-style when 64 bits matter for storage or a downstream system requires integers.
   - **Key points:**
     1. **Why not a central counter.** Every insert pays a network round trip, and the counter's availability caps the whole system's. Across regions that's tens of milliseconds per id and a cross-region dependency.
     2. **Snowflake-style 64-bit.** Timestamp in milliseconds, a worker id, and a sequence number per millisecond. Compact and sortable. Requires assigning unique worker ids (config, a lease in a coordination service) and handling clocks moving backwards.
     3. **UUIDv7 and ULID.** 48-bit millisecond timestamp prefix followed by random bits. No coordination, roughly time-ordered, standard 128-bit format (UUIDv7 is specified in RFC 9562).
     4. **Index locality matters.** Random UUIDv4 keys insert all over a B-tree, causing page splits and poor cache use at scale. Time-prefixed ids append near the right edge of the index.
     5. **Clock skew and regression.** Time-based ids assume clocks roughly agree. If a clock jumps back, a Snowflake generator must wait or refuse; UUIDv7 implementations typically keep a monotonic counter within a millisecond.
     6. **Don't leak information unintentionally.** Time-ordered ids reveal creation time and, with sequences, volume. For public identifiers that matters; use an opaque external id if needed.
   - **When to choose what:** Default: UUIDv7. Snowflake-style when you need 64-bit integers or strict per-node ordering and can manage worker ids. UUIDv4 when ordering is irrelevant and volume is low. Never a global counter on the hot path.
   - **Numbers:**
     - Snowflake capacity: with a 12-bit sequence, one worker can mint 4,096 ids per millisecond, about 4 million per second.
     - UUIDv7 has 74 bits of randomness and version info beyond the 48-bit timestamp; collision risk within one millisecond is negligible at realistic rates.
   - **Pitfalls:**
     - Reusing a worker id after a node is replaced, producing duplicates within the same millisecond.
     - Assuming time-ordered ids give a global order of events across regions; skew makes them only roughly ordered.
     - UUIDv4 primary keys on a very large, write-heavy table, then wondering why insert performance degrades.
     - Exposing sequential ids publicly, making enumeration and volume estimation trivial.
   - **Follow-ups:**
     - _How do you assign Snowflake worker ids safely?_ Lease them from a coordination service with a TTL, or derive them from stable infrastructure identity, and refuse to start if the lease can't be acquired.
     - _Can you sort events across regions by these ids?_ Only approximately. If you need a true order, use a single sequencer per partition or a logical clock; physical time can't give a total order under skew.
     - _What if the database wants integer keys?_ Snowflake-style 64-bit ids fit a bigint, or keep an internal bigint surrogate and expose a UUID externally.
   - **Example:** A multi-region order system switches from a central sequence service to UUIDv7 generated in each service. Insert latency drops by the cross-region round trip, the sequence service disappears as a dependency, and index locality stays good because ids are time-prefixed.
   - **Sources:** [RFC 9562: Universally Unique IDentifiers (UUIDs), including UUIDv7](https://www.rfc-editor.org/rfc/rfc9562); [ULID specification](https://github.com/ulid/spec)
   - _Also asked as:_ How do I design id generation that works across regions?
39. **Where do Raft, Paxos, quorums and gossip appear in a system you would really build?** [mine + ref · Intermediate · Consistency, Reliability]
   - **Thesis:** You use these protocols, you don't implement them. Consensus (Raft, Paxos) sits under coordination and metadata, such as leader election, configuration and locks. Quorum replication sits in data stores to tune consistency against latency. Gossip spreads membership and failure detection where eventual agreement is enough.
   - **60-second answer:** In a system I'd actually build, consensus shows up inside the coordination layer: etcd or ZooKeeper for leader election, configuration and service discovery, or inside a database that uses Raft per data range, like CockroachDB or TiKV. It gives a linearizable log with a majority, so it survives a minority of failures but needs a majority to make progress, and every write costs a round trip to a majority. Quorum replication, where W plus R exceeds N, appears in Dynamo-style stores like Cassandra, letting you trade consistency for latency per operation. Gossip appears in membership and failure detection, for example in Cassandra or Consul, where nodes converge on who is alive without a central authority. My point in an interview is placement: consensus for small, critical metadata; quorums or single-leader replication for bulk data; gossip for membership.
   - **Key points:**
     1. **Consensus gives a single agreed log.** Raft and Multi-Paxos elect a leader and commit entries once a majority acknowledges. That yields linearizable reads and writes for small, critical state.
     2. **Where consensus belongs.** Leader election, distributed locks and leases (with fencing tokens), cluster configuration, schema and shard maps. Typically through etcd, ZooKeeper or Consul, or inside a database's replication layer.
     3. **Cost of consensus.** Every write needs a majority round trip; across regions that's slow. A cluster of 2f+1 nodes tolerates f failures and stops accepting writes without a majority.
     4. **Quorum replication for data.** Dynamo-style stores write to W replicas and read from R of N. W + R > N makes read and write sets overlap. Lower W or R trades consistency for latency per operation.
     5. **Gossip for membership.** Nodes periodically exchange state with random peers, so information spreads in roughly logarithmic rounds. Good for liveness and metadata where eventual agreement is fine; not for decisions needing a single answer.
     6. **Leases need fencing.** A node that believes it holds a lock can pause (GC, network) and act after the lease expired. Attach a monotonically increasing fencing token that the storage layer checks.
   - **When to choose what:** Use a consensus-backed service for anything that must have exactly one answer (who is leader, who holds the lock, what the config is). Use single-leader or quorum replication for bulk data depending on your consistency needs. Use gossip only for membership and soft state. Never write your own consensus implementation for production.
   - **Numbers:**
     - Fault tolerance: 3 nodes tolerate 1 failure, 5 tolerate 2. Going from 3 to 5 adds resilience but also adds write latency because the commit needs 3 acknowledgements instead of 2.
     - Quorum example: N = 3, W = 2, R = 2 gives overlapping quorums; W = 1, R = 1 is fast but can read stale data.
   - **Pitfalls:**
     - Putting bulk or high-volume data into the coordination store; etcd and ZooKeeper are built for small metadata.
     - Using a lock without fencing tokens and getting two writers after a pause.
     - Running an even number of consensus nodes, which adds cost without adding fault tolerance.
     - Assuming W + R > N alone gives linearizability; sloppy quorums, hinted handoff and concurrent writes can still produce anomalies.
   - **Follow-ups:**
     - _Why not run consensus across three regions for all writes?_ Every write would wait for a cross-region majority, adding tens to hundreds of milliseconds. Reserve it for metadata or data that truly needs global linearizability.
     - _What happens to a Raft cluster during a network partition?_ The side with a majority keeps a leader and accepts writes; the minority side can't commit and its old leader steps down when it can't reach a quorum.
     - _How does gossip detect failures?_ Nodes exchange heartbeats or use indirect probing (as in SWIM); a node is suspected after missed responses and declared dead after a timeout, trading detection speed for false positives.
   - **Example:** A job platform uses etcd leases to elect one scheduler leader per shard, with the lease revision as a fencing token on job claims. Job data lives in Postgres with a single primary, and worker membership spreads by gossip so workers find each other without a central registry.
   - **Sources:** [The Raft consensus algorithm](https://raft.github.io/); [Martin Kleppmann: How to do distributed locking (fencing tokens)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
   - _Also asked as:_ How do Raft, Paxos, gossip, and quorum based replication actually fit into my design?

## Reliability & Failure (9)

### Failure modes & degradation
40. **List the ways a three-tier service fails under real load before drawing any boxes.** [mine + ref · Fundamental · Reliability, Observability]
   - **Thesis:** Before drawing boxes, list how it breaks, grouped by blast radius. Under real load the dangerous failures are rarely clean crashes; they're slowness, saturation and feedback loops, because slow is worse than down.
   - **60-second answer:** For a load balancer, app tier and database, I'd list failures in three groups. Resource exhaustion: connection pools running dry, thread pools saturated, memory and GC pauses, disk filling up, file descriptors. Dependency problems: the database slowing under a bad query plan or lock contention, a downstream API timing out, DNS or certificate expiry. Feedback loops: retries multiplying load on a struggling dependency, queues growing without bound, cache expiry causing a stampede, autoscaling reacting too late or thrashing. Then the human and change causes: bad deploys, config pushes, schema migrations, which cause a large share of real incidents. The key insight is that a slow database is worse than a dead one: requests pile up holding connections and threads, and the failure spreads upward. So the design needs timeouts, bounded queues, load shedding and safe deploys before it needs more boxes.
   - **Key points:**
     1. **Saturation and exhaustion.** Connection pools, thread pools, CPU, memory and GC, disk space, ephemeral ports, file descriptors. Each has a hard limit, and hitting it usually looks like latency first, then errors.
     2. **Slow dependencies are worse than dead ones.** A dead dependency fails fast; a slow one ties up callers' threads and connections until they also stall. Without timeouts, one slow query can take down the whole app tier.
     3. **Feedback loops amplify small problems.** Retries multiply load, queues grow until latency is unbounded, cache expiry sends a herd to the database, and autoscaling adds instances that all open new connections to an already struggling database.
     4. **Change is the biggest single cause.** Deploys, config changes, feature flags and migrations trigger many incidents. Progressive rollout and fast rollback matter as much as redundancy.
     5. **Partial and gray failures.** One instance with a bad disk, one zone with packet loss, a load balancer health check that passes while real requests fail. Averages hide these; per-instance metrics find them.
     6. **Time and expiry bombs.** Expiring TLS certificates, clock drift breaking token validation, leap-second and timezone bugs, credentials rotating without the app reloading them.
     7. **Group by blast radius.** Single request, single instance, one zone, whole service, all regions. The design response differs: retry, eject, fail over, shed load, or freeze changes.
   - **When to choose what:** Address failures in this order: change safety (canary, rollback), timeouts and bounded queues everywhere, load shedding and retry budgets, then redundancy. Redundancy without the first three just gives you more instances to fail identically.
   - **Numbers:**
     - Little's law: concurrent requests = arrival rate × latency. At 1,000 requests/s and 50 ms latency you hold 50 in flight; if the database slows to 2 s, you need 2,000 concurrent slots. Pools of 200 exhaust immediately, which is why slowness cascades.
   - **Pitfalls:**
     - Designing only for crash failures and ignoring slowness.
     - Health checks that test 'process is up' rather than 'can serve a real request'.
     - Retries at every layer, multiplying load during exactly the moments you can least afford it.
     - Unbounded queues that convert overload into ever-growing latency instead of fast, honest rejection.
   - **Follow-ups:**
     - _Which failure would you design for first?_ Slow database. It's common and it cascades. Timeouts, bounded pools, a circuit breaker and load shedding contain it.
     - _How do you find gray failures?_ Per-instance and per-zone metrics, outlier detection in the load balancer, and synthetic requests that exercise real paths rather than a health endpoint.
     - _How do you stop autoscaling from making it worse?_ Cap connections per instance and total, scale on saturation signals rather than latency alone, and make sure the database isn't the bottleneck new instances pile onto.
   - **Example:** A single missing index makes a popular query take 3 seconds under load. App threads block on database connections, the pool empties, health checks start failing, the load balancer removes instances, and the remaining ones fail faster. A 300 ms query timeout and load shedding would have kept the rest of the site up.
   - **Sources:** [Google SRE book: Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/); [AWS Builders' Library: Avoiding insurmountable queue backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/)
   - _Also asked as:_ What are all the ways my system can fail under real traffic?
41. **How do I design for graceful degradation instead of hard failure?** [ref · Fundamental · Reliability]
   - **Thesis:** Rank features by importance, decide in advance what each one does when its dependency fails, and test those degraded modes. Graceful degradation is a product decision implemented in code, not an emergent property.
   - **60-second answer:** I'd start with a ranked list: what must work, like checkout and login, what's valuable but optional, like recommendations and reviews, and what's decoration. For every dependency of the critical path, define a fallback: a cached or default value, hiding the feature, a simplified version, or queueing the action to complete later. The core path must not depend on optional features at all, so recommendations timing out never blocks checkout. Implement it with tight timeouts on optional calls, circuit breakers, and feature flags that operators can flip to shed optional work under load. Then test the degraded modes deliberately, because a fallback that's never run tends to be broken when you need it.
   - **Key points:**
     1. **Rank features explicitly.** Critical, important, optional. Do it with product owners, because the ranking is a business decision. It decides what gets shed first under load.
     2. **Define a fallback per dependency.** Serve stale from cache, return a sensible default, hide the widget, show a simplified page, or accept the request and process it later. Write down what the user sees.
     3. **Decouple the critical path.** Critical requests should never wait on optional calls. Fetch optional data in parallel with short timeouts, or load it client-side after the main content.
     4. **Operator controls.** Kill switches and load-shedding flags let on-call turn off expensive optional features within seconds during an incident.
     5. **Static stability.** Prefer designs that keep working with the last known good state when control planes or config services fail, instead of fallbacks that kick in only during failure.
     6. **Test degraded modes.** Fault-inject dependency failures in staging and in game days. Measure that the critical path's latency and success rate stay within SLO.
   - **When to choose what:** Degrade optional features first, then simplify important ones, and protect critical paths at all costs. Prefer fallbacks that are exercised regularly (cached data served all the time with refresh) over rarely used emergency code paths, which tend to be broken.
   - **Numbers:**
     - Timeout budget example: page budget 500 ms; recommendations get 80 ms and are dropped if late; the critical product and price data get the rest.
   - **Pitfalls:**
     - Fallbacks that call another dependency which fails the same way.
     - Degraded modes never tested, discovered broken during the incident.
     - Silent degradation with no metric, so the team doesn't notice a feature has been off for weeks.
     - Fallback paths that are more expensive than the normal path, adding load during overload.
   - **Follow-ups:**
     - _Isn't a fallback just more code that can fail?_ Yes, which is why the best fallbacks are always-on (serve from cache, refresh in background) or very simple (hide the feature). AWS's Builders' Library argues against complex rarely used fallbacks for this reason.
     - _How does the user know something is degraded?_ Only when it matters to them: 'prices may be a few minutes old' or 'we'll email your receipt shortly'. Hiding a recommendation widget needs no message.
     - _Who decides the ranking?_ Product and engineering together, written down before incidents, and revisited when features change.
   - **Example:** During a review-service outage, product pages hide the reviews section and show a cached average rating. Checkout never calls the review service. A dashboard counter shows how many pages were served in degraded mode.
   - **Sources:** [AWS Builders' Library: Avoiding fallback in distributed systems](https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/); [AWS Builders' Library: Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/)

### Retries, breakers & bulkheads
42. **Retries are amplifying an outage. Design retries that do not.** [mine + ref · Intermediate · Reliability]
   - **Thesis:** Retries help with transient blips and hurt in overload. Make them safe by retrying at one layer only, with capped exponential backoff and jitter, a retry budget that limits retries to a small fraction of traffic, deadlines propagated end to end, and only for idempotent operations.
   - **60-second answer:** Retries amplify outages because they multiply load exactly when a dependency is struggling. If five layers each retry three times, one user request can become 243 calls at the bottom. I'd fix it in layers. Retry at one place only, usually the edge closest to the failing call, and have everyone else fail fast. Use capped exponential backoff with jitter so retries spread out instead of arriving in synchronised waves. Add a retry budget, for example retries may be at most 10% of requests, so retries stop automatically when failures are widespread. Propagate a deadline so nobody retries work whose caller has already given up. Only retry idempotent operations or those with idempotency keys, and honour Retry-After and 429 or 503 signals. Finally, a kill switch to disable retries during an incident.
   - **Key points:**
     1. **Understand the amplification.** Retries per layer multiply: 3 attempts at each of 5 layers is 3^5 = 243 attempts at the bottom for one request. Under overload that turns a slowdown into a collapse.
     2. **Retry at one layer.** Pick the layer closest to the failing dependency, or the client, and make intermediate layers pass errors through. Document the choice so new code doesn't add retries silently.
     3. **Capped exponential backoff with jitter.** Wait base × 2^attempt up to a cap, with randomisation (full jitter: a random value between 0 and that bound). Jitter prevents synchronised retry storms.
     4. **Retry budgets.** Track the ratio of retries to requests per client; stop retrying when it exceeds a threshold such as 10%. When most calls fail, retrying adds load without adding success.
     5. **Deadlines, not just timeouts.** Pass the remaining time budget downstream. A service shouldn't start or retry work if the caller's deadline has passed.
     6. **Only safe operations.** Retry reads and idempotent writes; for other writes use idempotency keys. Don't retry errors that won't change, such as 400 or 403.
     7. **Respect server signals and keep a kill switch.** Honour 429/503 with Retry-After. Give operators a flag to turn retries off or down during incidents.
   - **When to choose what:** Few attempts (2–3 total), one layer, jittered backoff, a budget, and deadline propagation. Prefer hedged requests only for idempotent reads with tight tail-latency needs, and only with a budget.
   - **Numbers:**
     - Backoff example: base 100 ms, cap 2 s, full jitter, 3 attempts: waits are random in [0, 100 ms], then [0, 200 ms].
     - Budget example: allow retries up to 10% of request volume per client; above that, fail immediately.
   - **Pitfalls:**
     - Library defaults that retry silently at every layer.
     - Backoff without jitter: all clients retry on the same schedule and hammer the server in waves.
     - Retrying non-idempotent writes, causing duplicates.
     - Retrying after the caller's deadline has passed, doing work nobody will use.
   - **Follow-ups:**
     - _Should the client or the server-side caller retry?_ Usually the layer closest to the failing dependency, because it knows the error type and has the shortest loop. The client retries only when the whole request failed and is idempotent.
     - _How do circuit breakers relate to retry budgets?_ Both stop hammering a failing dependency. A budget limits extra load from retries; a breaker stops calls entirely when the error rate is high. Use both.
     - _When are hedged requests appropriate?_ For idempotent reads where tail latency matters: send a second request after the p95 latency and take the first response, with a cap on the extra load.
   - **Example:** A payment service's database slowed; three layers each retried three times, so database load grew 27x and it fell over. The fix: retries only in the client SDK with jitter and a 10% budget, deadline headers between services, and fail-fast elsewhere. The next slowdown stayed a slowdown.
   - **Sources:** [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/); [Google SRE book: Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)
   - _Also asked as:_ How do I implement retries without causing storms and loops?
43. **Choose and size circuit breakers, bulkheads and timeouts.** [mine + ref · Intermediate · Reliability]
   - **Thesis:** Timeouts bound how long you wait, bulkheads bound how much of your capacity one dependency can consume, and circuit breakers stop calling a dependency that's clearly failing. Size each from measured behaviour, not defaults.
   - **60-second answer:** I'd set timeouts first, because without them nothing else works. Each call's timeout sits a little above that dependency's healthy p99 and always below the caller's own remaining deadline. Then bulkheads: a separate connection or concurrency pool per dependency, sized by Little's law from its normal throughput and latency plus headroom, so a slow recommendation service can only exhaust its own slots, not the threads checkout needs. Then circuit breakers: open when the error or slow-call rate over a rolling window crosses a threshold with a minimum request count, fail fast while open, and after a cool-down let a few probe requests through in half-open state. When open, return the fallback. I'd validate the numbers with load tests and fault injection.
   - **Key points:**
     1. **Timeouts from data.** Set each call's timeout slightly above the dependency's healthy p99 (for example p99 × 1.5), and never longer than the caller's remaining deadline. Defaults like 30 or 60 seconds are almost always wrong.
     2. **Bulkheads per dependency.** Separate pools (threads, connections, semaphores) so one slow dependency can't consume shared capacity. Critical dependencies get reserved capacity.
     3. **Size pools with Little's law.** Needed concurrency = throughput × latency. 500 calls/s at 40 ms is 20 concurrent; add headroom for spikes (say 2x) and cap there. A larger pool only queues more work behind a slow dependency.
     4. **Breaker trip conditions.** Open when the failure rate or slow-call rate over a rolling window exceeds a threshold (for example 50%), with a minimum number of calls so a handful of errors at low traffic doesn't trip it.
     5. **Half-open probing.** After a cool-down, allow a few trial calls; close on success, reopen on failure. Add jitter so many instances don't probe at the same instant.
     6. **Fallback while open.** Fail fast with a clear error, serve cached data, or degrade the feature. An open breaker without a fallback is still better than piling up timeouts.
   - **When to choose what:** Every remote call gets a timeout. Dependencies that are optional or historically flaky get a bulkhead and a breaker. Critical dependencies get reserved capacity and tight timeouts. Tune from production metrics and verify with fault injection.
   - **Numbers:**
     - Example: dependency p99 = 120 ms healthy → timeout 200 ms. Throughput 300/s × 0.12 s = 36 concurrent → bulkhead of about 70.
     - Breaker example: rolling window of 20 seconds, minimum 50 calls, open at 50% failures or slow calls, 10-second cool-down, 5 probe calls in half-open.
   - **Pitfalls:**
     - Timeouts longer than the caller's deadline, so work continues after nobody is waiting.
     - One shared thread pool for all dependencies, which defeats bulkheads.
     - Breakers with no minimum call count, flapping on low traffic.
     - Per-instance breakers that each need to see failures before opening; at large fleet sizes that's a lot of failed calls. Consider shared signals or outlier detection at the load balancer.
   - **Follow-ups:**
     - _How do you pick the breaker threshold?_ From the dependency's normal error rate: well above normal noise but low enough to trip before callers saturate. Validate by injecting failures and watching caller saturation.
     - _Where should breakers live: client library, sidecar or gateway?_ Closest to the caller that knows the fallback, often the client library. A service mesh sidecar can provide timeouts and outlier ejection uniformly but doesn't know business fallbacks.
     - _What do you do about retries with breakers?_ Retries count toward the breaker's window, and an open breaker should stop retries entirely.
   - **Example:** A product page calls pricing (critical) and recommendations (optional). Recommendations get a 20-slot bulkhead, an 80 ms timeout and a breaker; when it degrades, the breaker opens within seconds and the page renders without recommendations while pricing keeps its reserved pool.
   - **Sources:** [Martin Fowler: Circuit breaker](https://martinfowler.com/bliki/CircuitBreaker.html); [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
   - _Also asked as:_ How do I design circuit breakers and bulkheads correctly?

### Multi-region & outages
44. **Fail over between two regions without split brain.** [mine + ref · Advanced · Reliability, Consistency]
   - **Thesis:** Split brain happens when both regions believe they own the same data. Prevent it structurally: one writer per data partition at any time, ownership decided by a quorum or an explicit operator action, and fencing tokens so a deposed writer's late writes are rejected. State the data-loss window (RPO) and recovery time (RTO) up front.
   - **60-second answer:** With two regions, the hard part isn't moving traffic, it's making sure only one region accepts writes for a given piece of data. I'd assign each data partition a single writer region. Failover changes that ownership through something that can't itself split: either a consensus service with a tiebreaker in a third location, or a deliberate operator decision, because two regions alone can't distinguish 'the other is dead' from 'the link is down'. Every ownership change increments an epoch, and storage rejects writes with an old epoch, which is fencing. With asynchronous replication, failover loses whatever hadn't replicated, so the RPO is roughly the replication lag; synchronous replication removes that loss but adds cross-region latency to every write. Then traffic shifting, health checks and, most importantly, regular failover drills.
   - **Key points:**
     1. **Single writer per partition.** At any moment exactly one region may write a given partition. Reads can be served anywhere with known staleness. This is the structural defence against split brain.
     2. **Two regions can't vote alone.** If the link drops, each side sees the other as dead. Use a witness in a third location for quorum, or make failover a manual, deliberate action with a runbook.
     3. **Fencing with epochs.** Each ownership change increments an epoch or term. Writes carry it, and the storage layer rejects writes from older epochs, so a region that comes back still thinking it's primary can't corrupt data.
     4. **State RPO and RTO.** Async replication: RPO roughly equals replication lag at failure time. Sync: RPO near zero, but every write pays a cross-region round trip. RTO is detection plus decision plus promotion plus DNS or traffic shift time.
     5. **Traffic shifting.** Health-checked global load balancing or DNS with low TTLs, plus clients that respect it. Account for long-lived connections and DNS caching beyond the TTL.
     6. **Capacity in the surviving region.** The survivor must handle the full load. Either keep it provisioned (active-active at under 50% each) or have reliable fast scaling and test it.
     7. **Practise failover.** Run scheduled drills. Untested failover is a theory; the first real use usually uncovers stale runbooks, missing permissions and hidden dependencies on the failed region.
   - **When to choose what:** Active-passive with async replication and manual or witness-based failover is the common, defensible default. Active-active needs partitioned ownership (home region per account) or conflict-free data types. Synchronous cross-region replication only where zero data loss justifies the write latency.
   - **Numbers:**
     - RPO example: async replication lag of 2 seconds at 1,000 writes/s means up to about 2,000 writes at risk on failover; they must be reconciled or are lost.
     - RTO budget example: 1 minute detection, 5 minutes decision, 2 minutes promotion, 5 minutes for traffic to move = about 13 minutes.
   - **Pitfalls:**
     - Automatic failover based on one region's view of the other's health; flaky links cause flapping or split brain.
     - No fencing, so the old primary keeps accepting writes after it's been replaced.
     - Hidden dependencies on the failed region: auth service, secrets store, container registry, DNS control plane.
     - Never failing back: the procedure to return to the original region is untested too.
   - **Follow-ups:**
     - _What happens to the writes that didn't replicate?_ With async replication, they exist only in the failed region. When it comes back, they must be reconciled: replayed if safe, flagged for review if they conflict. Decide this before the incident.
     - _Why not active-active everywhere?_ Concurrent writes to the same data in two regions need conflict resolution, which is wrong for invariants like balances. Active-active works when each account or partition has one home region.
     - _How often would you drill?_ Quarterly at minimum for full failover; smaller component failovers more often. Measure actual RTO and RPO each time.
   - **Example:** A lending platform keeps each customer's data homed in one region with async replication to the other. A regional outage triggers an operator-approved failover: the coordination service bumps the epoch, the standby database is promoted, and global load balancing moves traffic. Measured RTO was 11 minutes, with about 3 seconds of writes to reconcile.
   - **Sources:** [Martin Kleppmann: How to do distributed locking (fencing tokens)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html); [AWS Well-Architected: Disaster recovery objectives (RTO and RPO)](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/disaster-recovery-dr-objectives.html)
   - _Also asked as:_ How do I run in multiple regions and fail over cleanly?
45. **How do I design for data center outage scenarios?** [ref · Advanced · Reliability]
   - **Thesis:** Design for the loss of a whole site by spreading across failure domains (zones first, then regions), keeping enough capacity to survive the loss without scaling up, replicating data with a stated loss window, and proving it with regular drills.
   - **60-second answer:** I'd treat it as a sequence of failure domains: instance, zone, region. Zone loss is common enough that the system should survive it with no human action: run in at least three zones, keep enough capacity that losing one leaves the rest under their limits, replicate data synchronously within the region, and avoid depending on control planes during the failure, which AWS calls static stability. Region loss is rarer and more expensive to handle; there I'd choose a strategy per service tier, from backup-and-restore for internal tools to warm standby or active-active for revenue-critical paths, each with a stated RPO and RTO. Then I'd look hard for hidden single points of failure, like DNS, identity, secrets, CI/CD and third-party SaaS, and run drills to measure real recovery times.
   - **Key points:**
     1. **Failure domains in layers.** Instance, rack, zone, region, provider. Each layer is rarer and costlier to survive. Decide explicitly which layer each service must survive automatically.
     2. **N+1 capacity per zone.** With three zones, each should run at no more than about two thirds of its capacity so losing one leaves the other two able to absorb the load without new instances.
     3. **Static stability.** Keep the system working without control-plane actions during the failure: pre-provisioned capacity, cached configuration, no dependency on launching instances or changing DNS to survive a zone loss.
     4. **Data replication with stated loss.** Synchronous replication across zones (low latency, near-zero loss). Asynchronous across regions, with RPO equal to lag. Backups for the case where replication copies corruption too.
     5. **Tiered regional strategies.** Backup and restore (hours), pilot light (core data replicated, compute off), warm standby (scaled-down copy running), active-active (full capacity in both). Match each service's tier to its business impact.
     6. **Hunt hidden dependencies.** Authentication, secrets, DNS, container registry, CI/CD, monitoring and third-party APIs often live in one region. If they're down, your failover may be impossible.
     7. **Drill and measure.** Simulate zone loss regularly (block traffic to one zone), and region loss on a schedule. Track measured RTO and RPO against targets.
   - **When to choose what:** Every production service survives a zone loss automatically. Regional resilience is tiered by business impact, because full active-active everywhere is expensive. Backups and restore tests are mandatory regardless, since replication faithfully copies mistakes.
   - **Numbers:**
     - Capacity rule: with N zones, run each at most (N − 1)/N of its capacity: 66% for three zones, 50% for two.
     - Cost intuition: warm standby for a region roughly adds a fraction of production cost; active-active roughly doubles infrastructure.
   - **Pitfalls:**
     - Running at 80% in each of three zones and discovering a zone loss overloads the rest.
     - Failover that requires launching instances during a regional event, when the control plane is also struggling.
     - Monitoring and alerting hosted in the region that failed.
     - Treating replication as backup; a bad migration or deletion replicates instantly.
   - **Follow-ups:**
     - _How do you test zone loss without causing an outage?_ Start in staging, then shift traffic away from one zone in production during low-traffic hours with a quick rollback, and expand the scope as confidence grows.
     - _Which services deserve active-active?_ Those where minutes of downtime cost more than doubling infrastructure: usually the core transaction path, not internal tools or batch analytics.
     - _What's the most common surprise in regional drills?_ Hidden dependencies: an auth or secrets service that only runs in the primary region, or deploy tooling that can't reach the standby.
   - **Example:** A payments service runs in three zones at 60% utilisation with synchronous database replicas across zones. A zone outage removed a third of instances; the rest absorbed load with p99 rising from 120 to 180 ms and no errors, and no human action was needed.
   - **Sources:** [AWS Builders' Library: Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/); [AWS Well-Architected: Disaster recovery objectives](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/disaster-recovery-dr-objectives.html)

### Releases & rollback
46. **Plan a rollback for a release that has already migrated data.** [mine + ref · Advanced · Migration, Reliability]
   - **Thesis:** Once new code has written data, rolling back the code isn't enough: the old version must still read what the new version wrote. Design releases so the schema and data formats are backward and forward compatible across adjacent versions, and decide in advance when you roll back versus fix forward.
   - **60-second answer:** The rule I'd follow is that any release must be safe to run alongside, and roll back to, the previous version. That means separating schema changes from behaviour changes: expand the schema first in a release that doesn't use it yet, then ship code that writes the new shape while still writing or tolerating the old one, and only contract after the new code has been stable for a full cycle. New data formats are introduced behind a feature flag, so turning the flag off stops new writes without a deploy. Old code must ignore unknown fields and tolerate new enum values. If something goes wrong after data was written, I'd decide using a pre-agreed rule: roll back if the new data is readable by the old code and the issue is user-facing; fix forward if rollback would orphan or misread data. And keep a script ready to repair or translate the records written during the bad window.
   - **Key points:**
     1. **N and N-1 must coexist.** During rollout and after a rollback, two versions run against the same data. Every change must be compatible in both directions across adjacent versions.
     2. **Expand, migrate, contract.** Release 1 adds nullable columns or new tables. Release 2 writes both old and new shapes. Release 3 reads new. Release 4 removes old, only after a full cycle with no rollback.
     3. **Feature flags for new data paths.** Gate new write formats behind flags so you can stop producing new-format data instantly, independent of a code rollback.
     4. **Tolerant readers.** Old code ignores unknown fields, handles new enum values with a safe default, and doesn't crash on nulls in new columns.
     5. **Rollback vs fix-forward rule.** Roll back when the old version can read everything written and the fix isn't trivial. Fix forward when rollback would misread new data or the fix is a small, low-risk change.
     6. **Repair tooling for the bad window.** Identify records written during the faulty period (by version tag or timestamp) and have a script to correct or translate them.
     7. **Test rollback in CI.** Run the previous version against a database migrated by the new one. If tests fail, the release isn't rollback-safe.
   - **When to choose what:** Make rollback-safety a release requirement, tested automatically. Destructive schema changes (dropping or renaming columns, changing types) always go in a separate, later release.
   - **Numbers:**
     - Contract delay example: keep the old column until the new release has run for at least one full business cycle (often a week, or a month for monthly batch jobs) with no rollback.
   - **Pitfalls:**
     - Renaming a column in the same release that starts using the new name: rollback breaks immediately.
     - Old code that crashes on an unknown enum value written by new code.
     - Contracting too early, then needing to roll back.
     - Assuming 'it's just a code rollback' when caches, queues and search indexes now hold new-format data.
   - **Follow-ups:**
     - _The new version wrote 50,000 records in a format the old version misreads. Now what?_ Don't roll back blindly. Disable the flag to stop new writes, fix forward or deploy a version of old code that can read both formats, then repair the 50,000 records with a script.
     - _How do you enforce rollback-safety?_ A CI job that runs N-1 against the schema and data produced by N, plus migration linting that blocks destructive changes in the same release as code changes.
     - _What about messages already in queues?_ Same rule: consumers of N-1 must handle messages produced by N, which is why event schemas need compatibility checks too.
   - **Example:** A release added a 'repayment_schedule_v2' JSON field and started writing it. Calculations were wrong for some products. Because v2 was behind a flag and the old field was still written, on-call turned the flag off, rolled back the code, and a repair job recomputed affected schedules from the old field.
   - **Sources:** [AWS Builders' Library: Ensuring rollback safety during deployments](https://aws.amazon.com/builders-library/ensuring-rollback-safety-during-deployments/); [Martin Fowler: Parallel change (expand and contract)](https://martinfowler.com/bliki/ParallelChange.html)
   - _Also asked as:_ How do I design a rollback strategy for bad releases?

### SLOs
47. **Define SLOs for a lending platform and derive alerts from the error budget.** [mine + ref · Advanced · Observability, Reliability]
   - **Thesis:** Pick a few indicators that reflect what borrowers and partners experience, set targets from user need and cost, and alert on how fast the error budget is burning rather than on raw thresholds. Tie budget exhaustion to a release policy so the SLO changes behaviour.
   - **60-second answer:** For a lending platform I'd choose user-journey SLIs: application submission success rate and latency, time to credit decision for instant products, disbursal success within the promised window, repayment processing success, and availability of the account API for partners. Each SLI is measured close to the user, at the load balancer or from client telemetry. Targets come from user expectations and cost, for example 99.9% of applications submitted successfully over 28 days. The error budget is the allowed failure, 0.1%. Alerts use multi-window burn rates: page when the budget is burning fast enough to be exhausted in about two days, measured over both one hour and five minutes so alerts are fast and reset quickly; open a ticket for slow burns. And the policy: when the budget is spent, feature releases pause and reliability work takes priority until it recovers.
   - **Key points:**
     1. **SLIs follow user journeys.** Submission success and latency, decision time, disbursal completed within the promised window, repayment posted correctly, partner API availability. Avoid CPU or pod counts; users don't feel those directly.
     2. **Measure near the user.** Use load balancer logs, API gateway metrics or client telemetry, not only server-side success counters, which miss requests that never arrived.
     3. **Targets from need and cost.** Each extra nine costs a lot more. 99.9% over 28 days allows about 40 minutes of full outage; 99.99% about 4 minutes. Choose per journey.
     4. **Error budget = 1 − target.** It quantifies acceptable unreliability and turns 'is it reliable enough?' into a number shared by product and engineering.
     5. **Burn-rate alerts.** Burn rate is how fast you consume budget relative to plan. Page on fast burns (for example 14.4x over 1 hour and 5 minutes, which spends about 2% of a 30-day budget in an hour), ticket on slow burns (for example 6x over 6 hours, 1x over 3 days).
     6. **Policy with teeth.** Agree in advance: budget exhausted means release freeze for features, focus on reliability, and a review. Without a policy, SLOs become dashboards.
     7. **Asynchronous journeys need freshness SLIs.** Disbursal and repayment are often batch or event-driven; measure 'completed within X minutes of request' rather than request success alone.
   - **When to choose what:** Three to five SLOs per product, covering the journeys that cost money or trust when they fail. Page only on fast burn of a user-facing SLO; everything else becomes a ticket or dashboard. Revisit targets quarterly.
   - **Numbers:**
     - 99.9% over 30 days = 43.2 minutes of total downtime equivalent. 99.95% = 21.6 minutes. 99.99% = 4.3 minutes.
     - Fast-burn rule from the Google SRE workbook: burn rate 14.4 over a 1-hour window (with a 5-minute confirmation window) consumes 2% of a 30-day budget.
   - **Pitfalls:**
     - SLOs on internal metrics (CPU, queue depth) that don't reflect user pain.
     - A target of 100%, which leaves no room for change and is never true.
     - Static threshold alerts that page on brief blips and miss slow, steady burns.
     - No release policy, so budget exhaustion changes nothing.
   - **Follow-ups:**
     - _How do you set an SLO for disbursal, which depends on a bank?_ Measure the part you own (request accepted and sent to the bank within X) separately from end-to-end completion, and track the bank's performance as a dependency SLI with its own report.
     - _What if a partner demands 99.99%?_ Price it: show the architecture and cost needed, and offer an SLA below your internal SLO so there's margin.
     - _Why multi-window alerts?_ The long window gives significance and avoids paging on blips; the short window makes the alert stop quickly once the problem is fixed.
   - **Example:** The instant-loan journey has an SLO of 99.5% of decisions within 30 seconds over 28 days. A slow credit bureau integration starts burning budget at 10x; the 1-hour/5-minute alert pages on-call, who enables a cached-score fallback for repeat customers while the bureau recovers.
   - **Sources:** [Google SRE workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/); [Google SRE book: Service level objectives](https://sre.google/sre-book/service-level-objectives/)
   - _Also asked as:_ How do I define SLOs and design around them?

### Recovery
48. **How do I make rebuild from scratch possible if everything is lost?** [ref · Advanced · Reliability, Databases]
   - **Thesis:** Rebuilding from nothing requires three things to exist outside the failed environment: the definition of the infrastructure (as code), the data (as tested, isolated backups or a durable log), and the knowledge of order (a documented, rehearsed bootstrap). If any one is missing, the rebuild is a guess.
   - **60-second answer:** I'd make everything reproducible from a small set of durable artefacts. Infrastructure and configuration as code in version control, so a new account or region can be provisioned by running pipelines, not by memory. Data backed up to an isolated location, in a different account with deletion protection, so ransomware or a compromised admin can't delete production and backups together, with restore tests on a schedule because untested backups are hopes. Where possible, an event log or ledger as the source of truth, so derived stores can be rebuilt by replay. Secrets and keys escrowed separately. Then a written bootstrap order, covering identity, networking, secrets, data stores, core services and edge, rehearsed in game days with a measured recovery time. The goal is that a different team could rebuild it from the runbook.
   - **Key points:**
     1. **Infrastructure as code.** Networks, clusters, databases, DNS, IAM and configuration are defined in code and applied by pipelines. Manual console changes are detected as drift and reverted.
     2. **Isolated, immutable backups.** Backups in a separate account or provider with write-once or deletion-protection settings, so an attacker or mistake with production credentials can't destroy them.
     3. **Restore drills.** Regularly restore real backups into a clean environment and verify data integrity and application function. Measure time to restore.
     4. **Replayable source of truth.** An append-only event log or ledger lets you rebuild caches, search indexes and read models by replay instead of backing up each one.
     5. **Secrets and keys escrow.** Encryption keys, root credentials and break-glass access stored separately with documented recovery. Losing the key to encrypted backups is the same as losing the backups.
     6. **Documented bootstrap order.** Dependencies form an order: identity and networking, secrets, data stores, core services, edge and DNS. Circular dependencies (deploy tool needs the service it deploys) must be found and broken.
     7. **Measure recovery time.** Game days that rebuild a service or environment from scratch give a real RTO, which is usually much longer than assumed the first time.
   - **When to choose what:** Tier the effort: core data and the systems needed to rebuild everything else get the strongest isolation and the most frequent drills. Derived data relies on replay. Everything is code; nothing depends on one person's memory.
   - **Numbers:**
     - Restore-time estimate: data size ÷ effective restore throughput. 10 TB at 500 MB/s is about 5.5 hours before indexes are rebuilt and the application is verified, which often doubles it.
   - **Pitfalls:**
     - Backups in the same account as production, deletable with the same credentials.
     - Never testing restores, then discovering a backup format or key problem during the disaster.
     - Circular dependencies: the CI system, secrets store or auth service needed to rebuild is itself part of what was lost.
     - Console-created resources no one captured in code.
   - **Follow-ups:**
     - _How do you protect against ransomware specifically?_ Immutable backups with retention locks in an isolated account, separate credentials, monitoring for mass deletion or encryption, and practised restores.
     - _What's the minimum restore drill?_ Quarterly restore of the most important database to an isolated environment, run application checks against it, and record time and issues.
     - _How do you handle third-party SaaS data?_ Export it regularly to your own storage where possible, and document how to rebuild configuration if the vendor account is lost.
   - **Example:** A team runs an annual 'empty account' drill: a fresh cloud account, the infrastructure repo and the backup vault. The first drill took four days and found an IAM role created by hand and a secrets bootstrap loop. After fixes, the second took nine hours.
   - **Sources:** [AWS Well-Architected: Disaster recovery objectives](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/disaster-recovery-dr-objectives.html); [Google SRE book: Data integrity](https://sre.google/sre-book/data-integrity/)

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
   - **Thesis:** Lead with the constraint, not the design. A skeptic is persuaded by seeing that you considered their option, priced your own downside honestly, and know what evidence would change your mind.
   - **60-second answer:** I'd spend the first minute restating the requirement and the one or two constraints that drive the decision, for example p99 under 100 ms and a team of four, and check we agree on them. Then the decision in one sentence. Then the alternatives I rejected, including the one the architect probably prefers, each with the specific reason it lost against those constraints. Then what we're giving up, said plainly before they have to point it out. I'd close with the trigger that would make me reverse the decision and how cheaply we'll detect it: a metric, a load test, a date. If they still disagree, I'd ask which constraint they weigh differently, because that's usually where the real disagreement is.
   - **Key points:**
     1. **Agree on the problem first.** Restate the requirement and the deciding constraints and get a nod. Many design arguments are really disagreements about requirements, and they dissolve once that's surfaced.
     2. **State the decision in one sentence.** For example: 'One Postgres primary with read replicas, not a distributed SQL database.' A crisp claim is easier to examine than a diagram.
     3. **Steelman the alternatives.** Present the skeptic's preferred option at its strongest, then show why it loses on these constraints: cost, team skills, latency, timeline. Strawmanning it loses the room immediately.
     4. **Name your costs before they do.** 'This caps us at roughly X writes per second and means a migration in about 18 months if growth holds.' Saying it first removes the gotcha and shows you've done the arithmetic.
     5. **Show how reversible it is.** Distinguish one-way doors (data model, public API, deep vendor lock-in) from two-way doors. Point to the seams that make reversal cheaper: an interface boundary, an export path.
     6. **Set kill criteria.** A measurable trigger, an owner and a check date. 'If p99 write latency exceeds 50 ms at peak or we pass 5 TB, we revisit.' That turns the debate into a plan.
     7. **Find the crux if you still disagree.** Locate the specific assumption you differ on (growth rate, failure tolerance, team size) and propose a cheap experiment to settle it. If it's their call, record the reasoning and commit.
   - **When to choose what:** Push hard on one-way doors; concede quickly on two-way doors where trying is cheaper than arguing. A disagreement about facts needs data; a disagreement about values (cost against safety, speed against flexibility) needs a decider.
   - **Numbers:**
     - A five-minute shape: about 1 minute on problem and constraints, 30 seconds on the decision, 2 minutes on alternatives and costs, 1 minute on reversal criteria, the rest for questions.
   - **Pitfalls:**
     - Defending the diagram instead of the decision: reasons persuade, boxes don't.
     - Strawmanning the alternative; the skeptic notices and stops listening.
     - Hiding the downside and letting them find it.
     - Treating it as a contest: being right while leaving the architect unheard costs you the next review.
     - Unfalsifiable claims such as 'it will scale' instead of a number and a test.
   - **Follow-ups:**
     - _What would make you change your mind?_ Have a specific answer ready: a metric threshold, a requirement change or a test result, plus when you'll check it.
     - _Why not just use X? Everyone does._ Acknowledge where X is genuinely better, then tie your choice back to the constraints. Popularity is evidence about ecosystem and hiring, which you can price, not a reason on its own.
     - _I'm the approver and I think you're wrong._ Ask which constraint they weigh differently, record the decision and its rationale, and commit. If the decision is reversible, propose a checkpoint to revisit it with data.
   - **Example:** Proposing a modular monolith instead of microservices for a new lending product, with a team of six and a nine-month deadline. The architect preferred services for future scale. The defence conceded that independent scaling and deploys were being given up, showed module boundaries drawn along the future service lines, and set a trigger: split a module out when its team or deploy cadence diverges from the rest.
   - **Sources:** [Michael Nygard: Documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
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
