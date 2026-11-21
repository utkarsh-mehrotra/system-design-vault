# Staff Design Vault

Generated from questions.json. [mine] = original question; [ref] = title from a third-party list. All answer outlines written independently.

## Scale & Traffic (10)

### Request path & scaling basics
1. **Walk one request from DNS to the database and back. Where does each millisecond go?** [mine + ref · Fundamental · Latency]
   - **Trap:** Listing the hops (DNS, load balancer, server, database) and stopping there, or saying the database is always the slow part. — _Why it fails:_ A list of boxes shows no sense of where time actually goes. For distant users, connection setup and TLS round trips often cost more than the query, and the tail comes from queueing and fan-out, not the median hop. — _Probing:_ Whether you can put rough numbers on each hop and tell p50 causes apart from p99 causes. — _Say:_ "At p50 this is dominated by round trips, so edge termination and connection reuse matter most; at p99 it's queueing, cache misses and the slowest downstream call."
   - **Thesis:** Name every hop, give each a latency budget, and say which hops dominate the tail. For most web requests the network round trips (DNS, connection setup, TLS) and the slowest dependency call dominate, not the application code.
   - **60-second answer:** A browser request goes: DNS resolution, usually cached but potentially tens of milliseconds on a miss; TCP and TLS setup, one to two round trips to the edge, which is why terminating TLS at a nearby CDN or edge point matters; the edge either serves from cache or forwards over a warm connection to the origin's load balancer; the load balancer picks a healthy instance; the service authenticates, maybe checks a cache, then queries the database over a pooled connection; the database finds rows via an index, from memory if hot, from disk if not; and the response returns the same way, possibly compressed. I'd put rough numbers on each and point out that p50 is dominated by network distance while p99 is dominated by queueing, cache misses, garbage collection and the slowest downstream call. That tells you where to optimise: move the edge closer, reuse connections, cache, and cut the slowest dependency.
   - **Key points:**
     1. **DNS.** Usually answered from the browser or OS cache. On a miss, a recursive resolver lookup can take tens of milliseconds. Low TTLs help failover but increase misses.
     2. **Connection setup.** TCP needs one round trip; TLS 1.3 adds one more (TLS 1.2 adds two). At 80 ms round trip time to a distant origin, that's 160–240 ms before the first byte. An edge 10 ms away cuts this dramatically.
     3. **Edge or CDN.** Serves cacheable content directly. For dynamic requests it forwards over pre-established, long-lived connections to the origin, avoiding repeated setup costs.
     4. **Load balancer.** Adds well under a millisecond typically, but its algorithm and health checks decide whether you land on a slow or overloaded instance.
     5. **Service work.** Authentication, validation, business logic and serialisation. Often a few milliseconds, but GC pauses and thread-pool queueing appear here in the tail.
     6. **Cache and database.** An in-memory cache hit is around a millisecond or less in the same zone. A database query using an index on hot data takes about a millisecond; a cold disk read or a bad plan can take hundreds.
     7. **Where p99 comes from.** Queueing under load, cache misses, slow dependencies, retries, and fan-out (the request waits for the slowest of many calls).
   - **When to choose what:** To cut median latency: move termination closer to users, reuse connections, cache aggressively. To cut tail latency: reduce fan-out, set timeouts, remove queueing, fix slow queries and GC. Measure each hop with tracing before optimising.
   - **Numbers:**
     - Order-of-magnitude figures: same-zone network round trip around 0.5 ms or less; cross-region tens of milliseconds; intercontinental 100 ms or more; memory reference nanoseconds; SSD random read around 0.1 ms.
     - Budget example for a 200 ms target: DNS and connection 40 ms (with edge), edge to origin 20 ms, service 30 ms, cache or database 20 ms, response transfer 30 ms, margin 60 ms.
   - **Pitfalls:**
     - Optimising application code when most time is spent in round trips.
     - Opening a new database or HTTP connection per request instead of pooling.
     - Looking only at averages, which hide the tail where users notice slowness.
     - Forgetting response size: large payloads over slow mobile links can dominate.
   - **Follow-ups:**
     - _How would you measure where the time goes?_ Real-user monitoring for client-side phases (DNS, connect, TLS, first byte), distributed tracing for server hops, and database query timing. Compare p50 and p99 per hop.
     - _What changes for a mobile app on a poor network?_ Round trips dominate even more: batch requests, reuse connections (HTTP/2 or HTTP/3), compress, and cache on the device.
     - _How does HTTP/3 help?_ QUIC combines transport and TLS handshakes, avoids head-of-line blocking across streams, and handles network changes better, which helps lossy mobile connections.
   - **Example:** A checkout page at 900 ms p99 for users in Asia hitting a US origin. Tracing showed 400 ms in connection setup and TLS. Terminating TLS at a regional edge with warm connections to the origin cut p99 to 450 ms without touching application code.
   - **Sources:** [Ilya Grigorik: High Performance Browser Networking](https://hpbn.co/); [Jeff Dean and Luiz Barroso: The tail at scale](https://research.google/pubs/the-tail-at-scale/)
   - _Also asked as:_ How does a request flow end-to-end through a production system?
2. **Read traffic grows 10x in one quarter. What do you change first, and what do you refuse to change?** [mine + ref · Intermediate · Scaling, Caching]
   - **Trap:** "Shard the database" or "move to microservices" as the first move. — _Why it fails:_ Sharding is the most expensive and least reversible step, and reads usually scale far more cheaply with caching and replicas. Changing architecture or APIs mid-growth multiplies risk. — _Probing:_ Do you measure before acting, know the cheap-to-expensive order, and protect contracts other teams depend on? — _Say:_ "I'd load test to find the first bottleneck, then cache, add replicas, and scale stateless tiers, in that order, while keeping the API and data model frozen."
   - **Thesis:** Measure where the first bottleneck will be, then add read capacity in order of cost: caching, read replicas, then partitioning. Hold the API contract and the data model steady so clients and other teams don't have to change with you.
   - **60-second answer:** First I'd find out what breaks first at 10x, with load tests and the current saturation of each tier, rather than guess. For read growth the usual order is: cache hot, read-mostly data, at the edge for public content and in a shared cache for computed results, which can absorb most of the growth if the hit ratio is high; add read replicas for the database, with read-your-writes handled for users who just wrote; make the service tier stateless and autoscaled; and only then partition data if a single primary or dataset is the limit. What I'd refuse to change is the public API contract and the core data model, because changing those forces every client and team to move at once; I'd also refuse a rewrite under deadline pressure. The goal is to scale behind stable interfaces.
   - **Key points:**
     1. **Measure before acting.** Load test at 2x, 5x, 10x in a production-like environment, and look at saturation per tier (CPU, connections, cache memory, database I/O). The first bottleneck is often not where people expect.
     2. **Cache first.** Edge caching for public or per-region content, an application cache for expensive computed results, and HTTP caching headers. A 90% hit ratio means the backend sees one tenth of the reads.
     3. **Read replicas second.** Replicas scale reads horizontally. Handle replication lag: route reads needing fresh data to the primary or use session guarantees.
     4. **Stateless services, autoscaled.** Move session state to a shared store, set autoscaling on saturation signals, and make sure connection pools don't overwhelm the database as instances multiply.
     5. **Partition last.** Sharding is the most expensive change: data movement, cross-shard queries, operational complexity. Do it when a single dataset or primary truly can't keep up.
     6. **What not to change.** Public API contracts, core data model and identifiers. Changing these during a growth spurt multiplies risk and coordination cost.
     7. **Protect against the spike.** Rate limits, load shedding and graceful degradation buy time while capacity catches up.
   - **When to choose what:** Cache, then replicas, then horizontal service scaling, then partitioning, in that order unless measurement shows a different first bottleneck. Never trade API stability for a quick scaling win.
   - **Numbers:**
     - Cache math: at 10x traffic and a 90% hit ratio, origin reads are 10 × 0.1 = 1x today's load. At 80% hit ratio, origin load is 2x, which shows how sensitive capacity is to hit ratio.
     - Replica math: if the primary can serve 5,000 reads/s and you need 40,000, you need around 8 read-serving nodes plus headroom, assuming reads spread evenly.
   - **Pitfalls:**
     - Sharding first because it sounds like 'real' scaling.
     - Adding replicas but sending all reads to them, breaking read-your-writes.
     - Autoscaling app servers until database connections are exhausted.
     - Changing API shapes 'while we're at it', forcing client releases during the crunch.
   - **Follow-ups:**
     - _The cache hit ratio is only 50%. What do you do?_ Analyse the key distribution: long-tail keys may not be worth caching, TTLs may be too short, or keys may include unnecessary variance (like query parameter order). Fix key design and pre-warm hot keys.
     - _What if writes also grow 10x?_ Then batch and queue writes, reduce write amplification (indexes), and plan partitioning sooner, since replicas don't help writes.
     - _How do you avoid database connection exhaustion?_ Connection poolers (such as PgBouncer), per-instance pool caps, and fewer, larger instances, or a data access service that multiplexes connections.
   - **Example:** A content platform expected 10x reads from a partnership. Load tests showed the database saturating at 3x. Edge caching of article pages (hit ratio 94%) plus two read replicas carried the launch; sharding, originally planned, wasn't needed.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 5 (Replication)](https://dataintensive.net/)
   - _Also asked as:_ How do I design a service that can handle 10x more traffic with minimal changes?
3. **Choose a load balancing strategy for long-lived connections versus short RPCs.** [mine · Intermediate · Scaling, Latency]
   - **Trap:** "Round robin" (or "least connections") for everything, without distinguishing per-request from per-connection balancing. — _Why it fails:_ With long-lived connections or gRPC over HTTP/2, an L4 balancer balances connections, not requests, so load drifts out of balance after every scale-out and new instances sit idle. — _Probing:_ Whether you know that long-lived connections need rebalancing, slow start and draining. — _Say:_ "Short RPCs: least outstanding requests or power of two choices at L7. Long-lived streams: least connections plus bounded connection lifetimes, slow start and draining."
   - **Thesis:** Short RPCs balance well per request with least-outstanding-requests or power-of-two-choices. Long-lived connections balance per connection, so the risk is imbalance over time; counter it with connection-aware placement, periodic rebalancing, slow start for new instances and graceful draining.
   - **60-second answer:** For short RPCs, per-request balancing works: round robin is fine when instances and requests are uniform, but least outstanding requests or power of two choices, which picks two random backends and sends to the less loaded one, handles uneven request costs and slow instances much better with little coordination. For long-lived connections like WebSockets, gRPC streams or database connections, the load balancer only decides once per connection, so after a deploy or scale-out the new instances get few connections while old ones stay overloaded. There I'd use least-connections placement, slow start so new instances aren't flooded, connection lifetimes or server-initiated reconnects to rebalance gradually, and draining on scale-in, telling clients to reconnect elsewhere before the instance stops. If connections carry sticky state, consistent hashing limits how many move when the pool changes.
   - **Key points:**
     1. **Round robin.** Simple and fair when requests cost the same and instances are identical. Degrades with heterogeneous requests or a slow instance, which still gets its full share.
     2. **Least outstanding requests.** Sends to the backend with the fewest in-flight requests. Naturally routes around slow instances. Requires the balancer to track in-flight counts.
     3. **Power of two choices.** Pick two backends at random and choose the less loaded. Gets most of the benefit of least-loaded without global state and avoids herding onto one 'best' instance.
     4. **Long-lived connections balance per connection.** gRPC over HTTP/2 multiplexes many requests on one connection, so an L4 balancer balances connections, not requests. Use L7 balancing or client-side balancing for gRPC.
     5. **Rebalancing over time.** Cap connection lifetime (for example minutes to an hour, with jitter) or have servers send GOAWAY or reconnect hints so load spreads after scale-out.
     6. **Slow start and draining.** New instances ramp traffic gradually to warm caches and JIT. On scale-in, stop new connections and ask clients to reconnect, waiting for in-flight work.
     7. **Consistent hashing for sticky state.** When connections depend on per-key state (sessions, partitions), consistent hashing moves only about 1/N of keys when a node joins or leaves.
   - **When to choose what:** Short RPCs: least outstanding requests or power of two choices at L7. Long-lived streams: least connections plus bounded lifetimes and server-driven rebalancing, with slow start and draining. Sticky state: consistent hashing with bounded load.
   - **Numbers:**
     - Consistent hashing: adding a 10th node moves roughly 1/10 of keys, versus nearly all keys with modulo hashing.
     - Connection lifetime example: 30 minutes ± 20% jitter means a full fleet rebalances within about half an hour after scale-out, without a reconnect storm.
   - **Pitfalls:**
     - Using an L4 balancer for gRPC and finding all requests from a client go to one backend.
     - No slow start: a fresh instance receives its full share of connections while caches are cold, and its latency spikes.
     - Killing instances without draining, forcing thousands of clients to reconnect at once.
     - Fixed connection lifetimes without jitter, causing synchronised reconnects.
   - **Follow-ups:**
     - _How does client-side load balancing compare?_ Clients get a list of backends (from service discovery) and balance themselves, avoiding an extra hop and handling per-request balancing over multiplexed connections. It needs good discovery and health information in every client.
     - _What about WebSockets during a deploy?_ Drain gradually: stop new connections to old instances, send reconnect messages in batches with jitter, and let clients reconnect to new instances.
     - _Why not always pick the least-loaded instance?_ With stale load information, every balancer picks the same 'best' instance and overloads it. Power of two choices avoids this herding.
   - **Example:** A chat service on WebSockets saw new instances sit idle after scale-out while old ones ran hot. Adding a 45-minute connection lifetime with jitter, least-connections placement and slow start evened load within an hour of each scale event.
   - **Sources:** [Google SRE book: Load balancing in the datacenter](https://sre.google/sre-book/load-balancing-datacenter/); [gRPC blog: gRPC load balancing](https://grpc.io/blog/grpc-load-balancing/)
4. **Size a system for 50,000 requests per second with a 100 ms hard deadline.** [mine · Advanced · Scaling, Latency]
   - **Trap:** Jumping to "about 50 servers" or "use autoscaling" without deriving anything. — _Why it fails:_ The interviewer wants the arithmetic: CPU per request, concurrency from Little's law, a latency budget across hops, headroom for losing a zone. An unexplained number can't be defended. — _Probing:_ Can you do back-of-envelope sizing out loud, and do you know what happens when the deadline is about to be missed? — _Say:_ "50k req/s × 4 ms CPU is 200 busy cores; at 60% utilisation that's about 330 cores, plus a zone's worth of headroom. In-flight requests = 50k × latency, which sizes the pools."
   - **Thesis:** Work it out per request, then multiply: CPU time, memory and network per request give instance counts; the 100 ms deadline gives a latency budget split across hops; headroom of 30–40% covers spikes and failures. Then say what you drop when the deadline is about to be missed.
   - **60-second answer:** I'd do back-of-envelope sizing in four steps. Per-request cost: measure or estimate CPU time, say 4 ms per request; at 50,000 requests per second that's 200 CPU-seconds per second, so 200 cores busy, and at a target of 60% utilisation about 340 cores, or roughly 22 sixteen-core instances, plus enough to survive losing a zone. Concurrency by Little's law: 50,000 per second × 0.05 s average latency is 2,500 requests in flight, which sizes thread pools and connections. Latency budget: of 100 ms, give perhaps 10 to network, 20 to the service, 40 to dependencies called in parallel with their own timeouts, and keep 30 in reserve. Dependencies: if each request makes three downstream calls, those services see 150,000 calls per second. And I'd decide in advance what we drop near the deadline: optional calls, then lower-priority requests, so the core response stays within 100 ms.
   - **Key points:**
     1. **Per-request resource cost.** CPU milliseconds, memory per in-flight request, bytes in and out. Get them from profiling or a load test of one instance, not guesses.
     2. **Compute instance count.** Cores = requests/s × CPU seconds per request ÷ target utilisation. Then round up for zone failure (N+1 zones) and deploys (instances out of rotation).
     3. **Concurrency with Little's law.** In-flight = arrival rate × latency. This sizes thread pools, connection pools and memory, and shows how quickly a latency increase exhausts them.
     4. **Split the latency budget.** Allocate the 100 ms across network, service time and dependencies, with timeouts at each step below the remaining budget. Parallelise independent calls.
     5. **Fan-out multiplies downstream load.** Each downstream call multiplies requests per second for that dependency, and the request waits for the slowest call, so the tail matters more with fan-out.
     6. **Headroom.** 30–40% spare capacity covers traffic spikes, a lost zone, and performance regressions until autoscaling catches up.
     7. **Deadline behaviour.** Propagate the deadline; skip optional calls when the remaining budget is low; shed low-priority traffic before high-priority traffic misses its deadline.
   - **When to choose what:** Size from measured per-request costs, add zone-failure and spike headroom, and enforce the deadline with timeouts and degradation. Validate with a load test at 1.5x the target before trusting the numbers.
   - **Numbers:**
     - CPU: 50,000 req/s × 4 ms = 200 cores busy; ÷ 0.6 utilisation ≈ 333 cores ≈ 21 sixteen-core instances; across 3 zones with one-zone loss tolerance, run about 32 instances.
     - Network: 50,000 req/s × 20 KB response ≈ 1 GB/s ≈ 8 Gbit/s egress, which matters for instance network limits and cost.
     - Concurrency: 50,000 req/s × 50 ms average = 2,500 in flight; if latency rises to 100 ms, 5,000.
   - **Pitfalls:**
     - Sizing on average latency and ignoring the tail and fan-out.
     - Forgetting that dependencies see multiplied traffic.
     - No headroom for zone loss, so a single-zone outage becomes an overload.
     - Timeouts that add up to more than the overall deadline.
   - **Follow-ups:**
     - _How do you get the per-request CPU cost if the system doesn't exist yet?_ Prototype the hot path and benchmark it, or use costs from a similar existing service, and plan to correct after the first load test.
     - _The p99 of one dependency is 80 ms. Can you meet 100 ms?_ Only with a tight timeout and a fallback, a hedged request, or by moving that call off the critical path (prefetch or cache), since its tail alone consumes most of the budget.
     - _What's the memory footprint?_ In-flight requests × memory per request plus caches and runtime overhead per instance. 2,500 in flight × 200 KB = 500 MB across the fleet, small compared to caches.
   - **Example:** An ad-serving endpoint at 50,000 req/s with a 100 ms deadline: profiling showed 3 ms CPU per request. The team ran 30 instances across three zones at about 50% utilisation, gave the bidding call a 40 ms timeout with a default ad as fallback, and kept p99 at 70 ms.
   - **Sources:** [Jeff Dean and Luiz Barroso: The tail at scale](https://research.google/pubs/the-tail-at-scale/); [Google SRE book: Handling overload](https://sre.google/sre-book/handling-overload/)
5. **What are the trade-offs between vertical and horizontal scaling?** [ref · Fundamental · Scaling]
   - **Trap:** "Horizontal is always better because it scales infinitely." — _Why it fails:_ Horizontal scaling requires statelessness or partitioning and brings coordination, consistency and network failure costs. Vertical scaling keeps databases simple and goes much further than people assume. — _Probing:_ Whether you can match the strategy to the tier rather than reciting a slogan. — _Say:_ "Stateless tiers scale out early for redundancy; stateful stores scale up with replicas until the ceiling, cost or failure domain forces partitioning."
   - **Thesis:** Vertical scaling is simple and keeps everything on one machine, but it has a ceiling, a cost curve that steepens, and a single point of failure. Horizontal scaling removes the ceiling and adds redundancy, but requires statelessness or partitioning and adds coordination. Most systems scale stateless tiers horizontally early and data tiers vertically for as long as practical.
   - **60-second answer:** Vertical scaling means a bigger machine: more cores, memory, faster disks. It needs no code changes, keeps transactions and joins local and simple, and modern hardware goes very far. The costs: there's a ceiling, the largest instances cost disproportionately more, resizing often means a restart or failover, and one big machine is still one failure domain. Horizontal scaling means more machines: it scales further and gives redundancy, but the workload must be stateless or partitioned, and you inherit load balancing, data distribution, consistency and more network failure modes. In practice I'd scale application servers horizontally from the start because they're stateless and it gives redundancy, and scale the database vertically plus replicas until a single primary genuinely can't keep up, then partition.
   - **Key points:**
     1. **Vertical: simplicity.** No architectural change. Single-node transactions, joins and consistency stay easy. Great for databases and for early-stage systems.
     2. **Vertical: limits.** A hard ceiling on the largest instance, cost per unit of capacity rising at the top end, and a single failure domain unless paired with replicas.
     3. **Horizontal: scale and redundancy.** Add capacity incrementally and survive node loss. Fits stateless services naturally.
     4. **Horizontal: complexity.** Requires externalising state or partitioning data, load balancing, service discovery, and dealing with partial failure and consistency across nodes.
     5. **Stateless tiers go horizontal early.** Web and API servers with state moved to caches or databases scale out cheaply and gain redundancy.
     6. **Data tiers stay vertical longer.** A large primary with read replicas often covers far more growth than expected. Partitioning is a large, hard-to-reverse step.
     7. **Elasticity and cost.** Horizontal scaling allows scaling in during quiet hours, saving money; a big vertical instance runs at peak size all the time.
   - **When to choose what:** Scale out stateless services; scale up stateful stores until cost, ceiling or failure-domain concerns force partitioning. Revisit when you approach roughly half of the largest available instance, to leave time to plan.
   - **Numbers:**
     - Headroom check: if your database runs at 60% of a 32-core instance and the largest available is 192 cores, vertical scaling buys roughly another 6x before the ceiling, often years of growth.
     - Failure domain: one large node at 100% of traffic vs 10 nodes at 10% each; losing one node removes 100% vs 10% of capacity.
   - **Pitfalls:**
     - Partitioning a database prematurely and paying the complexity forever.
     - Scaling up until hitting the ceiling with no plan, then needing an emergency re-architecture.
     - Horizontally scaled services that still hold local state (sessions, caches) and break on rebalancing.
     - Ignoring that a single big node is a single point of failure.
   - **Follow-ups:**
     - _When would you scale a database horizontally first?_ When the dataset or write rate clearly exceeds one node from the start (large-scale event ingestion, IoT telemetry) or when the data is naturally partitioned by tenant with isolation requirements.
     - _How do you make a stateful service horizontally scalable?_ Move state out (database, cache, object store), or partition it so each node owns a key range, with rebalancing and replication.
     - _Isn't vertical scaling downtime-prone?_ Resizing often requires a restart; with a replica you fail over to a resized standby, so downtime is a brief failover.
   - **Example:** A fintech's Postgres primary grew from 8 to 64 cores over three years with two read replicas, handling 15x growth. Application servers scaled from 4 to 60 instances. Partitioning was planned only when write volume approached half of the largest instance's capacity.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 1 (Scalability)](https://dataintensive.net/)

### Monolith vs services
6. **When does splitting a monolith pay for itself?** [mine + ref · Intermediate · Scaling, Architecture]
   - **Trap:** "When the codebase gets big" or "microservices scale better". — _Why it fails:_ Size alone isn't a reason. The real drivers are teams blocking each other, divergent deploy cadence and divergent runtime needs, and the costs (network failures, distributed data, operations) are significant. — _Probing:_ Do you weigh organisational and operational costs, and do you know the modular-monolith option? — _Say:_ "Split when independent deployability for a specific team or component is worth the network and data costs; otherwise enforce module boundaries inside one deployable first."
   - **Thesis:** Splitting pays when team coordination, deploy coupling or very different scaling needs cost more than the network failures, distributed data and operational load you take on. A well-structured modular monolith is often the better answer, and a prerequisite for a clean split anyway.
   - **60-second answer:** I'd look for three signals. Organisational: many teams blocking each other in one codebase and deploy pipeline, so release coordination and merge conflicts dominate. Change rate: some parts change daily and others rarely, but everything ships together and carries the same risk. Scaling and runtime profile: one component needs very different resources, like GPU inference, a high-throughput ingest path, or stricter isolation for compliance. Against that I'd price the costs: every call becomes a network call that can fail and be slow, data must be split with clear ownership and eventual consistency between services, and you need service discovery, tracing, versioned contracts and more on-call. If the signals are weak, I'd invest in a modular monolith: enforce module boundaries and data ownership inside one deployable. When a module clearly needs independence, extract that one, along a boundary already proven in the code.
   - **Key points:**
     1. **Signal: teams blocking each other.** When more than a handful of teams share one deploy pipeline, coordination costs grow fast. Independent deployability per team is the strongest reason to split.
     2. **Signal: divergent change rates and risk.** Fast-moving features coupled to stable, critical code means every release risks the critical path.
     3. **Signal: divergent runtime needs.** Different scaling, hardware, language, or isolation requirements for one component.
     4. **Cost: network and partial failure.** In-process calls become remote calls with latency, timeouts, retries and versioning. Debugging spans processes.
     5. **Cost: distributed data.** Each service owns its data. Cross-service queries and transactions become APIs, events, sagas and reconciliation.
     6. **Cost: platform and operations.** CI/CD per service, service discovery, observability, security between services, and on-call for more moving parts. You need a platform before many services.
     7. **Modular monolith first.** Enforce module boundaries (separate packages, no shared tables between modules, internal APIs). This captures much of the benefit and makes later extraction straightforward.
   - **When to choose what:** Split when independent deployment or scaling of a specific part is clearly worth the cost, one module at a time. Stay with a modular monolith when the team is small, boundaries are still moving, or platform maturity is low.
   - **Numbers:**
     - Heuristic: if a monolith's main pain is a 2-hour build or test suite, fix the build first; that's cheaper than splitting.
     - Team-size heuristic: a single deployable tends to strain when more than several teams (tens of engineers) commit to it daily.
   - **Pitfalls:**
     - Splitting by technical layer (UI service, data service) instead of by business capability.
     - A distributed monolith: services that must deploy together and share a database.
     - Splitting before boundaries are understood, then redrawing them across network calls.
     - No platform investment, so each new service reinvents deployment and monitoring.
   - **Follow-ups:**
     - _Which module would you extract first?_ One with a clear boundary, its own data, a distinct scaling or change profile, and a team ready to own it. Avoid starting with the most entangled core.
     - _How do you split the database?_ Give each module ownership of its tables inside the monolith first, remove cross-module joins, then move the tables with the extracted service and replace joins with API calls or replicated read models.
     - _How do you know the split worked?_ Lead time and deploy frequency for the team improved, incidents didn't increase, and the extracted service deploys independently without coordinated releases.
   - **Example:** A lending company with four teams kept a modular monolith with strict module boundaries. When the underwriting team needed ML models, GPU instances and daily releases, they extracted underwriting as a service, along a boundary that had already existed as a module for a year.
   - **Sources:** [Martin Fowler: Monolith first](https://martinfowler.com/bliki/MonolithFirst.html); [Martin Fowler: Microservice trade-offs](https://martinfowler.com/articles/microservice-trade-offs.html)
   - _Also asked as:_ How do I decide when to split a monolith into services?

### Overload, backpressure & spikes
7. **Design admission control so a service stays up through a 20x spike.** [mine + ref · Advanced · Scaling, Reliability]
   - **Trap:** "Autoscale" or "add a queue to absorb the spike." — _Why it fails:_ Autoscaling takes minutes and the spike lasts seconds; an unbounded queue just turns overload into huge latency for everyone. Without rejection, goodput collapses. — _Probing:_ Do you understand goodput, priority-based shedding and per-tenant isolation? — _Say:_ "I'd reject excess cheaply and early: per-tenant quotas, priority shedding, an adaptive concurrency limit and bounded queues, with 429 and Retry-After. Autoscaling is the second line of defence."
   - **Thesis:** Under a 20x spike you cannot serve everyone, so decide who gets served. Admission control rejects excess work early and cheaply, by priority and by tenant, keeps every queue bounded, and adapts concurrency limits to measured latency so the work you accept still completes on time.
   - **60-second answer:** The goal is to keep goodput up: serve as many requests successfully as capacity allows rather than accepting everything and timing out everyone. I'd put admission control at the edge of the service. First, per-tenant and per-client quotas, so one client's spike doesn't consume everyone's capacity. Second, priority classes: interactive and revenue-critical requests over background and batch work, with lower classes shed first. Third, an adaptive concurrency limit that measures latency and lowers the number of in-flight requests when latency rises, like TCP congestion control. Fourth, bounded queues with short timeouts, rejecting rather than queueing when full, and preferring to drop requests that have waited long, since their clients have probably given up. Rejections are fast and explicit, 429 or 503 with Retry-After, so well-behaved clients back off. Autoscaling helps over minutes, but admission control protects you in the seconds before it does.
   - **Key points:**
     1. **Protect goodput, not throughput.** Accepting more than you can process makes every request slow and many fail. Rejecting the excess keeps latency and success high for the work accepted.
     2. **Per-tenant quotas.** Token buckets per client or tenant isolate noisy neighbours, so a spike from one source mostly affects that source.
     3. **Priority-based shedding.** Classify requests (critical, normal, best-effort). Under pressure, shed best-effort first, then normal, keeping critical paths alive.
     4. **Adaptive concurrency limits.** Algorithms such as gradient or AIMD-style limits adjust allowed concurrency based on observed latency, finding capacity without manual tuning.
     5. **Bounded queues and deadlines.** Queues have a maximum length and a maximum wait. Drop requests whose deadline has passed; LIFO under overload can serve fresh requests that still have waiting clients.
     6. **Cheap, explicit rejection.** Reject before doing expensive work, with 429 or 503 and Retry-After, so clients back off rather than retry immediately.
     7. **Autoscaling is the second line.** Scaling takes minutes; admission control acts in milliseconds. Use both, and ensure scaling isn't blocked by the overload itself.
   - **When to choose what:** Every externally facing service gets per-client quotas, bounded queues and a concurrency limit. Priority shedding where traffic classes differ in value. Tune with load tests at several times peak.
   - **Numbers:**
     - At 20x a normal 5,000 req/s, you receive 100,000 req/s. If capacity is 15,000 req/s, admission control must reject about 85% quickly, at a cost of perhaps microseconds each, rather than letting all 100,000 queue.
     - Rejection cost matters: if rejecting takes 0.1 ms of CPU and serving takes 5 ms, you can reject about 50 requests for the cost of serving one.
   - **Pitfalls:**
     - Unbounded queues that turn a spike into minutes of latency for everyone.
     - Rejecting after doing most of the work (authentication, database lookups).
     - Global limits only, so one tenant's spike starves everyone.
     - Clients that retry 429s immediately, amplifying the spike.
   - **Follow-ups:**
     - _How do you classify priority?_ By endpoint and caller: checkout and login are critical; search suggestions and analytics beacons are best-effort. Carry the class in a header set at the edge.
     - _Why LIFO under overload?_ With FIFO, every request waits behind old ones whose clients may have given up. LIFO serves the newest requests, which still have someone waiting, improving useful work done.
     - _How does this interact with autoscaling?_ Shed load immediately, while autoscaling adds capacity over minutes. Make sure shedding metrics don't hide demand from the autoscaler; scale on offered load, not just served load.
   - **Example:** A ticketing API hit 25x traffic when sales opened. Per-account token buckets, best-effort shedding of seat-map refreshes, and an adaptive concurrency limit kept purchase requests at 99% success with p99 under 600 ms while 70% of traffic was rejected with Retry-After.
   - **Sources:** [AWS Builders' Library: Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/); [Google SRE book: Handling overload](https://sre.google/sre-book/handling-overload/); [Netflix: concurrency-limits library](https://github.com/Netflix/concurrency-limits)
   - _Also asked as:_ How do I protect downstream services from traffic spikes?
8. **How do I design for backpressure in a high-traffic system?** [ref · Advanced · Reliability, Scaling]
   - **Trap:** "Put Kafka in the middle and the problem is solved." — _Why it fails:_ A queue moves the backlog into durable storage, but if consumers can't keep up, lag grows until retention expires and data is lost. Backpressure needs bounded buffers and a signal upstream. — _Probing:_ Whether you know that unbounded buffers only delay failure, and where load should be dropped. — _Say:_ "Every buffer is bounded, producers get a slow-down signal (blocking, credits, 429s), and I decide deliberately where load is shed. I alert on lag age, not just depth."
   - **Thesis:** Backpressure means a slow consumer can slow down its producers instead of being buried. Bound every buffer, propagate 'I'm full' upstream (blocking, credits, 429s), and decide deliberately where excess load is dropped. Unbounded buffers only move the failure later and make it bigger.
   - **60-second answer:** In a pipeline, the slowest stage sets the throughput. If upstream keeps sending faster than that, the buffer between them grows until memory runs out or latency becomes useless. Backpressure fixes this by making capacity visible upstream. Inside a process, that's bounded queues where producers block or get rejected when full. Between services, it's flow control: HTTP/2 and gRPC have window-based flow control, streaming systems use pull-based consumption or credits, and request-response APIs return 429 or 503 to signal 'slow down'. At the edge, where you can't slow the user, you shed load deliberately. With queues like Kafka, consumers pull at their own pace and lag grows instead of memory, which is fine for a while, as long as you monitor lag and scale consumers or shed upstream before retention runs out.
   - **Key points:**
     1. **Every buffer must be bounded.** Queues, channels, thread pools and in-memory lists all have a maximum size. Unbounded buffers convert overload into out-of-memory crashes or minutes of latency.
     2. **Signal upstream.** Blocking producers (in-process), credits or windows (streaming protocols), and explicit rejections with Retry-After (HTTP). The producer must react by slowing down.
     3. **Pull beats push for consumers.** Pull-based consumers (Kafka, SQS) take work at their own rate; the backlog lives in durable storage instead of in consumer memory.
     4. **Monitor lag and age, not just depth.** The age of the oldest message tells you how stale processing is. Alert on lag growth rate and time until retention is exceeded.
     5. **Decide where to drop.** At some point load must be shed. Choose the place: at the edge (reject requests), by sampling (drop some telemetry), or by degrading (skip optional processing).
     6. **Scale the bottleneck stage.** Backpressure buys time; adding consumers or capacity to the slowest stage fixes throughput. Partition counts and downstream limits cap how far that goes.
   - **When to choose what:** Bounded buffers everywhere, explicit backpressure signals between components, durable queues where work can wait, and deliberate shedding where it can't. Treat growing lag as an incident before it becomes data loss.
   - **Numbers:**
     - Backlog time: a queue receiving 12,000 msgs/s with consumers handling 10,000 msgs/s grows by 2,000/s, 7.2 million per hour. With 24 hours of retention and no fix, data starts expiring after about a day.
     - Drain time after the spike: with a backlog of 7.2 million and 3,000 msgs/s of spare consumer capacity, draining takes about 40 minutes.
   - **Pitfalls:**
     - Unbounded in-memory queues in services, which hide the problem until the process dies.
     - Producers that ignore 429s or retry immediately.
     - Monitoring queue depth without age, missing that the oldest message is hours old.
     - Scaling consumers beyond what the downstream database can handle, moving the bottleneck.
   - **Follow-ups:**
     - _How do you apply backpressure to end users?_ You can't slow them directly, so reject or degrade: 429 with Retry-After, waiting rooms for big events, or simpler responses.
     - _What happens if Kafka retention is about to expire unprocessed messages?_ Scale consumers, extend retention temporarily, divert to a slower but durable overflow store, or prioritise processing and accept dropping low-value messages explicitly.
     - _How does gRPC flow control help?_ HTTP/2 stream and connection windows stop a sender when the receiver hasn't consumed data, so a slow receiver isn't overwhelmed at the transport level.
   - **Example:** A metrics ingestion pipeline buffered in memory and crashed during spikes. The fix: bounded in-process queues, 429s to agents with Retry-After, Kafka between ingest and aggregation, and lag-age alerts. Spikes now show up as lag that drains afterwards instead of crashes.
   - **Sources:** [AWS Builders' Library: Avoiding insurmountable queue backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/); [Google SRE book: Handling overload](https://sre.google/sre-book/handling-overload/)

### Sync, async & queues
9. **How do I choose between synchronous and asynchronous communication?** [ref · Intermediate · Messaging]
   - **Trap:** "Async is more scalable, so make everything event-driven." — _Why it fails:_ Async adds pending states, after-the-fact failure handling, duplicates and harder debugging. When the user needs an answer now, async just hides latency behind a spinner. — _Probing:_ Can you draw the line between the synchronous decision and asynchronous side effects? — _Say:_ "Synchronous for whatever the caller needs to proceed; asynchronous for side effects and slow work, with idempotent consumers."
   - **Thesis:** Use synchronous calls when the caller needs the answer to continue and the work is fast and bounded. Use asynchronous messaging to decouple availability, absorb bursts, fan out to many consumers, or run slow work. Asynchrony costs you immediate answers and simple error handling, so pay it only where you gain something.
   - **60-second answer:** My rule: if the user or caller can't proceed without the result, and it can be produced within the latency budget, call synchronously, as with checking a price, authorising a payment, or reading a profile. If the work is slow, can be done later, or other systems just need to know something happened, make it asynchronous: emit an event or enqueue a job, return quickly, and process in the background. Async gives decoupling, since the producer stays up when consumers are down; buffering, which absorbs spikes; and fan-out, where many consumers react without the producer knowing them. Its costs are real: results arrive later, so the UI needs pending states; errors happen after the request returned, so you need retries, dead-letter handling and notifications; and duplicates and ordering need design. Most systems mix both: a synchronous core decision, then asynchronous side effects.
   - **Key points:**
     1. **Synchronous when the answer is needed now.** Validations, authorisations, reads to render a page. Keep these calls few, fast and with timeouts.
     2. **Asynchronous for slow or deferrable work.** Sending email, generating reports, video processing, updating search indexes. The caller gets an acknowledgement and maybe a job id.
     3. **Availability decoupling.** With a queue in between, the producer keeps accepting work while a consumer is down; the backlog drains later. Synchronous chains multiply unavailability.
     4. **Load levelling.** Queues absorb bursts so consumers can run at a steady rate sized for average rather than peak load.
     5. **Fan-out and loose coupling.** Publishing an event lets new consumers subscribe without changing the producer.
     6. **The costs of async.** Eventual results and pending UI states, failure handling after the fact, at-least-once delivery requiring idempotency, ordering concerns, and harder end-to-end tracing.
   - **When to choose what:** Synchronous for the critical decision in a user request; asynchronous for side effects and slow work. If a synchronous chain is more than two or three calls deep, look for steps that can move to async or be served from local data.
   - **Numbers:**
     - Availability of synchronous chains multiplies: three dependencies at 99.9% each give at most about 99.7% for the chain. With async side effects, the user path depends only on the synchronous parts.
   - **Pitfalls:**
     - Making everything async, so simple requests become hard-to-debug event chains with no immediate answer.
     - Long synchronous chains where any slow service blocks the user.
     - Async processing without visibility: users don't know whether their job succeeded.
     - Forgetting idempotency for at-least-once delivery.
   - **Follow-ups:**
     - _How does the user learn the result of async work?_ Return a job or resource id, then poll, subscribe via WebSocket or server-sent events, or receive a notification or webhook.
     - _Can you do request-reply over a queue?_ Yes, with correlation ids and reply queues, but it combines the latency of async with the coupling of sync. Use it when the transport itself is asynchronous (for example mainframe or partner integrations).
     - _How do you trace async flows?_ Propagate trace context in message headers and link consumer spans to producer spans, so a trace follows the message.
   - **Example:** Loan application submission validates input and runs the instant credit decision synchronously (under 2 seconds), returning approved or declined. Document generation, CRM updates, welcome emails and analytics happen asynchronously from an ApplicationDecided event.
   - **Sources:** [Enterprise Integration Patterns: Messaging](https://www.enterpriseintegrationpatterns.com/patterns/messaging/); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 11 (Stream processing)](https://dataintensive.net/)
10. **When should I use a queue versus direct RPC?** [ref · Intermediate · Messaging]
   - **Trap:** Putting a queue on a synchronous user path "for reliability", then polling for the result. — _Why it fails:_ That adds latency and failure modes and still makes the user wait. Queues help only when the work can complete later. — _Probing:_ Do you know what queues actually buy (buffering, retries, fan-out, decoupling) and what they cost? — _Say:_ "If the caller needs the answer within the deadline, it's RPC with a timeout. If the work can finish later or must survive consumer outages, it's a queue with a DLQ."
   - **Thesis:** Use a queue when work can wait and you want buffering, retries, independent consumer speed or fan-out. Use direct RPC when the caller needs a response within a tight deadline. A queue in a path that needs a synchronous answer adds latency and failure modes without the benefits.
   - **60-second answer:** I'd ask: does the caller need the result to respond? If yes, and the work is fast, RPC is simpler: one hop, immediate errors, easy tracing. If the work can complete later, a queue gives me durable buffering through spikes and consumer outages, built-in retries with dead-lettering, consumers scaled independently of producers, and the ability to add consumers without touching the producer. Queues also smooth load onto a fragile downstream such as a legacy system or rate-limited partner API. The costs: an extra component to run, at-least-once delivery so consumers must be idempotent, ordering only within a partition or group, and results that come back later. Request-reply over a queue exists, but if you need the answer in 100 ms, a direct call with a timeout and fallback is almost always better.
   - **Key points:**
     1. **RPC for request-scoped answers.** Fast, bounded work whose result the caller needs. Simple semantics, immediate error feedback, and straightforward tracing.
     2. **Queues for deferrable work.** The producer records intent durably and returns; consumers process at their own pace.
     3. **Buffering and load levelling.** Queues absorb spikes and protect slow or fragile downstreams. Consumers can be sized for average load.
     4. **Retries and dead-lettering.** Failed messages are retried with backoff and eventually moved to a dead-letter queue for inspection, without the producer waiting.
     5. **Fan-out.** Topics with multiple subscriptions let several consumers process the same event independently.
     6. **Costs of queues.** Operating the broker, at-least-once delivery and idempotency, ordering constraints, monitoring of lag, and harder debugging across asynchronous hops.
   - **When to choose what:** RPC when the caller waits for the result and the deadline is tight. Queue when the work is slow, deferrable, needs retries independent of the caller, must survive consumer outages, or feeds multiple consumers. A task queue (one consumer per job) differs from a log or topic (many consumers, replay); choose by whether you need replay and fan-out.
   - **Numbers:**
     - Latency: a direct in-region RPC adds about a millisecond of network time; a queue hop adds publish, broker persistence and consumer polling, typically milliseconds to tens of milliseconds, or more with batching.
   - **Pitfalls:**
     - A queue in a synchronous user path, then polling for the result inside the request.
     - Assuming exactly-once delivery and skipping idempotency.
     - Using a queue to hide a consumer that can never keep up; the backlog only grows.
     - No dead-letter handling, so poison messages block or vanish.
   - **Follow-ups:**
     - _Queue or topic?_ A queue distributes each message to one consumer in a group (work distribution). A topic delivers each message to every subscribing group (fan-out). Many systems use topics with consumer groups to get both.
     - _How would you rate-limit calls to a partner API that allows 50 requests per second?_ Put requests on a queue and run consumers that together don't exceed 50/s, with backoff on 429s. The queue absorbs bursts from your side.
     - _When is RPC with retries enough?_ When failures are brief and the caller can wait for a few retries within its deadline. If outages are longer or work must survive restarts, use a durable queue.
   - **Example:** Invoice PDF generation moved from an RPC inside the 'complete order' request (adding 1.5 s and failing when the PDF service was down) to a queue. Orders now complete in 200 ms; PDFs are generated within a minute and retried on failure.
   - **Sources:** [Enterprise Integration Patterns: Point-to-point channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PointToPointChannel.html); [Enterprise Integration Patterns: Publish-subscribe channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/PublishSubscribeChannel.html)

## Data & Storage (19)

### SQL, NoSQL & OLTP vs OLAP
11. **Where is the boundary between OLTP and OLAP, and how does data cross it?** [mine · Fundamental · Databases]
   - **Trap:** "Have the application write to both the database and the warehouse." — _Why it fails:_ Dual writes diverge on partial failures and miss changes from scripts and migrations. The reliable path is change data capture from the database log. — _Probing:_ Do you know about CDC, freshness SLOs, schema drift and propagating deletes? — _Say:_ "CDC from the transaction log into the warehouse, snapshot plus stream, with a stated freshness target and erasure flowing through."
   - **Thesis:** OLTP serves many small, latency-sensitive transactions on current state; OLAP serves few large scans over history. Keep them in separate stores and move data across with change data capture, never with application dual writes, and treat lag, backfills and schema drift as first-class concerns.
   - **60-second answer:** The boundary is about access pattern. The transactional database handles point reads and short writes with strict latency and correctness; analytics wants to scan billions of rows, aggregate across history and join widely, which would wreck OLTP latency if run there. So analytics lives in a columnar warehouse or lakehouse. Data crosses via change data capture from the database's log into a stream, then into the warehouse, which is reliable because it reads committed changes in order, unlike the application writing to both places. I'd also plan for an initial snapshot plus streaming, monitoring of lag, handling of schema changes through a registry or contract, and deletes, including legal erasure, flowing through to the analytical side.
   - **Key points:**
     1. **Different access patterns, different engines.** OLTP: row-oriented, indexed point lookups, short transactions, high concurrency. OLAP: columnar storage, compression, vectorised scans over a few columns of many rows.
     2. **Don't run analytics on the primary.** Large scans evict hot pages from cache and hold resources, raising tail latency for customers. A read replica helps a little but still uses row storage that's slow for scans.
     3. **CDC over dual writes.** Reading the database log (binlog, WAL) captures every committed change in order, including those from scripts and migrations. Application dual writes miss failures and diverge.
     4. **Snapshot plus stream.** Start with a consistent snapshot, then apply changes from the log position at which it was taken. Tools like Debezium coordinate this.
     5. **Lag as an SLO.** Publish freshness, for example 'warehouse within 15 minutes of production', and alert on it. Consumers can then decide whether data is fresh enough for their use.
     6. **Schema drift and contracts.** A column rename in OLTP can break dashboards silently. Use a schema registry or data contracts, and test pipelines against schema changes before deployment.
     7. **Deletes and erasure flow through.** Propagate deletes as tombstones, and make sure erasure requests reach the warehouse, derived tables and backups according to policy.
   - **When to choose what:** Separate stores once analytics queries become heavy or broad. Use CDC for continuous movement; batch extracts are acceptable for daily reporting. Hybrid HTAP databases can serve light operational analytics but don't remove the need for a warehouse for broad historical analysis.
   - **Numbers:**
     - Columnar compression on analytical data is often several times to ten times or more, and queries read only the columns they need, which is why scans that take minutes on a row store can take seconds in a warehouse.
     - CDC latency is typically seconds to a minute end to end; warehouse loading in micro-batches every few minutes is common.
   - **Pitfalls:**
     - Application dual writes to the database and the warehouse that silently diverge.
     - Analysts querying the production primary 'just this once'.
     - No plan for schema changes, so pipelines break after a routine migration.
     - Deleted or erased data persisting forever in the warehouse.
   - **Follow-ups:**
     - _What if the business needs real-time analytics?_ Stream changes into a real-time analytical store or materialised views over the stream, with seconds of lag, and keep the warehouse for historical depth.
     - _How do you handle a backfill of a year of data?_ Bulk export from a snapshot or replica into the warehouse, then resume CDC from the snapshot's log position so there's no gap or duplicate.
     - _Who owns the data contract?_ The producing team owns the schema and its compatibility; the platform provides the registry and checks.
   - **Example:** A lending company streams its Postgres WAL through Debezium into Kafka and loads the warehouse every five minutes. Risk dashboards run there instead of on replicas, and production p99 latency drops during month-end reporting.
   - **Sources:** [Debezium: change data capture](https://debezium.io/); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 3 (OLTP and OLAP storage)](https://dataintensive.net/)
12. **How do I decide between SQL, NoSQL, and search engines?** [ref · Fundamental · Databases]
   - **Trap:** "NoSQL because it scales" or "use Elasticsearch as the database." — _Why it fails:_ Relational databases scale far for most workloads, and NoSQL makes you rebuild joins and transactions. Search engines are derived indexes, not systems of record. — _Probing:_ Do you choose from access patterns and invariants, and count operational cost? — _Say:_ "Relational by default, key-value for known-key scale, and search as an index fed by CDC that can be rebuilt from the source of truth."
   - **Thesis:** Choose from access patterns and consistency needs, not fashion. A relational database is the default for transactional data and flexible queries; key-value or wide-column stores fit very high-scale access by known keys; search engines are derived indexes for text and faceting, never the source of truth.
   - **60-second answer:** I'd list the queries and invariants first. If the data has relationships, needs transactions, and the queries aren't all known up front, a relational database is the right default, and modern Postgres or MySQL scale further than people assume with indexing, replicas and partitioning. If access is overwhelmingly by known key at very high throughput with simple consistency needs, like sessions, user feeds or IoT time series, a key-value or wide-column store like DynamoDB or Cassandra gives predictable latency and horizontal scale, at the cost of designing your tables around your queries and losing ad hoc joins. Full-text search, relevance ranking, fuzzy matching and faceted filters belong in a search engine like Elasticsearch or OpenSearch, fed from the source of truth via CDC, because search indexes aren't designed to be your system of record. Often the answer is all three, each doing what it's good at.
   - **Key points:**
     1. **Start from queries and invariants.** Write down the top queries, write patterns, consistency requirements and growth. The store choice should fall out of that list.
     2. **Relational as the default.** Transactions, constraints, joins, ad hoc queries and mature tooling. Scales a long way vertically, with read replicas and partitioning, before you need anything else.
     3. **Key-value and wide-column for known-key scale.** Predictable single-digit-millisecond access at huge scale when you know the access patterns. You model tables per query and give up joins and flexible querying.
     4. **Document stores for aggregate-shaped data.** Useful when data is read and written as a self-contained document with varying shape. Watch for needing cross-document transactions or joins later.
     5. **Search engines are derived indexes.** Great at text relevance, fuzzy matching, aggregations for facets. Eventually consistent, with weaker durability guarantees; rebuildable from the source of truth.
     6. **Operational cost counts.** Every new store adds backups, upgrades, monitoring, on-call knowledge and security review. Prefer fewer stores your team can run well.
   - **When to choose what:** Relational unless a specific access pattern or scale requirement rules it out. Add a key-value store for a well-understood, high-volume known-key workload. Add search as a derived index when users need text search or faceting. Avoid a store per service just because you can.
   - **Numbers:**
     - A single well-tuned relational primary on modern hardware can handle thousands to tens of thousands of simple transactions per second; read replicas multiply read capacity.
     - Managed key-value stores advertise consistent single-digit-millisecond latency at practically unbounded scale when keys are well distributed.
   - **Pitfalls:**
     - Choosing NoSQL for scale you don't have, then rebuilding joins and transactions in application code.
     - Using a search engine as the primary store and losing data on cluster problems.
     - Modelling a key-value store like a relational one and needing scans for common queries.
     - Adding a new store per team without the operational capacity to run it.
   - **Follow-ups:**
     - _When would you move off relational?_ When a specific workload exceeds what partitioning and replicas can handle, or needs a data model (graph traversal, time series at very high ingest) that relational handles poorly. Move that workload, not everything.
     - _How do you keep search in sync?_ CDC or an outbox stream from the source of truth into the indexer, idempotent upserts by id, and a full reindex job for recovery.
     - _What about NewSQL or distributed SQL?_ They offer relational semantics with horizontal scale, at the cost of higher write latency and operational complexity. Worth it when one relational node truly isn't enough and you need transactions across shards.
   - **Example:** A marketplace keeps orders and payments in Postgres, user sessions and carts in a key-value store, and listing search in OpenSearch fed by CDC from Postgres. Rebuilding the search index from Postgres takes two hours and is tested monthly.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 2 (data models)](https://dataintensive.net/); [AWS DynamoDB: Best practices for partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
13. **How do I model data differently for OLTP versus OLAP workloads?** [ref · Fundamental · Databases]
   - **Trap:** "Copy the production schema into the warehouse as-is." — _Why it fails:_ Normalised OLTP schemas make analysts write many-way joins, and overwriting attributes destroys history, so last year's reports silently change. — _Probing:_ Do you know dimensional modelling and slowly changing dimensions? — _Say:_ "OLTP stays normalised for integrity; OLAP gets fact and dimension tables, type-2 dimensions for history, partitioned by date."
   - **Thesis:** Model OLTP for correct, fast writes and point reads: normalised tables, narrow transactions, indexes for known lookups. Model OLAP for fast scans and simple queries over history: denormalised fact and dimension tables in columnar storage, loaded from OLTP.
   - **60-second answer:** In OLTP the goal is integrity under concurrent writes, so I'd normalise: each fact stored once, constraints in the database, short transactions, and indexes for the access paths the application uses. Denormalise only where a hot read path justifies it. In OLAP the goal is answering broad questions quickly, so I'd use a dimensional model: fact tables recording events like payments or loan disbursals with numeric measures and foreign keys, and dimension tables like customer, product and date, which may be wide and denormalised. Changing attributes are handled with slowly changing dimensions so history is preserved: a customer's region at the time of the payment, not today's. Data flows from OLTP by CDC or batch, is cleaned and conformed, and partitioned by date for pruning.
   - **Key points:**
     1. **OLTP: normalise for integrity.** Third normal form, foreign keys and constraints prevent anomalies under concurrent updates. Each update touches few rows.
     2. **OLTP: index for known access paths.** Index the lookups the application performs; every extra index slows writes. Keep transactions short to reduce lock contention.
     3. **OLAP: facts and dimensions.** A star schema: a central fact table (one row per event, with measures) joined to dimension tables. Simple for analysts and efficient for columnar engines.
     4. **OLAP: preserve history.** Slowly changing dimensions (for example type 2, with valid-from and valid-to rows) record attribute changes so reports reflect what was true at the time.
     5. **OLAP: partition and cluster.** Partition fact tables by date and cluster by common filter columns so queries scan only relevant data.
     6. **The transformation layer.** Raw replicated tables land first, then are cleaned, conformed (consistent ids, currencies, time zones) and modelled. Version this logic like code.
   - **When to choose what:** Normalised OLTP plus dimensional OLAP is the standard pairing. Denormalise OLTP only for measured hot reads, and prefer wide denormalised tables in OLAP when they simplify analyst queries without breaking history.
   - **Numbers:**
     - Date partitioning example: a fact table with 3 years of daily partitions; a query for last month scans about 30 of roughly 1,100 partitions, under 3% of the data.
   - **Pitfalls:**
     - Copying the OLTP schema straight into the warehouse and making analysts write ten-way joins.
     - Overwriting dimension attributes, so historical reports change retroactively.
     - Denormalising OLTP early and then fighting update anomalies.
     - Mixing currencies or time zones in fact tables without conforming them.
   - **Follow-ups:**
     - _When would you denormalise in OLTP?_ For a hot read path where joins are measurably expensive, such as storing an order total on the order row, with the update kept in the same transaction.
     - _Star schema or one big wide table?_ Wide tables are simpler for many tools and fast in columnar engines; star schemas manage changing dimensions and reuse better. Many teams model a star and publish wide tables on top.
     - _How do you handle late-arriving data?_ Load by event time into the right partition, reprocess affected aggregates, and track which partitions changed.
   - **Example:** A lender's OLTP has loans, repayments and customers in normalised tables. The warehouse has a repayments fact table (amount, days late, keys) and dimensions for customer (type 2, tracking region and risk band over time), product and date, so 'delinquency by risk band at origination' is a simple query.
   - **Sources:** [Kimball Group: Dimensional modeling techniques](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 3](https://dataintensive.net/)

### Partitioning & hot keys
14. **Pick a partition key for a multi-tenant ledger, then show how it fails.** [mine + ref · Intermediate · Sharding, Databases]
   - **Trap:** "Partition by tenant_id" (or by timestamp) and stop there. — _Why it fails:_ Tenant sizes are skewed, so the largest tenant becomes a hot partition; time keys send every write to the newest partition. The question explicitly asks how it fails. — _Probing:_ Can you place invariants inside one partition and name failure modes like hot accounts, cross-partition transfers and tenant-wide queries? — _Say:_ "(tenant, account), because balance invariants are per account. Then: split hot accounts, use sagas for cross-partition transfers, projections for reports, and dedicated capacity for giant tenants."
   - **Thesis:** For a multi-tenant ledger, partition by account (scoped by tenant), because every invariant, balance checks and posting order, lives at the account level. Then show where it breaks: giant tenants, hot accounts, and cross-account queries, and how you'd handle each.
   - **60-second answer:** The candidates are tenant, account and time. Time is wrong for a ledger: all writes go to the newest partition. Tenant alone is attractive for isolation but one large tenant becomes a hot partition and some tenants outgrow a partition. Account, as in (tenant_id, account_id), is my choice because the ledger's invariants, balance never negative and postings ordered, are per account, so a single-partition transaction can enforce them. Then the failure modes. A hot account, like a merchant settlement account receiving thousands of credits per second, overwhelms its partition; I'd split it into sub-accounts or buffer credits and post them in batches. Transfers between accounts on different partitions need a saga or two-step posting rather than one transaction. Tenant-wide queries like monthly statements scatter across partitions, so they go to a read model or the warehouse. And the plan needs a way to move a large tenant to dedicated capacity.
   - **Key points:**
     1. **List the candidates and their skew.** Tenant: isolation, but skewed by tenant size. Time: everything hits the latest partition. Account: matches invariants and spreads load if accounts are numerous.
     2. **Partition where invariants live.** Balance checks and posting order are per account, so (tenant_id, account_id) lets one local transaction enforce them without distributed coordination.
     3. **Failure: hot accounts.** A platform's settlement or fee account may receive a huge share of postings. Split it into N sub-accounts with a roll-up, or buffer and batch credits that don't need immediate visibility.
     4. **Failure: cross-partition transfers.** A transfer touches two accounts that may live on different partitions. Use a two-step posting (debit with a pending state, then credit) driven by a saga, idempotent per transfer id.
     5. **Failure: tenant-wide queries.** Statements, tenant totals and reporting scatter across partitions. Serve them from a projection or the warehouse rather than live scatter-gather on the ledger.
     6. **Failure: giant tenants.** Some tenants will dwarf others. Support moving a tenant to dedicated partitions or a dedicated cell, which needs online migration tooling.
     7. **Plan resharding from day one.** Use many logical partitions mapped to fewer physical ones, so rebalancing moves logical partitions rather than re-keying data.
   - **When to choose what:** Partition by account within tenant for ledgers and other per-entity invariants. Handle hot accounts by splitting or batching, cross-account operations with sagas, and reporting with projections. Reserve tenant-level partitioning for when strict tenant isolation is the primary requirement.
   - **Numbers:**
     - Logical partitions example: 4,096 logical partitions mapped onto 16 physical nodes; growing to 32 nodes moves whole logical partitions, about half of them, without changing keys.
     - Hot-account splitting: a settlement account receiving 5,000 postings/s split into 10 sub-accounts brings each to 500/s.
   - **Pitfalls:**
     - Partitioning by time and creating a permanently hot newest partition.
     - Partitioning by tenant and discovering the largest tenant is 40% of traffic.
     - Expecting single transactions across accounts on different partitions.
     - Running tenant-wide reports as live scatter-gather queries against the ledger.
   - **Follow-ups:**
     - _How do you keep a balance correct with sub-accounts?_ The total balance is the sum of sub-account balances; each sub-account enforces its own non-negative rule, and debits draw from sub-accounts with funds or from a rebalancing step.
     - _How do you move a large tenant to its own partitions?_ Dual-write or replicate its accounts to the new location, backfill, verify balances, switch routing in the tenant directory, then stop the old writes.
     - _Why not just use a distributed SQL database with cross-partition transactions?_ You can, at the cost of higher latency for those transactions. Keeping invariants single-partition still matters for throughput and tail latency.
   - **Example:** A payments platform keys its ledger by (tenant_id, account_id) across 4,096 logical partitions. Each merchant's fee account is split into 16 sub-accounts after it became hot during sales, and monthly statements are generated from a projection in the warehouse.
   - **Sources:** [AWS DynamoDB: Designing partition keys to distribute your workload](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-uniform-load.html); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 6 (Partitioning)](https://dataintensive.net/)
   - _Also asked as:_ What does a good partition key look like in a distributed store?
15. **A hot partition shows up at 2 a.m. Diagnose it and fix it without downtime.** [mine + ref · Advanced · Sharding, Operations, Databases]
   - **Trap:** "Add more nodes" or "scale up the cluster." — _Why it fails:_ A hot key always maps to one partition, so more nodes don't spread it. You have to target the key. — _Probing:_ Do you confirm skew with per-partition metrics, separate mitigation from the fix, and re-key online? — _Say:_ "First prove it's skew and find the key, then mitigate on that key (cache, rate limit, split), then fix the key design with dual writes and a backfill."
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
   - **Trap:** "Shard by region." — _Why it fails:_ Regions are wildly uneven, so the biggest market becomes one giant shard. Region is usually a residency or routing constraint, not a load-spreading key. — _Probing:_ Do you choose the key most queries carry and that spreads evenly, and plan rebalancing? — _Say:_ "Route by region where residency requires it, then shard by user or tenant within it, over many logical shards with a directory for exceptions."
   - **Thesis:** Shard on the dimension that most queries filter by and that spreads load evenly, then add a second dimension where compliance or locality demands it. Plan rebalancing and cross-shard queries before the first shard fills.
   - **60-second answer:** I'd pick the shard key by asking which value nearly every request carries and whether it distributes well. For consumer apps that's usually user id: requests are per user and users are numerous. For B2B SaaS it's usually tenant id, which also gives isolation and makes tenant export and deletion easy, but tenant sizes are skewed, so large tenants need special handling. Region is rarely the primary key for load, but it's often a top-level constraint for data residency and latency: first route to a region, then shard within it. Whatever the key, I'd use a directory or consistent hashing over many logical shards so rebalancing is moving shards, not rewriting keys, and I'd keep cross-shard queries out of hot paths by maintaining projections.
   - **Key points:**
     1. **The key most requests carry.** If 95% of queries include user_id, sharding by user keeps them single-shard. Queries without the key become scatter-gather and should be rare or served elsewhere.
     2. **Even distribution.** High cardinality and no dominant values. User ids usually distribute well; tenants and regions usually don't.
     3. **Tenant sharding for B2B.** Natural isolation, per-tenant backup, export and deletion, and easier noisy-neighbour control. Requires a strategy for very large tenants (dedicated shards).
     4. **Region as a top-level constraint.** Data residency or latency can require that data lives in a region. Route by region first via a directory, then shard by user or tenant within the region.
     5. **Directory or consistent hashing.** A lookup service mapping keys to shards gives flexibility (move one tenant) at the cost of a dependency. Hashing over many logical shards needs no lookup but moves data more coarsely.
     6. **Cross-shard work.** Global aggregates, search and admin views go to projections, a warehouse or a search index. Cross-shard transactions use sagas.
   - **When to choose what:** Consumer: shard by user. B2B: shard by tenant with dedicated capacity for large tenants. Regulated or global: region first, then user or tenant. Always over-provision logical shards and keep a directory for exceptions.
   - **Numbers:**
     - Over-provisioning: start with hundreds or thousands of logical shards on a few physical nodes so you can grow by moving shards for years without re-keying.
   - **Pitfalls:**
     - Sharding by region alone and getting one enormous shard for the biggest market.
     - Choosing a key that many important queries don't carry, making scatter-gather the norm.
     - No directory, so moving one problematic tenant requires rehashing everything.
     - Ignoring how to handle users who move regions or tenants that merge.
   - **Follow-ups:**
     - _A user moves from the EU to the US. What happens to their data?_ Residency rules decide. Often data stays in the original region until a deliberate migration; the directory points to its current home, and the move is a copy, verify and switch.
     - _How do you run a global report?_ Not against shards directly: stream changes into a warehouse and query there, or maintain pre-aggregated counters per shard and sum them.
     - _When is consistent hashing better than a directory?_ When keys are uniform and you don't need per-key placement control. A directory wins when individual tenants need to be placed or moved deliberately.
   - **Example:** A B2B SaaS routes requests through a tenant directory to one of three regional clusters, and within each region hashes tenants across 1,024 logical shards. Two very large tenants have dedicated shards; global usage reporting runs in the warehouse.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 6 (Partitioning)](https://dataintensive.net/); [AWS Builders' Library: Workload isolation using shuffle-sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/)
17. **Your data is sharded by user id, but you need to query by email or by order status. How do secondary indexes work in a sharded store?** [mine · Advanced · Sharding, Databases]
   - **Trap:** "Just add an index on email." — _Why it fails:_ In a sharded store, a local index on each shard still means asking every shard (scatter-gather). A global index has to be maintained across shards, usually asynchronously. — _Probing:_ Local (document-partitioned) vs global (term-partitioned) indexes and their read/write trade-offs. — _Say:_ "Local indexes make writes cheap but reads scatter to every shard; a global index partitioned by the indexed value makes reads single-shard but writes touch two places, usually updated asynchronously."
   - **Thesis:** Secondary indexes in a sharded system are either local to each shard (cheap writes, scatter-gather reads) or global and partitioned by the indexed value (single-shard reads, cross-shard writes that are typically asynchronous). Choose by query frequency and how fresh the index must be.
   - **60-second answer:** Sharding by user id makes lookups by user id single-shard, but a lookup by email doesn't know which shard to ask. With local indexes, each shard indexes its own rows; a query by email goes to every shard and merges results. Writes stay local and consistent, but reads cost N shard requests and tail latency is the slowest shard. With a global index, the index itself is partitioned by email, so a lookup goes to one index shard and then to the data shard. Reads are cheap, but every write updates both the data shard and an index shard, often on different machines, so it's either a distributed transaction or, more commonly, an asynchronous update with a short window where the index is stale. For uniqueness, like 'emails must be unique', you need a global index that's updated synchronously or a dedicated uniqueness service. Low-cardinality fields like status are poor index keys and better served by a search or analytics store.
   - **Key points:**
     1. **Local (document-partitioned) indexes.** Each shard indexes its own data. Writes are simple; reads by the indexed field scatter to all shards.
     2. **Global (term-partitioned) indexes.** The index is sharded by the indexed value. Reads hit one index shard; writes update data and index shards separately.
     3. **Global index freshness.** Most systems update global indexes asynchronously (for example DynamoDB global secondary indexes are eventually consistent), so reads may miss recent writes.
     4. **Uniqueness needs a global decision.** Unique emails or usernames require a single place that decides: a synchronously maintained global index or a lookup table keyed by the unique value.
     5. **Low-cardinality fields.** Indexing 'status' creates huge, hot index partitions. Use a search engine, materialised views or the warehouse for such queries.
     6. **Lookup tables as a pattern.** A separate table keyed by email storing the user id (and shard) is a simple, explicit global index.
   - **When to choose what:** Rare queries: local indexes and scatter-gather. Frequent lookups by a secondary key: a global index or lookup table, accepting async staleness unless uniqueness requires synchronous updates. Analytical or low-cardinality filters: a search or analytics store.
   - **Numbers:**
     - Scatter-gather cost: a query to 64 shards whose individual p99 is 20 ms has a much higher chance of hitting at least one slow shard, so overall p99 can be several times worse than a single-shard read.
   - **Pitfalls:**
     - Assuming a global secondary index is immediately consistent.
     - Scatter-gather queries on hot paths.
     - Enforcing uniqueness with an async index, allowing duplicates in the gap.
     - Indexing low-cardinality fields and creating hot partitions.
   - **Follow-ups:**
     - _How do you enforce unique emails across shards?_ A lookup table keyed by email with a conditional insert as part of signup, before or together with creating the user record.
     - _How do you handle the staleness of an async global index?_ Read-your-writes handling for the writer (look up by primary key after a write), and design flows so the index is used for discovery, not for decisions needing fresh data.
     - _When is scatter-gather fine?_ Low query volume, few shards, or admin and background queries where latency matters less.
   - **Example:** A marketplace sharded orders by buyer id. Seller dashboards needed orders by seller, so the team added a seller-to-order lookup table maintained by CDC with seconds of lag, and served status-based filters from a search index instead of database indexes.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 6 (partitioning and secondary indexes)](https://dataintensive.net/); [AWS DynamoDB: Using global secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)

### Indexing
18. **Design indexes for a table that takes 90 percent writes.** [mine + ref · Intermediate · Databases]
   - **Trap:** "Add indexes for every query so reads are fast." — _Why it fails:_ On a write-heavy table every index is maintained on every write, multiplying I/O, log volume and replication lag. — _Probing:_ Do you understand write amplification and where else reads can be served? — _Say:_ "Only the few indexes hot reads need, covering where possible, append-friendly keys, time partitions, and everything ad hoc moved to a replica or warehouse."
   - **Thesis:** On a write-heavy table every index is a tax on every write, so keep only indexes that serve real, frequent queries, make those covering where it pays, and push ad hoc or analytical reads to a replica, search index or warehouse. Consider an LSM-based engine if writes dominate at scale.
   - **60-second answer:** With 90% writes, each secondary index multiplies write work: every insert updates every index, causing more I/O, more WAL or redo, more lock and latch contention, and more replication volume. So I'd start from the read queries that actually matter, by frequency and latency requirement, and give each the minimum index that serves it, ideally covering so the read doesn't touch the table. I'd drop unused or duplicate indexes, which databases can report. Primary key choice matters: an append-friendly, time-ordered key keeps inserts at the end of the B-tree instead of scattering them. Reads that don't need to be on the primary, such as reporting, search and exploration, move to a replica with extra indexes or to a different store. And if write volume is huge and mostly appends, an LSM-tree engine handles it better than a B-tree.
   - **Key points:**
     1. **Every index costs on every write.** Inserts and updates must maintain each index, adding I/O, log volume, contention and replication traffic. Five indexes can mean several times the write work of the bare table.
     2. **Index for real queries only.** Inventory queries by frequency and latency need. Use the database's statistics on index usage to find unused indexes and drop them.
     3. **Covering and composite indexes.** One composite index in the right column order can serve several queries; including the selected columns avoids table lookups. Fewer, better indexes beat many narrow ones.
     4. **Append-friendly primary keys.** Time-ordered keys (bigint sequences, UUIDv7) insert at the right edge of the B-tree. Random keys scatter writes and cause page splits.
     5. **Move secondary reads elsewhere.** A replica can carry extra indexes if your database allows, or stream data to a search index or warehouse for exploration and reporting.
     6. **Consider LSM engines.** LSM trees (RocksDB-based stores, Cassandra) turn random writes into sequential ones and handle very high ingest, trading some read cost and compaction overhead.
     7. **Partition by time.** For append-mostly data, time partitions keep active indexes small and make retention a cheap partition drop instead of mass deletes.
   - **When to choose what:** Minimal indexes on the primary: the primary key and the one to three indexes that serve hot reads. Everything else on replicas or derived stores. Re-evaluate with real usage statistics every few months.
   - **Numbers:**
     - Rough write amplification: a table with 1 primary key and 4 secondary indexes performs about 5 index updates per insert. Removing 2 unused indexes cuts index maintenance by about 40%.
     - Time partitioning: dropping a monthly partition is a metadata operation; deleting the same rows one by one generates a huge amount of log and vacuum work.
   - **Pitfalls:**
     - Adding an index for every slow query report without checking write impact.
     - Duplicate or overlapping indexes (an index on (a) and another on (a, b)).
     - Random UUID primary keys on a high-ingest table.
     - Deleting old rows individually instead of dropping partitions.
   - **Follow-ups:**
     - _How do you add an index to a busy table safely?_ Use the database's online or concurrent index build, during lower traffic, while watching replication lag, and test the plan on production-size data first.
     - _A critical read is slow but you can't add another index. Options?_ Serve it from a cache or materialised view updated asynchronously, or from a replica with its own index, or reshape the query to use an existing composite index.
     - _When does an LSM engine hurt?_ Read-heavy workloads with many point lookups across levels, and workloads with heavy updates or deletes that create compaction pressure.
   - **Example:** An event ingestion table took 20,000 inserts/s with seven indexes and lagging replication. Usage stats showed three indexes unused and two overlapping. Reducing to three indexes and partitioning by day cut write latency in half and replication lag disappeared; investigative queries moved to the warehouse.
   - **Sources:** [Markus Winand: Use The Index, Luke](https://use-the-index-luke.com/); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 3 (B-trees and LSM-trees)](https://dataintensive.net/)
   - _Also asked as:_ How should I index for read-heavy versus write-heavy workloads?

### Migrations & backfills
19. **Migrate a billion-row table to a new schema with zero downtime.** [mine + ref · Advanced · Migration, Reliability, Databases]
   - **Trap:** "Run ALTER TABLE in a maintenance window" or "copy the table and switch over." — _Why it fails:_ At a billion rows, that means long locks, replication lag, hours of downtime and no rollback. The question asks for zero downtime. — _Probing:_ Do you know expand and contract, throttled resumable backfills, verification and shadow reads? — _Say:_ "Expand, dual write, a throttled backfill with checkpoints, checksum verification, shadow reads, a gradual read cutover, and contract only after a full cycle."
   - **Thesis:** Migrate in phases that are each reversible: expand the schema, dual-write, backfill in throttled and resumable chunks, verify, shadow-read, cut over reads, then contract. At a billion rows the dangers are locks, replication lag and correctness drift, so every phase is observable and stoppable.
   - **60-second answer:** I'd never do this as one big ALTER or copy. Phase one, expand: create the new table or columns without touching existing reads. Phase two, dual-write: the application writes both old and new shapes, ideally in one transaction, or via CDC from the old table, so new data lands in both. Phase three, backfill: copy existing rows in primary-key ranges with a throttle tied to replication lag and database load, idempotent and resumable from a checkpoint. Phase four, verify: row counts and checksums per key range, plus sampled deep comparisons. Phase five, shadow reads: read from both, serve the old, log mismatches. Phase six, cut over reads behind a flag, ramping gradually. Phase seven, stop writing the old shape and drop it only after a full cycle without rollback. At a billion rows the backfill might take days, which is fine as long as it's safe.
   - **Key points:**
     1. **Expand without blocking.** Create new tables or nullable columns using online DDL where needed. Avoid operations that rewrite the table or take long exclusive locks.
     2. **Dual-write new data.** Application writes both shapes in one transaction, or a CDC pipeline mirrors changes from old to new. Choose one and make it idempotent.
     3. **Throttled, resumable backfill.** Process key ranges in batches (thousands of rows), checkpoint progress, and pause automatically when replication lag or latency rises. Upsert so reruns are safe and don't overwrite newer dual-written data.
     4. **Verify before trusting.** Compare counts and checksums per range, then sample rows for field-level comparison. Fix and re-run ranges that differ.
     5. **Shadow reads.** Read from both representations for a portion of traffic, serve the old result, and log mismatches. This catches transformation bugs with production queries.
     6. **Cut over gradually.** Switch reads behind a flag by percentage or by tenant. Keep dual writes running so rollback is a flag flip.
     7. **Contract last.** Stop old writes, wait a full business cycle, then drop old columns or tables. Archive if regulations require.
   - **When to choose what:** Use expand-and-contract with dual writes for any large table that must stay online. Use CDC-based copying when application changes are hard, and specialised online schema change tools (gh-ost, pt-online-schema-change) for in-place schema changes on MySQL.
   - **Numbers:**
     - Backfill time: 1 billion rows at a throttled 20,000 rows/s is about 14 hours of pure copy time; with pauses for load, plan for one to three days.
     - Batch sizing: batches of 1,000–10,000 rows keep each transaction short, limiting lock time and replication bursts.
   - **Pitfalls:**
     - Backfill overwriting rows that dual writes already updated with newer data; use version or timestamp checks.
     - Ignoring replication lag, so replicas fall minutes behind and read-your-writes breaks.
     - No checkpointing, so a failure at row 800 million restarts from zero.
     - Dropping the old column in the same release as the cutover.
   - **Follow-ups:**
     - _How do you handle rows updated during the backfill?_ Dual writes keep the new table current; the backfill uses insert-if-absent or compares versions so it never overwrites a newer value.
     - _How would you verify a billion rows efficiently?_ Checksums aggregated per key range in both stores; only ranges with mismatched checksums get row-level comparison.
     - _What if you can't change the application to dual-write?_ Use CDC from the old table into the new one, or an online schema change tool that uses triggers or the binlog to keep a shadow table in sync.
   - **Example:** Moving a 1.2-billion-row transactions table to a partitioned layout: dual writes via the application, a backfill throttled to keep replica lag under 2 seconds that ran for 40 hours, checksum verification per million-id range, a week of shadow reads with zero mismatches, then a tenant-by-tenant read cutover.
   - **Sources:** [Martin Fowler: Parallel change (expand and contract)](https://martinfowler.com/bliki/ParallelChange.html); [GitHub: gh-ost, online schema migration for MySQL](https://github.com/github/gh-ost)
   - _Also asked as:_ How do I design a migration strategy for a huge table?
20. **How do I safely backfill data in production?** [ref · Advanced · Migration, Databases]
   - **Trap:** "A script that loops with OFFSET and LIMIT and updates rows." — _Why it fails:_ OFFSET gets slower and skips or repeats rows as data changes. A non-idempotent, unthrottled script can overwrite live writes and flood replication. — _Probing:_ Idempotency, checkpoints, adaptive throttling and not clobbering newer data. — _Say:_ "Keyset ranges with checkpoints, conditional upserts that never overwrite newer values, throttling on replica lag, and a kill switch."
   - **Thesis:** A safe backfill is idempotent, resumable, throttled against live load, verifiable and stoppable. Treat it as a production service with metrics and a kill switch, not a one-off script.
   - **60-second answer:** I'd write the backfill so running it twice is harmless: compute values deterministically and upsert, or skip rows already processed, and never overwrite newer data written by live traffic. It processes data in key ranges with a persistent checkpoint, so it can stop and resume anywhere. Its rate adapts to the database's health: back off when replication lag, CPU or p99 latency rise, and run harder off-peak. It emits progress, error counts and throughput, and has a kill switch. Before the full run I'd test it on a production snapshot and then on a small slice of production, and afterwards verify with counts, checksums or sampled comparisons. And I'd decide in advance what happens with rows that fail: skip and log them for a retry pass, not abort the whole job.
   - **Key points:**
     1. **Idempotent by design.** Deterministic transformation plus upsert, or a processed marker. Use conditional writes so a backfilled value never replaces a newer value from live traffic.
     2. **Resumable with checkpoints.** Iterate by primary key ranges and store the last completed key durably. Avoid OFFSET pagination, which gets slower and skips or repeats rows as data changes.
     3. **Adaptive throttling.** Measure replication lag, database CPU and application latency; slow down or pause when thresholds are crossed. Fixed sleeps are a weak substitute.
     4. **Observable and stoppable.** Dashboards for progress, rate, errors and estimated completion. A feature flag or config to pause instantly.
     5. **Test on realistic data.** Run against a recent production snapshot to catch edge cases (nulls, legacy formats, huge rows), then a small production slice.
     6. **Handle failures per row.** Log failing keys with reasons to a dead-letter table and continue. Re-run only those after fixing the cause.
     7. **Verify the result.** Counts per range, checksums, and sample comparisons against expected values; sign off before switching anything to depend on the data.
   - **When to choose what:** Run as a managed job (a worker with checkpoints) for anything beyond a few million rows or anything touching hot tables. Small, cold-table backfills can be simpler, but still idempotent.
   - **Numbers:**
     - Throttle example: target replication lag under 1 second and database CPU under 60%; batch 2,000 rows; if lag exceeds 1 second, halve the rate; if under 0.2 seconds, increase by 10%.
   - **Pitfalls:**
     - OFFSET/LIMIT pagination over a changing table.
     - Overwriting values that live traffic updated after the backfill read them.
     - One giant transaction that locks rows for minutes and floods the log.
     - Aborting the whole job on the first bad row.
   - **Follow-ups:**
     - _The backfill needs data from another service. How do you avoid overloading it?_ Apply the same throttling to calls to that service, coordinate a rate with its owners, cache lookups, or use its bulk export instead of per-row calls.
     - _How do you estimate how long it will take?_ Measure throughput on a slice under the throttle, multiply by total rows, and add margin for pauses during peak hours.
     - _How do you backfill derived data like a search index?_ Same pattern, often simpler: rebuild into a new index alias, verify counts, then swap the alias atomically.
   - **Example:** Backfilling a new 'risk_band' column on 300 million loan rows: a worker processes 5,000-row ranges, writes only where risk_band is null, checkpoints after each batch, and pauses when replica lag exceeds 1 second. It completed in 30 hours with 212 rows logged for manual review.
   - **Sources:** [Markus Winand: We need tool support for keyset pagination (no OFFSET)](https://use-the-index-luke.com/no-offset); [Martin Fowler: Parallel change (expand and contract)](https://martinfowler.com/bliki/ParallelChange.html)
21. **How do I do schema changes without downtime?** [ref · Advanced · Migration, Databases]
   - **Trap:** "Rename the column and deploy the code that uses the new name." — _Why it fails:_ During a rolling deploy, old code still uses the old name and breaks, and rollback breaks too. Some DDL also takes locks that block all traffic. — _Probing:_ Do you know that N and N-1 must coexist, how to use lock timeouts, and online DDL tools? — _Say:_ "Expand and contract across releases: add the new column, write both, backfill, switch reads, drop later, with a short lock timeout on every migration."
   - **Thesis:** Zero-downtime schema changes come from two habits: never make a change that breaks the currently running code, and avoid operations that take long locks or rewrite large tables. Expand and contract across several deploys, using online DDL or shadow-table tools for the heavy steps.
   - **60-second answer:** The application and the schema change at different times, so every schema change must work with both the old and new code. Adding is safe if it's nullable or has a default the database can apply without a rewrite. Renaming or changing a type is done as add new, write both, backfill, switch reads, then drop old, spread across releases. Then the lock problem: some DDL takes an exclusive lock or rewrites the table, and even a brief lock can queue behind a long-running transaction and block all traffic. So I'd set a short lock timeout and retry, build indexes concurrently, and for heavy changes use online tools like gh-ost for MySQL or the database's own online DDL. I'd test each migration against a production-sized copy and run it with monitoring and a way to abort.
   - **Key points:**
     1. **Compatible with running code.** During deploys, old and new code run together. A migration must not remove or rename anything the old code uses, and must not require something the old code doesn't provide.
     2. **Expand and contract across releases.** Add the new column or table, deploy code that writes both, backfill, deploy code that reads new, then remove old in a later release.
     3. **Know which DDL locks or rewrites.** Behaviour differs by database and version: adding a column with a constant default is instant in recent Postgres and MySQL; changing a column type often rewrites the table.
     4. **Lock timeouts protect traffic.** A DDL waiting for a lock blocks everything queued behind it. Set a short lock timeout (a few seconds) so the migration fails fast and retries instead of stalling production.
     5. **Online index builds.** Use concurrent or online index creation. It takes longer and can fail, so check for invalid indexes afterwards.
     6. **Shadow-table tools for heavy changes.** gh-ost and pt-online-schema-change copy the table in the background, keep it in sync, and swap names at the end, avoiding long locks.
     7. **Rehearse on production-size data.** A migration that takes 2 seconds on staging can take an hour on production. Test timings and lock behaviour on a realistic copy.
   - **When to choose what:** Additive changes can ship any time with lock timeouts. Renames, type changes and drops always use expand and contract over multiple releases. Heavy rewrites on large tables use online tools during low-traffic windows.
   - **Numbers:**
     - Lock timeout example: lock_timeout of 2–5 seconds on migration sessions; if it fails, retry with backoff rather than holding a queue of blocked queries.
   - **Pitfalls:**
     - Renaming a column in one step while old code still reads it.
     - A migration waiting on a lock behind a long analytics query, blocking all writes.
     - Adding a NOT NULL column without a default on an old database version that rewrites the table.
     - Running migrations automatically on deploy without timing tests on production-size data.
   - **Follow-ups:**
     - _How do you make a column NOT NULL safely?_ Add it nullable, backfill, add a check constraint as not validated, validate it separately (which doesn't block writes in Postgres), then set NOT NULL.
     - _Who runs migrations: the app on startup or a separate step?_ A separate, controlled step in the pipeline, with lock timeouts and monitoring, so many app instances don't race to run it and failures don't block deploys.
     - _How do you handle a migration that fails halfway?_ Make each migration small and transactional where the database supports transactional DDL; otherwise make it idempotent so it can be rerun.
   - **Example:** Renaming 'amount' to 'amount_minor' on a 400-million-row payments table: release 1 adds amount_minor; release 2 writes both; a throttled backfill fills history; release 3 reads amount_minor; release 4, two weeks later, drops amount. No single step held a lock longer than a second.
   - **Sources:** [GitHub: gh-ost, online schema migration for MySQL](https://github.com/github/gh-ost); [PostgreSQL documentation: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)

### Retention & deletion
22. **Design retention, soft delete and legal erasure so they do not contradict each other.** [mine + ref · Intermediate · Cost & compliance, Databases]
   - **Trap:** "Add a deleted_at column, and that handles deletion requests." — _Why it fails:_ Soft delete keeps the data, which fails legal erasure. Copies in logs, the warehouse, search and backups remain, and retention rules can conflict with erasure. — _Probing:_ Do you separate undo, retention and erasure, define precedence, and cover every copy? — _Say:_ "Three different clocks: soft delete for undo, retention for policy, erasure for law, with written precedence, propagation to every store, and crypto-shredding for backups."
   - **Thesis:** Soft delete, retention and legal erasure run on different clocks for different reasons: undo, policy and law. Model them separately, decide which wins when they conflict (usually a legal hold or regulatory retention beats an erasure request, and erasure beats ordinary retention), and make sure each one reaches backups, logs and derived stores.
   - **60-second answer:** I'd separate the three. Soft delete is a product feature: a deleted_at marker so users can undo, with queries filtering it out, and a purge after, say, 30 days. Retention is policy: how long each data class is kept, like logs for 90 days or transaction records for years if regulation requires it, enforced by automated purges, ideally partition drops. Erasure is a legal right in many jurisdictions: delete or anonymise a person's personal data on request, within a deadline. They conflict, for example when someone asks for erasure but financial regulation requires keeping their loan records, so I'd write the precedence down: legal holds and regulatory retention win, but only for the data they cover, and the rest is erased. Then the hard part is coverage: replicas, caches, search indexes, the warehouse, logs, and backups. For backups, crypto-shredding helps: encrypt each person's data with their own key and delete the key.
   - **Key points:**
     1. **Soft delete for undo.** deleted_at column, default query filters, unique constraints that account for deleted rows, and a scheduled hard purge after the undo window.
     2. **Retention per data class.** Classify data (transactions, logs, analytics events, support tickets) with a retention period and a legal basis. Automate purges; time partitioning makes them cheap.
     3. **Erasure as a workflow.** Receive and verify the request, find the person's data across systems by stable ids, delete or anonymise, record completion, and meet the statutory deadline.
     4. **Precedence rules.** Legal hold > regulatory retention > erasure request > ordinary retention > soft delete. Apply per data class, so retained financial records don't keep unrelated marketing data alive.
     5. **Coverage beyond the primary.** Caches, search indexes, the warehouse, event streams, logs and third-party processors all hold copies. Deletes must propagate (tombstones, CDC) or be scheduled per system.
     6. **Backups and crypto-shredding.** Rewriting backups is impractical. Either let them expire within a known window and re-apply erasures on restore, or encrypt personal data per subject and destroy the key.
     7. **Prove it.** Keep an audit log of what was deleted, when and where, without storing the deleted personal data itself.
   - **When to choose what:** Model the three explicitly with a data inventory. Use anonymisation where records must be kept for aggregate or regulatory reasons but identity needn't be. Use crypto-shredding for data that ends up in immutable stores.
   - **Numbers:**
     - Example policy: soft-delete undo window 30 days; application logs 90 days; loan and payment records retained for the regulatory period (often several years); erasure requests completed within the statutory deadline, for example one month under GDPR.
   - **Pitfalls:**
     - Soft-deleted rows still visible through a search index or analytics table.
     - Erasure that removes the main record but leaves personal data in logs, events or backups.
     - Retention purges that delete data under a legal hold.
     - No data inventory, so nobody knows every place a customer's data lives.
   - **Follow-ups:**
     - _A customer with an active loan requests erasure. What happens?_ Data needed to service the loan and meet regulatory retention is kept with that legal basis documented; everything else (marketing preferences, analytics identity) is erased now, and the retained data is erased when the obligation ends.
     - _How does erasure work with an event log you can't rewrite?_ Keep personal data out of events where possible (reference ids instead), or encrypt personal fields per subject and delete the key.
     - _How do you find all the data for one person?_ A data inventory mapping systems to data classes, a stable subject id carried everywhere, and per-system erasure handlers invoked by one orchestrated workflow.
   - **Example:** A lender soft-deletes draft applications for 30 days, retains loan records for the regulatory period, and handles erasure via a workflow that anonymises marketing and analytics data immediately, flags retained loan data with its legal basis, and destroys the subject's encryption key once retention ends.
   - **Sources:** [GDPR Article 17: Right to erasure](https://gdpr-info.eu/art-17-gdpr/); [GDPR Article 12: Time limits for responding to requests](https://gdpr-info.eu/art-12-gdpr/)
   - _Also asked as:_ How do I design soft delete, archival, and retention?

### Multi-tenancy
23. **How do I handle multi-tenant data isolation?** [ref · Intermediate · Sharding, Reliability]
   - **Trap:** "Every query includes WHERE tenant_id = ?, so we're isolated." — _Why it fails:_ One forgotten filter leaks data. Isolation that depends on every developer remembering is not enforcement. — _Probing:_ Enforcement in the data layer, tenant id from the authenticated context, and testing for cross-tenant access. — _Say:_ "Tenant id comes from authentication and is enforced with row-level security or a mandatory repository filter, with tests that attempt cross-tenant reads on every endpoint."
   - **Thesis:** Pick an isolation model per tier, not one for everyone: shared tables with a tenant id for most tenants, and schema- or database-per-tenant for those who need stronger isolation or have outgrown the pool. Enforce tenant scoping in the data layer, not in each query, and design noisy-neighbour controls and tenant export from the start.
   - **60-second answer:** There are three models. Pooled: shared tables with tenant_id on every row; cheapest and easiest to operate, weakest isolation. Schema-per-tenant: separate schemas in a shared database; better logical isolation, but migrations run per schema and catalogues grow. Database- or cluster-per-tenant: strongest isolation and per-tenant backup, restore and residency, at much higher cost and operational load. I'd usually run pooled for most tenants and offer dedicated databases for large or regulated tenants. In the pooled model, the key is enforcement: tenant id must come from the authenticated context, never from request parameters, and be applied automatically, through row-level security in Postgres or a mandatory tenant filter in the data access layer, with tests that try cross-tenant access. Then per-tenant quotas and rate limits for noisy neighbours, per-tenant encryption keys if required, and tooling for tenant export, deletion and moving a tenant between models.
   - **Key points:**
     1. **Pooled: shared tables, tenant_id everywhere.** Most efficient and simplest to migrate and monitor. Isolation depends entirely on correct scoping, so enforcement must be systematic.
     2. **Schema-per-tenant.** Clearer separation and easy per-tenant export. Migrations must run across thousands of schemas, and some databases degrade with very large catalogues.
     3. **Database-per-tenant.** Strong isolation, per-tenant performance, backups, residency and encryption. Costly at small sizes; needs automation for provisioning and migrations.
     4. **Enforce scoping in the data layer.** Derive tenant id from authentication, set it in the session, and apply it via row-level security or a mandatory repository filter. Code reviews alone aren't enforcement.
     5. **Test for cross-tenant leaks.** Automated tests that authenticate as tenant A and attempt to read tenant B's resources by id across every endpoint.
     6. **Noisy neighbours.** Per-tenant rate limits, query timeouts, concurrency caps and resource pools. Watch per-tenant resource usage to spot those who need to move.
     7. **Tenant lifecycle tooling.** Export, deletion, and migration of a tenant from pooled to dedicated without downtime.
   - **When to choose what:** Pooled by default with row-level security or an enforced filter. Dedicated databases for tenants who pay for it, are regulated, or are large enough to disturb others. Schema-per-tenant mainly when tenant counts are modest and per-tenant customisation is needed.
   - **Numbers:**
     - Cost intuition: pooled can host thousands of small tenants on one cluster; database-per-tenant has a floor cost per tenant (instance, backups, monitoring) that dominates for small tenants.
   - **Pitfalls:**
     - Taking tenant id from a request parameter or header the client controls.
     - One missed WHERE tenant_id = ? in a new query, leaking data.
     - Caches keyed without tenant id, serving one tenant's data to another.
     - No path to move a large tenant out of the pool.
   - **Follow-ups:**
     - _How does row-level security work in practice?_ The application sets a session variable with the tenant id after authentication; policies on each table restrict rows to that tenant, so a query missing a filter still can't see other tenants.
     - _How do you run migrations across 5,000 tenant databases?_ An orchestrated rollout with batches, canaries, retries and a status table, and backward-compatible changes so tenants at different versions keep working.
     - _A tenant asks for their own encryption keys. Can pooled support that?_ Partially, with per-tenant data keys for application-level encryption of sensitive fields; full key isolation is easier with dedicated databases.
   - **Example:** A SaaS runs 3,000 tenants pooled in Postgres with row-level security tied to a session tenant id, and 12 enterprise tenants on dedicated clusters provisioned from the same infrastructure code. A nightly test suite tries cross-tenant reads on every API endpoint.
   - **Sources:** [PostgreSQL documentation: Row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html); [AWS Builders' Library: Workload isolation using shuffle-sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/)

### Concurrency & replication
24. **Your database runs at read committed. Which bugs can that cause, and when do you need something stronger?** [mine · Advanced · Databases, Consistency]
   - **Trap:** "We use transactions, so concurrent requests are safe." — _Why it fails:_ A transaction at read committed still allows lost updates, non-repeatable reads and write skew. Wrapping code in BEGIN/COMMIT doesn't serialise it. — _Probing:_ Whether you can name the anomalies and pick the cheapest fix for each. — _Say:_ "Read committed allows lost updates and write skew. I'd fix lost updates with atomic or conditional updates or SELECT FOR UPDATE, and use serializable or explicit locking where an invariant spans several rows."
   - **Thesis:** Isolation level decides which concurrency anomalies the database prevents for you. Most databases default to read committed, which still allows lost updates and write skew, so you must know which invariants need atomic updates, row locks, constraints or serializable isolation.
   - **60-second answer:** Read committed only guarantees you don't see uncommitted data. Two transactions can both read a balance of 100, both subtract 30, and both write 70: a lost update. Two doctors can both check that at least one other doctor is on call and both go off call: write skew, because each transaction's check was valid against a snapshot but the combined result breaks the rule. Repeatable read or snapshot isolation fixes non-repeatable reads, and in some engines lost updates, but not write skew. Serializable prevents all of them at the cost of aborts and retries. So I'd handle each case with the cheapest correct tool: atomic updates like UPDATE ... SET balance = balance - 30 WHERE balance >= 30; SELECT FOR UPDATE to lock the rows a decision depends on; unique or check constraints for invariants the database can express; and serializable isolation with retry for complex multi-row invariants.
   - **Key points:**
     1. **Know the anomalies.** Dirty read, non-repeatable read, phantom, lost update and write skew. Read committed prevents only dirty reads (and dirty writes).
     2. **Lost update.** Read-modify-write cycles in application code overwrite each other. Fix with atomic in-database updates, compare-and-set on a version column, or row locks.
     3. **Write skew.** Two transactions read overlapping data, make decisions, and write different rows, together violating an invariant. Snapshot isolation doesn't prevent it.
     4. **Engine defaults differ.** PostgreSQL defaults to read committed and its repeatable read is snapshot isolation; MySQL InnoDB defaults to repeatable read with different locking behaviour. Don't assume the name means the same thing everywhere.
     5. **Serializable has a cost.** It prevents all anomalies but transactions can abort under contention, so the application must retry. Throughput falls on hot rows.
     6. **Constraints beat code checks.** Unique constraints, exclusion constraints and check constraints enforce invariants regardless of isolation level and concurrency.
   - **When to choose what:** Keep the default level for most work, use atomic updates and constraints for single-row invariants, SELECT FOR UPDATE or version checks for read-then-write logic, and serializable (with retries) only for multi-row invariants that can't be expressed otherwise.
   - **Numbers:**
     - A hot row updated by many transactions under serializable or row locks serialises them: if each holds the lock for 5 ms, that row tops out around 200 updates per second.
   - **Pitfalls:**
     - Checking a condition in application code, then writing, without a lock or conditional update.
     - Assuming repeatable read means the same in PostgreSQL and MySQL.
     - Turning on serializable without retry logic, so users see random failures.
     - Long transactions holding locks while calling external services.
   - **Follow-ups:**
     - _How would you stop two users booking the same meeting room slot?_ An exclusion or unique constraint on (room, slot), so the database rejects the second insert regardless of isolation level.
     - _What's the difference between optimistic and pessimistic handling here?_ Pessimistic locks rows up front (SELECT FOR UPDATE); optimistic checks a version at write time and retries on conflict. Optimistic wins when conflicts are rare.
     - _Why not just use serializable everywhere?_ More aborts and lower throughput on contended data, plus every caller needs retry logic. Use it where the invariant needs it.
   - **Example:** A wallet service lost money when two concurrent withdrawals each read the balance and wrote the result. Switching to UPDATE wallets SET balance = balance - :amt WHERE id = :id AND balance >= :amt, and checking the affected row count, fixed it without changing the isolation level.
   - **Sources:** [PostgreSQL documentation: Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html); [Jepsen: Consistency models](https://jepsen.io/consistency)
25. **Optimistic or pessimistic concurrency control: how do you choose, and what breaks with each?** [mine · Intermediate · Databases, Consistency]
   - **Trap:** "Optimistic locking is always better because it doesn't block." — _Why it fails:_ Under high contention optimistic control turns into a retry storm: most writers fail and redo work. Pessimistic locking is the right tool for hot rows. — _Probing:_ Matching the strategy to conflict rate and understanding the failure mode of each. — _Say:_ "Optimistic when conflicts are rare and retries are cheap; pessimistic when the same rows are contended or a retry is expensive or user-visible."
   - **Thesis:** Optimistic control lets everyone proceed and detects conflicts at write time (a version check); pessimistic control locks first so conflicts can't happen. Choose by conflict rate, cost of retrying, and how long the critical section is.
   - **60-second answer:** With optimistic concurrency, each row carries a version. You read it, do your work, and write with WHERE version = :seen; if zero rows change, someone else won and you retry or report a conflict. No locks are held, which suits web apps where users edit different records and conflicts are rare, and it works across requests, for example an edit form submitted minutes later. With pessimistic concurrency, you lock the row (SELECT FOR UPDATE) before reading and hold it until commit, so others wait. That suits hot rows such as an inventory counter or a ticket allocation, where optimistic retries would mostly fail. The failure modes differ: optimistic degrades into retry storms under contention; pessimistic risks lock waits, deadlocks and long-held locks if the transaction does slow work. I'd also consider avoiding the question entirely with atomic updates or queuing writes per key.
   - **Key points:**
     1. **Optimistic: version check on write.** Read version, write with a version predicate, check affected rows. Conflicts surface as a retry or a 409 to the user.
     2. **Good for long, user-driven edits.** Locks can't be held across HTTP requests, so ETags and If-Match headers are the standard optimistic pattern for APIs.
     3. **Pessimistic: lock then act.** SELECT FOR UPDATE (or advisory locks) serialises access to the row for the transaction's duration.
     4. **Good for hot, short critical sections.** Counters, allocations and balances under contention. Keep the transaction short and never call external services while holding the lock.
     5. **Deadlocks and lock ordering.** Lock rows in a consistent order (for example by id) and set lock timeouts so deadlocks resolve quickly.
     6. **Sometimes avoid both.** Atomic single-statement updates, append-only designs, or a single writer per key remove the conflict instead of managing it.
   - **When to choose what:** Optimistic for low-contention edits and API resources (ETags). Pessimistic for short, contended critical sections. Atomic updates or per-key serialisation when the operation allows it.
   - **Numbers:**
     - Rule of thumb: if more than a few percent of optimistic writes conflict, retries waste significant work and pessimistic locking or per-key queuing is usually better.
   - **Pitfalls:**
     - Optimistic retries on a hot row, where nearly every attempt fails.
     - Holding row locks during network calls.
     - Inconsistent lock ordering causing deadlocks.
     - Forgetting to check the affected row count, so version conflicts are silently ignored.
   - **Follow-ups:**
     - _How do you implement optimistic concurrency in a REST API?_ Return an ETag with the resource; clients send If-Match on update; the server returns 412 Precondition Failed if the version changed.
     - _A pessimistic lock is held while calling a payment provider. Problem?_ Yes: provider latency becomes lock time and blocks other writers. Record intent, release the lock, call the provider, then finalise with a state machine.
     - _How do you detect too much contention?_ Track version-conflict rates, lock wait time and deadlock counts per table or endpoint.
   - **Example:** A CMS used optimistic versioning for article edits, showing editors a 'someone else saved first' merge screen. The seat-allocation service for events switched from optimistic to SELECT FOR UPDATE on the seat row after retries reached 60% during popular sales.
   - **Sources:** [Martin Fowler: Optimistic offline lock](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html); [MDN: If-Match header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Match)
26. **Leader-follower, multi-leader or leaderless replication: what does each cost you, and which would you pick?** [mine · Advanced · Databases, Reliability]
   - **Trap:** "Multi-leader so every region can write locally." — _Why it fails:_ Multi-leader means concurrent writes to the same data in different places, which need conflict resolution. Last-writer-wins silently drops data, and invariants like balances can break. — _Probing:_ Whether you understand write conflicts, replication lag and failover data loss for each topology. — _Say:_ "Single leader unless I truly need local writes in several regions; then I'd partition ownership so each record has one home leader, and use multi-leader or leaderless only for data that merges cleanly."
   - **Thesis:** Single-leader replication is simplest and gives one order of writes, at the cost of a write bottleneck and failover risk. Multi-leader allows writes in several places but requires conflict resolution. Leaderless (quorum) replication tolerates node failures without failover but needs careful quorum and repair design.
   - **60-second answer:** Single leader: all writes go to one node, which streams changes to followers. Reads scale with followers, writes are ordered, and conflicts don't exist, but the leader caps write throughput and failover can lose recent writes if replication is asynchronous. Multi-leader: several leaders, often one per region, accept writes and replicate to each other. Local writes are fast and survive a region partition, but two leaders can modify the same record concurrently, so you need conflict handling: last-writer-wins (loses data), custom merge, CRDTs, or avoiding conflicts by giving each record a home leader. Leaderless, as in Dynamo-style stores: clients write to several replicas and read from several, with quorums deciding overlap, read repair and anti-entropy fixing divergence. No failover step, high availability, but subtle consistency behaviour. For most systems I'd choose single leader per partition, with partitioned ownership if regions need local writes.
   - **Key points:**
     1. **Single leader: simple ordering.** One write order, easy reasoning, mature tooling. Followers serve reads with replication lag.
     2. **Single leader: failover risk.** Async replication means a failover can lose the last writes; split brain is possible without fencing. Sync replication avoids loss but adds latency.
     3. **Multi-leader: local writes.** Useful for multi-region or offline clients. Every concurrent write to the same key is a potential conflict.
     4. **Conflict resolution options.** Last-writer-wins (simple, lossy), application merge, CRDTs (counters, sets), or avoiding conflicts by routing each key to one leader.
     5. **Leaderless: quorums.** Write to W of N, read from R of N; W + R > N gives overlap. Hinted handoff and sloppy quorums increase availability but weaken guarantees.
     6. **Repair mechanisms.** Read repair and background anti-entropy (Merkle trees) bring replicas back in line in leaderless systems.
   - **When to choose what:** Single leader per partition by default. Partitioned home-leader ownership for multi-region writes. Multi-leader with merges for collaborative or offline data. Leaderless for high-availability key-value workloads with commutative or tolerant data.
   - **Numbers:**
     - Async replication lag of 500 ms at 2,000 writes/s means about 1,000 writes at risk on an unplanned leader failover.
   - **Pitfalls:**
     - Multi-leader with last-writer-wins on data where losing a write matters.
     - Assuming quorum reads are linearizable.
     - Failover without fencing, leaving two leaders.
     - Ignoring replication lag in read paths.
   - **Follow-ups:**
     - _How do collaborative editors handle multi-leader conflicts?_ Operational transformation or CRDTs, which merge concurrent edits deterministically so all replicas converge.
     - _What does W=1, R=1 with N=3 give you?_ Fast reads and writes but no overlap guarantee, so reads can be stale; fine for caches or metrics, not for critical state.
     - _How do you make single-leader failover safe?_ A consensus-backed leader election, epochs or fencing on writes, and a stated RPO equal to replication lag.
   - **Example:** A global SaaS moved from a multi-leader setup with last-writer-wins, which occasionally lost settings changes, to single-leader-per-tenant with each tenant homed in one region. Cross-region conflicts disappeared, and only users far from their tenant's region saw higher write latency.
   - **Sources:** [Martin Kleppmann: Designing Data-Intensive Applications, chapter 5 (Replication)](https://dataintensive.net/); [DeCandia et al.: Dynamo](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)

### Specialised storage & queries
27. **Design uploads of multi-gigabyte files from users with unreliable connections.** [mine · Intermediate · Databases, APIs]
   - **Trap:** "The client uploads the file to our API server, which writes it to S3." — _Why it fails:_ Proxying gigabytes through app servers ties up connections, memory and bandwidth, and a dropped connection restarts the whole upload. — _Probing:_ Direct-to-storage uploads with presigned URLs, multipart and resumability, and post-upload processing. — _Say:_ "The API issues presigned multipart URLs; the client uploads parts directly to object storage, retries failed parts, completes the upload, and a storage event triggers async validation and processing."
   - **Thesis:** Keep large bytes off your application servers. Clients upload directly to object storage using short-lived presigned URLs, in parts that can be retried and resumed, and your system tracks the upload as a resource with states, processing it asynchronously once complete.
   - **60-second answer:** I'd model an upload as a resource. The client asks the API to start an upload with the file name, size and type; the API checks permissions and quotas, creates an upload record, starts a multipart upload in object storage, and returns presigned URLs for each part, valid for a short time. The client uploads parts in parallel directly to storage, retrying only failed parts, and can resume later by asking which parts are done. When all parts are uploaded, the client calls complete, storage assembles the object, and an event triggers processing: virus scanning, type validation, thumbnails or transcoding. Only after validation does the file become visible. I'd add a lifecycle rule to abort incomplete multipart uploads after a day or two, and enforce size limits and content types in the presigned policy so clients can't upload arbitrary data.
   - **Key points:**
     1. **Direct-to-storage with presigned URLs.** App servers handle only metadata and authorisation; the bytes go straight to object storage, which scales for this.
     2. **Multipart uploads.** Split into parts (S3 allows parts from 5 MB, up to 10,000 parts per upload), upload in parallel, retry individual parts on failure.
     3. **Resumability.** Track completed parts (from storage or your upload record) so clients can resume after closing the app or losing connectivity.
     4. **Upload as a resource with states.** initiated, uploading, uploaded, processing, ready, rejected. The client and UI follow these states.
     5. **Validate after upload.** Scan for malware, check actual content type and size, and quarantine until checks pass.
     6. **Constrain what can be uploaded.** Presigned policies with content-length ranges and content types, per-user quotas, and short URL expiry.
     7. **Clean up.** Lifecycle rules to abort incomplete multipart uploads and delete rejected files.
   - **When to choose what:** Presigned multipart uploads for anything beyond a few megabytes; single presigned PUT for small files; never proxy large files through application servers unless you must transform them in-stream.
   - **Numbers:**
     - A 5 GB file in 100 MB parts is 50 parts; a dropped connection costs at most one part (100 MB) of re-upload instead of the whole file.
     - S3 multipart limits: part size from 5 MB (except the last), up to 10,000 parts, objects up to 5 TB.
   - **Pitfalls:**
     - Streaming uploads through the API tier.
     - Long-lived presigned URLs that can be shared or abused.
     - Making files visible before scanning.
     - Never cleaning up incomplete multipart uploads, which keep costing storage.
   - **Follow-ups:**
     - _How do you prevent someone uploading a 50 GB file when you allowed 2 GB?_ Set the expected size at initiation, issue a fixed number of parts with size constraints, and verify the final object size before accepting it.
     - _How do you handle uploads from browsers?_ CORS configuration on the bucket for your origin, presigned URLs per part, and a client library that manages parallelism and retries.
     - _How do you dedupe identical files?_ Compute a content hash client-side or after upload and reference existing objects, being careful about privacy across users.
   - **Example:** A document platform replaced API-proxied uploads with presigned multipart uploads. Upload failures on mobile fell sharply because retries were per 16 MB part, and API server memory spikes disappeared. A storage event queue drives scanning and OCR.
   - **Sources:** [AWS S3: Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html); [AWS S3: Sharing objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
28. **Count unique visitors and top-K items across billions of events per day. Do you need exact answers?** [mine · Advanced · Databases, Scaling]
   - **Trap:** "Store every user id in a set and count it" or "SELECT COUNT(DISTINCT user_id)." — _Why it fails:_ Exact distinct counts and top-K over billions of events need memory proportional to the number of distinct items and are expensive to merge across time ranges. Most product uses tolerate about 1% error. — _Probing:_ Whether you know probabilistic data structures and when approximation is acceptable. — _Say:_ "For dashboards I'd use HyperLogLog for distinct counts and count-min sketch or heavy-hitter algorithms for top-K, with a few KB per counter and around 1% error, and keep exact counts only where money depends on them."
   - **Thesis:** When the question is 'about how many' or 'which are the biggest', probabilistic structures give small, mergeable answers with bounded error: HyperLogLog for distinct counts, count-min sketch and heavy-hitter algorithms for frequencies and top-K, Bloom filters for membership. Use exact counting only where correctness matters.
   - **60-second answer:** Exact unique counts need to remember every id seen, which at billions of events means huge memory, and combining days means unioning huge sets. HyperLogLog estimates distinct counts using a few kilobytes per counter with a standard error around 1%, and two HLLs can be merged, so daily sketches combine into weekly or monthly counts cheaply. For top-K, a count-min sketch estimates frequencies in fixed memory, possibly overestimating, and algorithms like Space-Saving track heavy hitters directly. Bloom filters answer 'have I seen this before?' with no false negatives and a tunable false-positive rate. I'd ask first whether approximation is acceptable: dashboard unique visitors and trending items, yes; billing, ad spend and payouts, no, or at least reconciled with exact batch counts. Redis, Druid, BigQuery and many warehouses ship these structures built in.
   - **Key points:**
     1. **Ask if approximate is acceptable.** Product analytics and trending usually tolerate small errors; billing and payouts don't.
     2. **HyperLogLog for distinct counts.** Fixed small memory, roughly 1% standard error at typical settings, mergeable across shards and time windows.
     3. **Count-min sketch for frequencies.** Fixed memory, estimates never undercount, error bounded by width and depth. Good for 'how often' queries.
     4. **Heavy hitters for top-K.** Space-Saving or count-min plus a heap tracks the most frequent items in bounded memory.
     5. **Bloom filters for membership.** Check 'seen before?' with no false negatives and configurable false positives; useful for dedupe and avoiding needless lookups.
     6. **Use built-in implementations.** Redis (PFADD/PFCOUNT), warehouses (APPROX_COUNT_DISTINCT) and stream processors provide these; avoid writing your own.
   - **When to choose what:** Approximate structures for analytics, trending and dedupe at scale; exact counting (often batch, reconciled) for anything financial or contractual.
   - **Numbers:**
     - Redis HyperLogLog uses at most about 12 KB per key and has a standard error of 0.81%.
     - Exact distinct count of 1 billion 8-byte ids needs roughly 8 GB just for the ids, before set overhead.
   - **Pitfalls:**
     - Using approximate counts for billing.
     - Summing HLL estimates instead of merging sketches, which double-counts overlapping users.
     - Bloom filters sized for today's volume, whose false-positive rate climbs as items grow.
     - COUNT(DISTINCT) over raw events on every dashboard load.
   - **Follow-ups:**
     - _How do you get weekly uniques from daily counts?_ Store a daily HyperLogLog sketch and merge seven of them; adding the daily numbers would double-count returning users.
     - _How do you dedupe events with a Bloom filter safely?_ Use it as a fast pre-check; on a possible duplicate, confirm against an exact store if a false positive would drop a real event.
     - _When is exact counting still needed in streaming?_ Ad billing, payouts and quotas. Count exactly in a batch or with idempotent keyed aggregates and reconcile with the streaming estimate.
   - **Example:** A content platform replaced per-article exact unique-reader sets (tens of GB in Redis) with per-article daily HyperLogLogs (about 12 KB each). Monthly uniques are now a merge of 30 sketches, accurate within about 1%, and memory fell by over 99%.
   - **Sources:** [Redis documentation: HyperLogLog](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/); [Flajolet et al.: HyperLogLog (2007)](https://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf)
29. **Find the nearest drivers, stores or users to a location quickly. How do you index location data?** [mine · Intermediate · Databases, Scaling]
   - **Trap:** "Store latitude and longitude, add an index on each, and compute distance for every row." — _Why it fails:_ Separate indexes on lat and lng don't answer 'near' efficiently, and computing distance to every row doesn't scale. Spatial indexing (geohash, quadtree, S2/H3, R-tree) narrows candidates first. — _Probing:_ Whether you know spatial indexes, cell edge effects, and how to handle fast-moving points. — _Say:_ "I'd index by spatial cells (geohash, S2 or H3), query the target cell plus its neighbours, then compute exact distances on that small candidate set; for moving drivers, keep locations in memory keyed by cell."
   - **Thesis:** Spatial queries need a spatial index that groups nearby points: geohash prefixes, quadtrees, Google S2 or Uber H3 cells, or R-trees (PostGIS). Query the relevant cells and neighbours to get candidates, then rank by exact distance. Fast-moving points need an in-memory, frequently updated index.
   - **60-second answer:** Latitude and longitude indexes separately give you a band, not a circle, so the database still scans lots of rows. Spatial indexes map 2D locations into cells. Geohash encodes a location as a string where a shared prefix means nearby, so a prefix range query finds candidates; but two close points can sit on opposite sides of a cell boundary, so you always search neighbouring cells too. S2 and H3 provide hierarchical cells with better shape properties; H3's hexagons have uniform neighbours, which suits ride-hailing and delivery. For static data like stores, PostGIS with an R-tree (GiST) index handles 'within radius' and 'nearest' queries well. For moving drivers updating every few seconds, I'd keep current locations in memory, such as Redis GEO commands or a sharded in-memory index keyed by cell, rather than writing every update to a disk-based database.
   - **Key points:**
     1. **Why plain indexes fail.** Two B-tree indexes can't efficiently answer a 2D proximity query; you end up scanning a large band and computing distance per row.
     2. **Cell-based indexes.** Geohash, S2 and H3 map points to cells at chosen resolutions. Nearby points mostly share cells or prefixes.
     3. **Search neighbours too.** Points near a cell edge have nearest neighbours in adjacent cells. Query the cell plus surrounding cells, then filter by exact distance.
     4. **Tree-based indexes.** R-trees (PostGIS GiST) and quadtrees index shapes and points directly; good for static or slowly changing data and complex geometry.
     5. **Choose resolution by density.** Dense cities need finer cells; rural areas need coarser cells or expanding-ring searches until enough candidates are found.
     6. **Moving points in memory.** Frequent location updates belong in an in-memory index (Redis GEO, custom sharded grid), with periodic persistence for history.
   - **When to choose what:** Static places: PostGIS or a search engine with geo support. High-frequency moving objects: in-memory cell index (H3 or geohash) sharded by region. Always query neighbours and refine with exact distance.
   - **Numbers:**
     - Driver updates: 500,000 active drivers updating every 4 seconds is 125,000 writes/s, too many for a typical relational primary but fine for a sharded in-memory index.
     - Geohash precision: 6 characters is roughly a 1.2 km × 0.6 km cell; 7 characters roughly 150 m.
   - **Pitfalls:**
     - Searching only the user's own cell and missing closer points across the boundary.
     - Using one cell size for dense cities and empty regions.
     - Writing every location ping to the main database.
     - Forgetting that longitude distance shrinks toward the poles when doing naive math.
   - **Follow-ups:**
     - _How do you find the K nearest when nearby cells are empty?_ Expanding-ring search: widen to neighbouring rings of cells until you have at least K candidates, then rank.
     - _Why hexagons (H3) rather than squares?_ Each hexagon has six equidistant neighbours, which makes distance-based ring searches and aggregation more uniform.
     - _How do you shard a geospatial index?_ By coarse region or cell prefix, with hot cities split further; keep queries near borders able to hit adjacent shards.
   - **Example:** A delivery app keeps courier locations in Redis keyed by H3 cells at resolution 8 and queries the order's cell plus one ring of neighbours, ranking about 50 candidates by road-network ETA. Store locations live in PostGIS for radius searches.
   - **Sources:** [Uber H3: Hexagonal hierarchical spatial index](https://h3geo.org/); [Redis documentation: Geospatial](https://redis.io/docs/latest/develop/data-types/geospatial/)

## Caching & Performance (9)

### Caching strategy
30. **Where should I cache: client, edge, service, or DB layer?** [ref · Fundamental · Caching, Latency]
   - **Trap:** "Put Redis in front of the database." — _Why it fails:_ It ignores the layers that save the most latency (client, CDN) and the trade-off between proximity and invalidation control. — _Probing:_ Whether you match each layer to how widely data is shared and how stale it can be. — _Say:_ "As close to the user as staleness allows: versioned assets at client and edge, public pages at the edge with short TTLs, computed data in a service cache."
   - **Thesis:** Cache as close to the user as the data's sharing and freshness allow. The closer the cache, the bigger the latency win and the weaker your control over invalidation, so match each layer to how volatile and how shared the data is.
   - **60-second answer:** I'd walk the layers. The client, meaning the browser or app, is best for per-user data and static assets with long cache lifetimes and versioned file names; it removes requests entirely but you can't invalidate it, so you rely on short TTLs or versioning. The edge or CDN is best for public or per-region content shared by many users, like images, scripts and catalogue pages, with TTLs, purge APIs and stale-while-revalidate. The service-side cache, Redis or Memcached, is best for computed results and hot objects shared across instances, where you control invalidation precisely. In-process caches are the fastest but per instance, fine for small, slow-changing reference data. The database's own buffer cache already holds hot pages; a cache in front helps when queries are expensive, not just when rows are hot. So the choice is driven by who shares the data, how stale it can be, and whether you need to invalidate it on demand.
   - **Key points:**
     1. **Client cache.** HTTP caching headers (Cache-Control, ETag) and app storage. Zero network cost on hits. Use content hashes in asset URLs so you can cache 'forever' and still deploy changes.
     2. **Edge / CDN.** Shared across users in a region, absorbs most traffic for public content, and protects the origin. Supports TTLs, purges and serving stale content when the origin is down.
     3. **Service-side shared cache.** Redis or Memcached for computed results, sessions, and hot objects. Precise invalidation and data structures, at the cost of a network hop and another system to run.
     4. **In-process cache.** Fastest (no network), but duplicated per instance and inconsistent across them. Good for reference data with short TTLs.
     5. **Database layer.** Buffer pools and query caches. Materialised views for expensive aggregations. A separate cache helps when the work, not the I/O, is expensive.
     6. **Choose by sharing and volatility.** Personal and stable: client. Public and stable: edge. Shared and changing: service cache with invalidation. Highly volatile or must be correct: maybe don't cache.
   - **When to choose what:** Layer them: versioned static assets at client and edge with long TTLs; public pages at the edge with short TTLs and stale-while-revalidate; computed and per-user data in a service cache; nothing cached that must be strictly current (balances used for decisions).
   - **Numbers:**
     - Latency intuition: client hit ~0 ms, edge hit typically tens of milliseconds closer than origin, service cache hit around a millisecond in-zone, in-process hit microseconds.
   - **Pitfalls:**
     - Caching personalised responses at the edge without varying on user, leaking one user's page to another.
     - Long client TTLs on non-versioned URLs, so users keep stale code after a deploy.
     - Caching everything in-process across 100 instances, multiplying memory and staleness.
     - Caching data used for correctness decisions.
   - **Follow-ups:**
     - _How do you cache personalised pages?_ Cache the shared shell at the edge and fetch personal fragments separately, or use edge logic that varies by a coarse segment instead of individual user.
     - _What does stale-while-revalidate give you?_ The cache serves a slightly stale response immediately while fetching a fresh one in the background, hiding origin latency and smoothing load.
     - _How do you invalidate CDN content quickly?_ Purge APIs by URL or tag (surrogate keys), or version the URL so new content has a new key.
   - **Example:** A product catalogue serves images and scripts from a CDN with year-long TTLs and hashed file names, product pages at the edge with a 60-second TTL and stale-while-revalidate, prices from a Redis cache invalidated on price change, and the cart directly from the database.
   - **Sources:** [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching); [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/)
31. **How do I pick between write-through, write-back, and write-around caching?** [ref · Fundamental · Caching]
   - **Trap:** "Write-back, because it's fastest." — _Why it fails:_ Write-back acknowledges before the data is durable, so a cache node failure loses writes, which is unacceptable for orders or money. — _Probing:_ Durability trade-offs, and knowing the common default is cache-aside with delete-on-write. — _Say:_ "Cache-aside with delete-on-write for most data; write-back only for loss-tolerant aggregates like view counts."
   - **Thesis:** Write-through updates cache and store together, keeping them aligned at the cost of write latency. Write-back acknowledges after updating the cache and writes the store later: fast, but risks loss. Write-around writes only to the store and lets reads populate the cache, avoiding pollution with rarely read data. Most application caches use cache-aside with write-around plus invalidation.
   - **60-second answer:** The question is what happens on a write. Write-through: write to the store and the cache synchronously, so reads right after a write hit a fresh cache; writes are slower and you may cache data nobody reads. Write-back, or write-behind: write to the cache, acknowledge, and flush to the store asynchronously, which is great for write-heavy, loss-tolerant workloads like counters and metrics but dangerous for anything you can't lose, because a cache failure loses unflushed writes. Write-around: write only to the store, and the next read misses and loads it; best when written data is often not read soon, avoiding cache churn. In practice, for most services I'd use cache-aside: read from cache, on miss load from the database and populate; on write, update the database and delete the cache key, so the next read loads fresh data.
   - **Key points:**
     1. **Write-through.** Synchronous write to store and cache. Reads after writes are fresh. Write latency includes both, and rarely read data still occupies cache.
     2. **Write-back (write-behind).** Write to cache, acknowledge, persist later in batches. Lowest write latency and fewer store writes. Data loss if the cache fails before flushing; ordering and durability need care.
     3. **Write-around.** Write to the store only. The cache fills on read. Avoids polluting the cache with write-once data; first read after a write is a miss.
     4. **Cache-aside, the common default.** Application owns caching: read-through on miss, and on write update the database then delete (not update) the cache key.
     5. **Delete rather than update on write.** Updating the cache on write can race with concurrent writes and leave a stale value. Deleting forces a fresh load; combined with TTLs, it bounds staleness.
     6. **Durability decides write-back.** Use write-back only when losing a window of writes is acceptable or the cache itself is durable and replicated.
   - **When to choose what:** Cache-aside with delete-on-write for most application data. Write-through when reads immediately follow writes and a miss is expensive. Write-back for high-volume, loss-tolerant aggregates (view counts, rate counters). Write-around for write-heavy data that's rarely read back soon.
   - **Numbers:**
     - Write-back batching: 10,000 counter increments/s flushed every second as aggregated updates per key can turn into a few hundred database writes/s instead of 10,000.
   - **Pitfalls:**
     - Write-back for financial or order data, losing writes on a cache node failure.
     - Update-on-write races: two writers interleave and the cache ends up with the older value.
     - Write-through for data that's rarely read, filling the cache with cold entries.
     - Forgetting that the cache and the database can't be updated atomically; design for brief inconsistency.
   - **Follow-ups:**
     - _Why delete instead of update on write?_ With concurrent writers, 'update database then set cache' can apply in a different order to each store, leaving stale data. Delete makes the next read load whatever is current.
     - _Can delete-on-write still leave stale data?_ Yes, a reader can load an old value just before the write and put it into the cache just after the delete. TTLs bound the staleness; versioned keys or leases close the gap further.
     - _When would you use a read-through cache library?_ When you want the caching logic centralised (the cache loads from the store on miss), which simplifies application code but couples the cache to the data source.
   - **Example:** A social app keeps post view counts with write-back: increments go to Redis and are flushed every 5 seconds, accepting the loss of a few seconds of counts on failure. Post content uses cache-aside: edits update Postgres and delete the cached post.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/); [Nishtala et al.: Scaling Memcache at Facebook (NSDI 2013)](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala)
32. **How do I design cache invalidation rules that do not become a nightmare?** [ref · Intermediate · Caching]
   - **Trap:** "Invalidate the cache whenever the data changes," with no TTLs. — _Why it fails:_ Invalidations get missed (derived keys, lost events), and without a TTL a miss means stale data forever. — _Probing:_ TTL as a staleness contract, event-driven invalidation only where needed, versioned keys. — _Say:_ "Every entry has a TTL with jitter that encodes acceptable staleness; events invalidate only fast-changing data; versioned keys avoid delete-and-refill races."
   - **Thesis:** Make staleness a decision, not an accident: give every cached item a TTL with jitter that states how stale it may be, add event-driven invalidation only for data that must change faster than the TTL, prefer versioned keys over deletes, and build keys in one place.
   - **60-second answer:** Invalidation gets nightmarish when it's ad hoc: every code path that writes data has to remember every cache key derived from it. I'd simplify with four rules. First, every entry has a TTL that encodes acceptable staleness for that data, with jitter so entries don't expire together. Second, for data that must update quickly, like prices or permissions, invalidate on change via events, so the service that owns the data publishes a change event and cache owners react, rather than writers calling caches directly. Third, where possible use versioned keys: include a version or updated-at in the key so a change creates a new key and old entries simply age out, which avoids races between delete and refill. Fourth, centralise key construction in one module so the mapping from data to keys is in one place. And I'd accept bounded staleness explicitly in product requirements.
   - **Key points:**
     1. **TTL as a staleness contract.** Choose a TTL per data type from how stale it may be (catalogue description: an hour; price: a minute; permissions: seconds). Every entry has one, as a safety net.
     2. **Jitter.** Randomise TTLs (for example ±10%) so entries created together don't expire together and cause a load spike.
     3. **Event-driven invalidation for fast-changing data.** The owning service publishes change events; cache layers subscribe and delete or refresh affected keys. Writers don't need to know about every cache.
     4. **Versioned keys.** Key includes a version (product:123:v42). Updates bump the version; readers use the new key, and old entries expire. No delete-refill race.
     5. **One place for key construction.** A shared module builds keys from inputs, so invalidation logic and read logic agree, and you can find every key derived from an entity.
     6. **Bounded staleness is a product decision.** Agree how stale each view may be, write it down, and monitor it. Then cache behaviour is testable.
   - **When to choose what:** TTL plus jitter for everything; event-driven invalidation for the few data types with tight freshness needs; versioned keys where races matter; don't cache data where any staleness is unacceptable.
   - **Numbers:**
     - Jitter example: a 300-second TTL with ±30 seconds of jitter spreads expirations of a batch of keys over a minute instead of one instant.
   - **Pitfalls:**
     - No TTL on entries 'because we invalidate', so a missed invalidation means stale data forever.
     - Writers calling cache deletes for keys they know about, missing derived keys (lists, aggregates).
     - Identical TTLs on a batch of keys, causing synchronised expiry.
     - Key construction duplicated across services with slight differences.
   - **Follow-ups:**
     - _How do you invalidate derived data like a list of a user's posts?_ Either keep short TTLs on lists, invalidate list keys on post change events, or store lists as ids and fetch items separately so only item caches need invalidation.
     - _What if the invalidation event is lost?_ The TTL bounds the damage. For critical data, use versioned keys or check a version stamp on read.
     - _How do you test invalidation?_ Integration tests that write through the real path and assert the next read reflects it, plus monitoring of a sample of cache entries against the source.
   - **Example:** A marketplace caches listings for 10 minutes with jitter, but prices use versioned keys bumped by a PriceChanged event, so price updates appear within a second while descriptions can lag.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/); [Nishtala et al.: Scaling Memcache at Facebook (NSDI 2013)](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala)
33. **How do I handle cache stampede and thundering herd?** [ref · Intermediate · Caching, Reliability]
   - **Trap:** "Use a longer TTL." — _Why it fails:_ A longer TTL delays the stampede but doesn't prevent it. When the hot key finally expires, the herd still hits the database. — _Probing:_ Request coalescing, leases, stale-while-revalidate and jitter. — _Say:_ "Only one caller rebuilds (single-flight or a lease), everyone else gets stale data meanwhile, and TTLs are jittered so keys don't expire together."
   - **Thesis:** A stampede happens when a hot entry expires and many requests rebuild it at once. Make sure only one caller rebuilds (request coalescing or a lease), let others use stale data while it does (stale-while-revalidate), and avoid synchronised expiry (jitter, early refresh).
   - **60-second answer:** When a popular key expires, every concurrent request misses and goes to the database at the same moment, which can take the database down and keep the cache empty. I'd layer defences. Request coalescing: within a process, concurrent misses for a key wait on one in-flight load, often called single-flight. Across processes, a short lease or lock in the cache, as described in Facebook's memcache paper, where the first misser gets the right to rebuild and others wait briefly or get the stale value. Stale-while-revalidate: keep the old value past its soft TTL and serve it while one caller refreshes in the background. Probabilistic early refresh: as an entry nears expiry, a small and increasing fraction of requests refresh it early, so it rarely expires under load. And jitter on TTLs so a batch of keys doesn't expire together. For extreme hot keys, pre-warm or refresh them on a schedule.
   - **Key points:**
     1. **Understand the failure.** Hot key expires, N concurrent requests miss, N identical database queries run. If the query is slow, the herd grows while it runs.
     2. **In-process request coalescing.** Concurrent requests for the same key share one in-flight load (single-flight). Cuts the herd to one per instance.
     3. **Distributed leases or locks.** First miss acquires a short-lived lease in the cache; others wait briefly, retry, or receive stale data. The lease must expire in case the holder dies.
     4. **Stale-while-revalidate.** Store a soft expiry and a hard expiry. After soft expiry, serve stale and refresh in the background; only after hard expiry do callers block.
     5. **Probabilistic early expiration.** Each read near expiry refreshes with a probability that rises as expiry approaches, so refresh happens before expiry, spread across time.
     6. **Jitter and pre-warming.** Randomised TTLs avoid mass expiry; scheduled refresh of known hot keys keeps them always warm.
     7. **Protect the origin anyway.** Concurrency limits on the expensive query path, so even a stampede that gets through can't overwhelm the database.
   - **When to choose what:** Single-flight in every service that caches; stale-while-revalidate for hot, tolerably stale data; distributed leases for very expensive rebuilds; jitter always.
   - **Numbers:**
     - Herd size: a key read 5,000 times/s with a 200 ms rebuild query sees about 1,000 concurrent misses without coalescing; with single-flight across 20 instances, 20; with a distributed lease, 1.
   - **Pitfalls:**
     - Locks without expiry: a crashed holder leaves the key locked and everyone waiting.
     - Waiting callers with no timeout, piling up behind a slow rebuild.
     - Coalescing only in-process while running hundreds of instances.
     - Cold start after a cache flush or failover with no warming plan.
   - **Follow-ups:**
     - _The whole cache cluster restarts. How do you avoid a database meltdown?_ Warm the hottest keys before taking traffic, ramp traffic gradually, keep coalescing and concurrency limits on the database path, and consider a replicated cache so a node loss doesn't empty everything.
     - _How does stale-while-revalidate interact with correctness?_ It serves data up to soft TTL plus refresh time old. Only use it for data where that's acceptable.
     - _What about negative caching?_ Cache 'not found' results briefly too, or a flood of requests for a missing key hammers the database.
   - **Example:** A homepage feed cached for 60 seconds caused a database spike every minute at peak. Adding single-flight, a 10-second stale-while-revalidate window, and ±10% TTL jitter flattened database load to one rebuild per key per minute.
   - **Sources:** [Nishtala et al.: Scaling Memcache at Facebook (leases)](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala); [RFC 5861: HTTP Cache-Control extensions for stale content](https://www.rfc-editor.org/rfc/rfc5861)
34. **What is my caching story for hot keys and large objects?** [ref · Intermediate · Caching, Scaling]
   - **Trap:** "Consistent hashing spreads the load." — _Why it fails:_ Consistent hashing spreads keys, not traffic to a single key. One hot key still saturates one shard. — _Probing:_ Near-caches, replicating hot keys, size caps and keeping blobs out of the cache. — _Say:_ "A short-TTL near-cache in each instance for hot keys, replicas of extreme keys across shards, and capped, compressed or split large values."
   - **Thesis:** Hot keys concentrate load on one cache shard; large objects waste memory, bandwidth and latency. Spread hot keys (local near-caches, replicas of the key) and break up or shrink large values (split, compress, cap size), and watch per-shard load so one key can't saturate one node.
   - **60-second answer:** In a sharded cache, each key lives on one node, so a very hot key, like a celebrity profile or a flash-sale product, can saturate that node's CPU or network while the rest idle. I'd first add a small in-process near-cache with a short TTL in each service instance, which absorbs most reads for the hottest keys. For extreme cases, replicate the key: store it under N suffixed keys on different shards and read a random one, accepting slightly more work on updates. For large objects, the problems are memory pressure, eviction of many small useful keys, slow network transfer and serialisation, and blocking on single-threaded caches like Redis. So I'd cap object size, compress, split large values into chunks or store only the frequently used parts, and keep really large blobs in object storage with the cache holding metadata or a pointer. And monitor per-shard ops and bandwidth plus a top-keys report.
   - **Key points:**
     1. **Detect hot keys.** Per-shard metrics (ops/s, network, CPU) and top-key sampling. One shard far above the others usually means a hot key.
     2. **Near-cache in each instance.** A tiny in-process cache with a TTL of a few seconds for the hottest keys removes most network reads. Accept a few seconds of staleness.
     3. **Replicate hot keys.** Write key:1..key:N across shards; readers pick one at random. Updates write all copies or use short TTLs.
     4. **Cap and compress large values.** Set a maximum size; compress (often a big win for JSON); avoid storing large blobs that are rarely read in full.
     5. **Split or reshape large objects.** Store parts separately (profile summary vs full history) so common reads fetch only what they need.
     6. **Large blobs belong elsewhere.** Images, documents and big payloads go to object storage or a CDN; cache a pointer or metadata.
     7. **Mind single-threaded caches.** In Redis, a command on a very large value or a huge collection blocks other requests on that node.
   - **When to choose what:** Near-cache for read-hot keys with tolerable staleness; key replication for extreme cases; size caps, compression and reshaping for large values; object storage for blobs.
   - **Numbers:**
     - Network math: a 500 KB value read 2,000 times/s is 1 GB/s from one shard, enough to saturate a typical node's network. A near-cache with a 2-second TTL across 50 instances cuts that to about 25 reads/s.
     - Compression: JSON often compresses several times over with fast codecs, trading a little CPU for memory and bandwidth.
   - **Pitfalls:**
     - Assuming consistent hashing spreads load; it spreads keys, not traffic to one key.
     - Storing multi-megabyte objects in Redis and blocking the event loop.
     - Near-caches with long TTLs, serving stale data for minutes.
     - Large values evicting many small hot ones under memory pressure.
   - **Follow-ups:**
     - _How do you update a replicated hot key consistently?_ Write all replicas (or bump a version used in the key) and rely on short TTLs to cover any copy that missed the update.
     - _How do you find big keys in Redis?_ Use sampling tools such as redis-cli --bigkeys or memory usage commands, and enforce size limits in the client library.
     - _When is a near-cache dangerous?_ For data that must be consistent across instances, such as permissions just revoked. Keep TTLs very short or invalidate via events.
   - **Example:** During a flash sale one product key took 40% of all cache traffic and saturated a shard. A 1-second near-cache in each API instance dropped that shard's load by 95%; product detail objects were also split so the sale page fetched a 4 KB summary instead of a 300 KB document.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/); [Redis documentation: Client-side caching](https://redis.io/docs/latest/develop/reference/client-side-caching/)
35. **How do I measure whether a cache is actually helping?** [ref · Fundamental · Caching, Observability]
   - **Trap:** "The hit ratio is 95%, so it's working." — _Why it fails:_ A high hit ratio on reads that were already fast saves almost nothing. Value is latency or origin load saved per unit of cost and complexity. — _Probing:_ Do you measure outcomes, not just the cache's own metrics? — _Say:_ "Expected latency is hit ratio × hit latency plus miss ratio × miss latency, compared with no cache, plus origin load saved. A bypass experiment gives the true counterfactual."
   - **Thesis:** A cache helps if it reduces user latency or origin cost enough to justify its cost and complexity. Measure hit ratio by key class, latency with and without hits, origin load saved, evictions, and cost per hit. A high hit ratio on cheap reads can still be pointless.
   - **60-second answer:** I'd measure outcomes, not just hit ratio. Per key class, record hit ratio and the latency of hits versus misses, which tells you the latency saved per hit. Compare origin load, database queries or CPU, against what it would be without the cache, which you can estimate from misses plus hits that would have gone through. Track eviction rate and memory usage: high evictions with a low hit ratio means the cache is too small or the access pattern has a long tail. Then cost: cache cluster cost versus database capacity saved. And complexity cost: staleness bugs and invalidation code. Sometimes the answer is that the cache isn't helping: the query was already fast, or the keys are too diverse to ever hit. A clean experiment is to bypass the cache for a small percentage of traffic and compare latency and origin load directly.
   - **Key points:**
     1. **Hit ratio per key class.** An overall hit ratio hides that some key classes hit 99% and others 5%. Break it down by key prefix or data type.
     2. **Latency saved.** Measure p50 and p99 for hits and misses. If misses take 3 ms and hits 1 ms, the cache saves little; if misses take 300 ms, it matters a lot.
     3. **Origin load saved.** Database queries or CPU avoided. This is often the real value: the database can be smaller or survive peaks.
     4. **Evictions and memory.** High eviction rates with low hit ratio suggest the cache is too small or caching the wrong things. Look at time-to-eviction versus time-to-reuse.
     5. **Cost per hit.** Cache infrastructure cost divided by hits, compared with the cost of serving those reads from the origin.
     6. **Bypass experiment.** Route a small percentage of requests around the cache and compare user latency and origin load. It gives a direct counterfactual.
     7. **Complexity and correctness cost.** Count staleness incidents and invalidation code. A cache that saves little but causes bugs should go.
   - **When to choose what:** Keep caches that measurably reduce user latency or origin capacity needs. Remove or shrink caches for already-fast queries or key classes with persistently low hit ratios.
   - **Numbers:**
     - Expected latency = hit ratio × hit latency + (1 − hit ratio) × miss latency. At 90% hits, 1 ms hits and 50 ms misses: 0.9 + 5 = 5.9 ms average, versus 50 ms without the cache.
     - With 3 ms misses, the same 90% hit ratio gives 1.2 ms vs 3 ms: probably not worth a cluster.
   - **Pitfalls:**
     - Celebrating a 95% hit ratio on data that was cheap to fetch anyway.
     - Measuring only average latency and missing that misses dominate p99.
     - Ignoring evictions caused by a few large values.
     - Keeping a cache because removing it feels risky, without data.
   - **Follow-ups:**
     - _Hit ratio dropped from 90% to 60% overnight. What do you check?_ A deploy that changed key construction, a new traffic pattern (crawler, new feature), memory pressure causing evictions, or a cache node failure that remapped keys.
     - _How do you size a cache?_ From the working set: measure how many distinct keys are reused within the TTL and their size; plot hit ratio against cache size using a replay or simulation of access logs.
     - _Should every service have a cache?_ No. Add one when measurements show expensive repeated reads; otherwise it's extra failure modes for little gain.
   - **Example:** A team found their Redis cache for user settings had a 97% hit ratio, but the database query took 1.5 ms at p99 and the cache hit 0.8 ms. They removed the cache, deleted the invalidation code and saw no change in user latency.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/)
36. **Your Redis cache cluster goes down at peak. What happens, and how should the system behave?** [mine · Intermediate · Caching, Reliability]
   - **Trap:** "We fall back to the database, so nothing breaks." — _Why it fails:_ If the cache was absorbing 90% of reads, the database suddenly gets 10x its normal load and falls over too. A cache you depend on for capacity isn't optional. — _Probing:_ Whether you treat the cache as load-bearing, and plan fallbacks, shedding and recovery. — _Say:_ "If the cache carries load the database can't, its loss is an outage unless I limit what falls through: concurrency caps on the database path, serving stale or degraded responses, shedding low-priority traffic, and warming before full recovery."
   - **Thesis:** A cache that absorbs most reads is load-bearing infrastructure. When it fails, uncontrolled fall-through can take down the database. Design the failure mode: replication for the cache, bounded fall-through, degraded responses, and careful recovery with warming.
   - **60-second answer:** First I'd ask what the cache is for. If it's only latency optimisation and the database can handle full load, falling back is fine. Usually it isn't: with a 90% hit ratio, losing the cache means ten times the database reads, at peak. So I'd design layers. Make the cache itself resilient: replicas with automatic failover, spread across zones, so a node loss isn't a cluster loss. Bound fall-through: a concurrency limit on database reads from the cache-miss path, request coalescing, and a small in-process cache for the hottest keys. Degrade: serve stale data from a local cache, hide expensive features, and shed low-priority traffic. For things like rate limiting or sessions stored in Redis, decide per feature whether to fail open (allow requests) or closed (reject), based on the risk. Recovery matters too: a cold cache causes a stampede, so warm hot keys and ramp traffic back gradually.
   - **Key points:**
     1. **Know whether the cache is load-bearing.** Compare database capacity with peak load at a 0% hit ratio. If it can't cope, the cache is part of your capacity plan.
     2. **Make the cache resilient.** Replication, automatic failover and multi-zone placement turn many failures into brief blips.
     3. **Bound the fall-through.** Concurrency limits and coalescing on the miss path so the database sees a capped load; excess requests get degraded responses.
     4. **Local near-cache as a buffer.** A small in-process cache of hot keys keeps the most popular reads working during a remote cache outage.
     5. **Fail open vs closed per feature.** Rate limiting might fail open with local limits; session validation might fail closed for sensitive actions. Decide in advance.
     6. **Recover carefully.** Warm hot keys before routing full traffic, and ramp gradually to avoid a stampede on a cold cache.
   - **When to choose what:** Treat high-hit-ratio caches as tier-one dependencies with replication and runbooks. Always bound database fall-through. Document fail-open or fail-closed behaviour for every feature that relies on the cache.
   - **Numbers:**
     - At 50,000 reads/s and a 90% hit ratio, the database normally sees 5,000 reads/s. With the cache down, it would see 50,000; if it can handle 12,000, the remaining 38,000/s must be coalesced, served stale or shed.
   - **Pitfalls:**
     - Assuming database fallback is safe without checking capacity.
     - No concurrency limit on the miss path.
     - Using Redis for both caching and critical state (sessions, locks, rate limits) with one undocumented failure mode.
     - Restoring a cold cache to full traffic instantly.
   - **Follow-ups:**
     - _Should rate limiting fail open or closed when Redis is down?_ Usually open with per-instance local limits, so you don't block all users; for abuse-prone endpoints like login, stricter local limits or fail closed.
     - _How do you test this?_ Game day: block access to the cache in staging and then briefly in production during low traffic, and watch database load and user metrics.
     - _What about cache data loss on failover?_ Treat the cache as disposable; anything that must survive belongs in a durable store.
   - **Example:** A retailer's Redis primary failed and replica promotion took 40 seconds. Database reads jumped 8x and the database stalled. Afterwards they added a 2-second in-process near-cache, a semaphore capping database reads from the miss path, and stale-on-error responses; the next failover passed with a small latency bump.
   - **Sources:** [AWS Builders' Library: Caching challenges and strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/); [Redis documentation: High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
37. **How do you size a cache and choose an eviction policy?** [mine · Intermediate · Caching, Scaling]
   - **Trap:** "Use LRU and make the cache as big as we can afford." — _Why it fails:_ LRU can be flushed by one-off scans, LFU suits stable popularity, and size should come from the working set and the hit-ratio curve, not from budget. — _Probing:_ Working set analysis, eviction trade-offs, and what eviction metrics tell you. — _Say:_ "I size from the working set and the hit-ratio curve from access logs, pick LRU for recency-driven access or LFU when popularity is stable, and watch eviction rate against hit ratio to see if the cache is too small or caching the wrong things."
   - **Thesis:** Size a cache to hold the working set (the keys reused within their useful lifetime), using the hit-ratio curve to find diminishing returns. Choose eviction by access pattern: LRU for recency, LFU for stable popularity, TTL for freshness, and protect against scans polluting the cache.
   - **60-second answer:** The working set is the set of keys that get reused before they'd expire anyway. I'd estimate it from access logs: replay them through cache simulations at different sizes and plot hit ratio against size. The curve usually flattens, and the knee is the economic size. Eviction policy depends on access shape. LRU evicts the least recently used key, good for recency-driven workloads like sessions and recently viewed items, but a big batch job scanning many keys once can push out the hot set. LFU evicts the least frequently used, good when popularity is stable, like a product catalogue, but slow to adapt when popularity shifts. Modern approximations, like Redis's approximated LRU and LFU with decay, or TinyLFU-style admission in Caffeine, handle both better. TTLs bound staleness regardless of eviction. Then monitor: high eviction plus low hit ratio means too small or wrong things cached; low evictions and a flat hit ratio mean you may be oversized.
   - **Key points:**
     1. **Working set, not total data.** Only keys reused within their TTL matter. A billion items with a 5% hot set needs a cache sized for the hot set.
     2. **Hit-ratio curve.** Simulate cache sizes against real access logs; choose the size where extra memory adds little hit ratio.
     3. **LRU.** Recency-based; simple and good for most workloads; vulnerable to large one-time scans.
     4. **LFU.** Frequency-based; keeps consistently popular items; needs decay so old popularity doesn't stick forever.
     5. **Admission policies.** Only admit items likely to be reused (TinyLFU, second-hit admission) to keep scans from polluting the cache.
     6. **TTL is orthogonal.** TTL controls staleness; eviction controls memory pressure. Most caches need both.
     7. **Watch the right metrics.** Hit ratio by key class, eviction rate, memory usage, and object size distribution.
   - **When to choose what:** Start with LRU or an approximate LRU/LFU hybrid; switch to LFU or add admission control if scans or a stable popular set dominate. Size from the hit-ratio curve, revisited as traffic changes.
   - **Numbers:**
     - Example: 200 million product keys, but 90% of reads hit 4 million of them. At 2 KB each, 8 GB holds the hot set; doubling to 16 GB might add only a couple of percentage points of hit ratio.
   - **Pitfalls:**
     - Sizing by budget rather than working set.
     - LRU caches flushed by nightly batch jobs reading every key.
     - Ignoring object size, so a few large values evict many small hot ones.
     - No eviction metrics, so problems look like random latency spikes.
   - **Follow-ups:**
     - _A nightly export job tanks the morning hit ratio. Why?_ It scans many cold keys and LRU evicts the hot set. Bypass the cache for batch reads or use an admission policy.
     - _How does Redis evict?_ Configurable maxmemory policies (allkeys-lru, allkeys-lfu, volatile-ttl and others), using approximations by sampling keys.
     - _How do you handle very uneven object sizes?_ Separate caches or namespaces for large objects, size caps, or size-aware eviction.
   - **Example:** A recommendations cache sized at 64 GB had a 71% hit ratio. Replaying a week of logs showed the hot set fitted in 24 GB; switching to allkeys-lfu and bypassing the cache for batch scoring raised the hit ratio to 88% at 32 GB.
   - **Sources:** [Redis documentation: Key eviction](https://redis.io/docs/latest/develop/reference/eviction/); [Einziger, Friedman, Manes: TinyLFU, a highly efficient cache admission policy](https://arxiv.org/abs/1512.00727)

### Pagination
38. **How do I design pagination for massive datasets efficiently?** [ref · Intermediate · Databases, Scaling]
   - **Trap:** "LIMIT and OFFSET with page numbers." — _Why it fails:_ OFFSET reads and discards every row before the page, so deep pages get slow, and concurrent inserts shift rows between pages. — _Probing:_ Keyset pagination, stable sort with a tiebreaker, opaque cursors. — _Say:_ "Keyset pagination on (sort_key, id) with an opaque cursor. Every page costs the same, and there are no duplicates as data changes."
   - **Thesis:** Use keyset (cursor) pagination: sort by a stable, indexed key with a unique tiebreaker and fetch rows after the last one seen. Offset pagination gets slower with every page and shifts when data changes. Bound page size and decide how results behave as data changes underneath.
   - **60-second answer:** Offset pagination, LIMIT 50 OFFSET 100000, makes the database read and discard a hundred thousand rows to return fifty, so deep pages get slow, and if rows are inserted or deleted while a user pages, they see duplicates or miss items. Keyset pagination fixes both: order by an indexed column plus a unique tiebreaker, like (created_at, id), and ask for rows where (created_at, id) is less than the last row of the previous page, limit 50. Each page is an index range scan of fifty rows regardless of depth. I'd return an opaque cursor encoding the last key and the sort, so clients can't construct arbitrary positions and the server can change the encoding. Page size is capped. The trade-offs: no jumping to page 237, and total counts are expensive, so show approximate counts or 'more results' instead. For search engines, use their search-after or scroll mechanisms rather than deep from/size.
   - **Key points:**
     1. **Why offset hurts.** OFFSET N reads and discards N rows, so cost grows linearly with depth. Concurrent inserts and deletes shift rows between pages, causing duplicates or skips.
     2. **Keyset pagination.** WHERE (sort_key, id) < (:last_sort, :last_id) ORDER BY sort_key DESC, id DESC LIMIT :n. Uses the index directly; every page costs about the same.
     3. **Stable sort with a tiebreaker.** The sort must be deterministic: add the primary key as a tiebreaker so rows with equal sort values don't flip between pages.
     4. **Opaque cursors.** Encode the last key (and filters) into a signed or encoded token. Clients pass it back; the server can change the format without breaking them.
     5. **Bounded page size.** Cap the limit (for example 100) to protect the database and response size.
     6. **Counts and jumping.** Exact totals over huge filtered sets are expensive; use estimates, cached counts, or 'load more'. Arbitrary page jumps aren't supported; offer filters and search instead.
     7. **Changing data.** Keyset pagination naturally shows new items only at the start; items edited to move in the sort order may appear twice or be skipped. Snapshot reads are an option if exact consistency matters.
   - **When to choose what:** Keyset pagination for any large or growing dataset and all APIs. Offset only for small, bounded result sets or admin tools where deep pages are rare. Search engines: search_after with a point-in-time view for deep result sets.
   - **Numbers:**
     - Depth cost: page 2,000 at 50 per page with OFFSET reads about 100,000 rows; keyset reads about 50 rows via the index for any page.
   - **Pitfalls:**
     - Sorting by a non-unique column without a tiebreaker.
     - No index matching the sort and filter columns, so keyset pagination still scans.
     - Exposing raw keys as cursors and letting clients craft them.
     - Computing COUNT(*) over millions of rows on every page request.
   - **Follow-ups:**
     - _How do you support both forward and backward paging?_ Store both first and last keys in the cursor and flip the comparison and sort direction for previous pages, then reverse the results.
     - _What if the user changes filters or sort?_ The cursor encodes them; a mismatch invalidates the cursor and the client starts from the first page.
     - _How do you export all rows of a huge table?_ Keyset iteration by primary key in batches, ideally from a replica or snapshot, not offset paging through an API.
   - **Example:** A transactions API switched from offset to keyset pagination on (posted_at, id). Page latency at depth 10,000 went from 4 seconds to 15 ms, and clients stopped seeing duplicate transactions while new ones arrived.
   - **Sources:** [Markus Winand: No offset (keyset pagination)](https://use-the-index-luke.com/no-offset); [Elasticsearch documentation: Paginate search results](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)

## Consistency & Transactions (15)

### Idempotency
39. **Build idempotency for a write API that clients and your own gateway can both retry.** [mine + ref · Advanced · Consistency, APIs, Databases]
   - **Trap:** "Have the gateway generate an idempotency key and dedupe in Redis." — _Why it fails:_ Gateway-generated keys are new on every retry, so nothing is deduplicated. A Redis check that isn't in the same transaction as the write leaves a window where a crash double-applies the effect. — _Probing:_ Client-owned keys, an atomic claim together with the effect, and the in-flight duplicate case. — _Say:_ "The client mints one key per logical operation; the server claims it in the same transaction as the write, replays the stored result, and returns 409 for a duplicate that's still in flight."
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
40. **Where is eventual consistency acceptable in a payments flow, and where is it never acceptable?** [mine + ref · Fundamental · Consistency, Transactions, Databases]
   - **Trap:** "Payments need strong consistency everywhere" or "we're eventually consistent." — _Why it fails:_ Blanket answers ignore that only the money decision and ledger posting need strong guarantees, while notifications and feeds can lag. Strong consistency everywhere hurts availability for no gain. — _Probing:_ Do you start from invariants and spot the dangerous middle: decisions made from stale reads? — _Say:_ "Strong where money is decided and posted; eventual for projections, with the rule that no money decision ever reads a lagging view."
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
41. **Give users read-your-writes when reads are served from replicas.** [mine + ref · Intermediate · Databases, Consistency]
   - **Trap:** "Send all reads to the primary." — _Why it fails:_ That throws away the replicas to solve a problem that only affects the user who just wrote. — _Probing:_ Scoping the guarantee to the session: a sticky window or replication position tokens. — _Say:_ "Only the writer needs it, so either route their reads to the primary for a window above p99 lag, or carry a log position and read only from replicas that have caught up."
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
42. **How do I model consistency levels across services and data stores?** [ref · Intermediate · Consistency]
   - **Trap:** One consistency level for the whole system. — _Why it fails:_ Different data has different invariants. A single setting is wrong for half of it and couples services unnecessarily. — _Probing:_ Classifying data, one owner per strong invariant, and documenting guarantees at boundaries. — _Say:_ "Per data class: strong for money and uniqueness inside one owner, session guarantees for user-facing state, eventual with a stated lag for projections."
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
43. **How do I reason about CAP trade-offs for a given product requirement?** [ref · Intermediate · Consistency, Reliability]
   - **Trap:** "We chose AP" (or CP) for the system, or "pick two of three." — _Why it fails:_ Partitions aren't optional, so CAP is about what each operation does during one. The everyday trade-off is latency against consistency. — _Probing:_ Per-operation reasoning, PACELC, and the reconciliation story behind any choice of availability. — _Say:_ "During a partition, booking the last seat refuses; adding to a cart proceeds and merges later. Without a partition I'm trading write latency for consistency."
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
44. **Replace a two-phase commit across three services.** [mine + ref · Advanced · Transactions, Messaging]
   - **Trap:** "Use a saga" with nothing else, or "publish an event after committing." — _Why it fails:_ Publishing after commit is a dual write that loses events on a crash. Naming sagas without compensations, idempotency and the loss of isolation misses the hard parts. — _Probing:_ Outbox, idempotent consumers, compensations, putting irreversible steps last, and the isolation cost. — _Say:_ "Local transactions with an outbox, idempotent steps, a compensation per step, irreversible steps last, explicit pending states, and an orchestrator once there are three or more steps."
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
45. **How do I design an outbox and inbox pattern for reliable events?** [ref · Advanced · Transactions, Messaging]
   - **Trap:** "Publish to Kafka inside the database transaction." — _Why it fails:_ The broker isn't part of the transaction. The publish can succeed and the transaction roll back, or the reverse. — _Probing:_ Writing the event to an outbox table in the same transaction, a relay, and inbox dedupe on the consumer. — _Say:_ "State change and outbox row in one transaction, a relay (poller or CDC) to publish, and the consumer records the event id in its own transaction to dedupe."
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
46. **How do I reconcile divergent data across systems?** [ref · Intermediate · Transactions]
   - **Trap:** "With proper event-driven design they won't diverge." — _Why it fails:_ Bugs, missed webhooks and partial failures guarantee drift. Pretending otherwise means discovering it from customers. — _Probing:_ A source of truth per field, matching on stable ids, classifying differences and measuring drift. — _Say:_ "I'd assume drift: define the source of truth per field, reconcile on shared ids with a grace window, auto-repair the safe classes, and alert on drift rate."
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
47. **Generate unique IDs across regions without a central counter.** [mine + ref · Intermediate · Consistency, Databases]
   - **Trap:** "Use auto-increment" or "UUIDv4 everywhere." — _Why it fails:_ Auto-increment needs a central counter (a round trip and a single point of failure). Random UUIDv4 scatters inserts across the B-tree and hurts write performance at scale. — _Probing:_ Time-ordered, locally generated ids and how to handle clock skew. — _Say:_ "UUIDv7 by default: no coordination, time-prefixed for index locality. Snowflake-style if I need 64-bit integers, with leased worker ids."
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
48. **Where do Raft, Paxos, quorums and gossip appear in a system you would really build?** [mine + ref · Intermediate · Consistency, Reliability]
   - **Trap:** Explaining how Raft elects a leader in detail, or proposing to implement consensus. — _Why it fails:_ The question asks where these protocols sit in a real system. Reimplementing consensus is a red flag; placement and costs are what matter. — _Probing:_ Consensus for small critical metadata, quorums for data, gossip for membership, fencing for locks. — _Say:_ "I'd use etcd or ZooKeeper for leader election and config, with fencing tokens on leases; quorum or single-leader replication for data; gossip only for membership."
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

### Locks & clocks
49. **You need a distributed lock so only one worker processes a job. How do you make it actually safe?** [mine · Advanced · Consistency, Reliability]
   - **Trap:** "Use Redis SET NX with a TTL" (or Redlock) as the whole answer. — _Why it fails:_ A lock holder can pause (GC, network, VM migration) past the TTL; another worker takes the lock, and the first one wakes up and writes anyway. A lease alone can't prevent two writers. — _Probing:_ Whether you know about process pauses, leases and fencing tokens checked by the resource. — _Say:_ "A lease from a consensus-backed store plus a fencing token: every write carries the token, and the storage rejects tokens older than the latest it has seen. Where possible, I'd make the work idempotent so a duplicate is harmless."
   - **Thesis:** A distributed lock is only as safe as what happens when the holder stalls. Leases expire, so two processes can believe they hold the lock. Safety comes from fencing tokens that the protected resource checks, or from making the operation idempotent so duplicates don't matter.
   - **60-second answer:** First I'd ask whether I need a lock for correctness or just for efficiency. If two workers occasionally doing the same job is merely wasteful, a simple Redis lock with a TTL is fine. If it's a correctness issue, like two workers charging a customer, a lease isn't enough: the holder can pause for longer than the TTL, the lock expires, a second worker acquires it, and then the first resumes and writes. The fix is fencing: the lock service issues a monotonically increasing token with each acquisition, the worker passes it with every write, and the storage rejects writes carrying a token lower than one it has already accepted. That needs a lock service with strong consistency, such as etcd or ZooKeeper, whose revision numbers work as tokens, and a resource that can check them. Even better, design the work to be idempotent or use conditional writes so correctness doesn't depend on the lock at all.
   - **Key points:**
     1. **Efficiency lock vs correctness lock.** If occasional double execution is just wasted work, a best-effort lock is fine. If it corrupts data or moves money twice, you need fencing or idempotency.
     2. **Leases expire while you're paused.** GC pauses, CPU starvation, network delays and VM suspension can exceed any TTL. The holder doesn't know it lost the lock.
     3. **Fencing tokens.** Each lock grant has a strictly increasing number; the resource records the highest seen and rejects older ones. This makes a stale holder's writes harmless.
     4. **Use a consensus-backed lock service.** etcd, ZooKeeper or Consul provide linearizable leases and revision numbers. A single Redis instance or Redlock across independent nodes doesn't provide fencing tokens.
     5. **The resource must cooperate.** Fencing only works if the storage checks the token, for example a conditional write WHERE fence_token < :token.
     6. **Prefer idempotency or conditional writes.** If the operation itself is idempotent or guarded by a version check, a duplicate worker is safe and the lock becomes an optimisation.
   - **When to choose what:** Best-effort Redis lock for efficiency only. Consensus-backed lease plus fencing token for correctness. Best of all: idempotent operations and conditional writes so locks aren't the only safety net.
   - **Numbers:**
     - Pause intuition: stop-the-world GC pauses of seconds have been observed in large JVM heaps, longer than many lock TTLs.
   - **Pitfalls:**
     - Assuming a TTL lock prevents concurrent execution under pauses.
     - Relying on Redlock for correctness-critical mutual exclusion.
     - Fencing tokens issued but never checked by storage.
     - Holding locks across slow external calls, making expiry more likely.
   - **Follow-ups:**
     - _What if the storage can't check fencing tokens, like a third-party API?_ Use the third party's idempotency keys, or record intent locally and reconcile; the lock alone can't make it safe.
     - _How do you choose the lease TTL?_ Longer than normal work time plus heartbeat margin, with the holder renewing periodically; but correctness must not depend on it.
     - _How does leader election relate?_ It's the same problem: a leader lease plus an epoch number, with followers or storage rejecting requests from older epochs.
   - **Example:** A payout worker used a Redis lock with a 30-second TTL. A 45-second GC pause let a second worker run the same payout batch. The fix used etcd leases with the lease revision as a fencing token stored on each payout row, plus provider idempotency keys per payout.
   - **Sources:** [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html); [etcd documentation: Leases and concurrency](https://etcd.io/docs/v3.5/learning/api/)
50. **Can you use timestamps to order events or resolve conflicts across machines?** [mine · Advanced · Consistency, Reliability]
   - **Trap:** "Each write gets a timestamp; the latest one wins." — _Why it fails:_ Clocks on different machines drift and jump. Last-writer-wins by wall-clock time can let an earlier write overwrite a later one and silently discard data. — _Probing:_ Clock skew, logical clocks, and when you need a single sequencer instead. — _Say:_ "Wall clocks are fine for display and rough ordering, not for correctness. For ordering I'd use a single sequencer per key or logical clocks; for conflicts, version vectors or merge rules rather than last-writer-wins."
   - **Thesis:** Physical clocks across machines are never perfectly in sync, so timestamps can't be trusted to order events or decide which write is newer. Use a single source of order (a sequencer or leader per key), logical clocks (Lamport, vector or hybrid logical clocks), or merges that don't depend on time.
   - **60-second answer:** NTP keeps clocks close, typically within milliseconds, but not exact, and clocks can jump when corrected or during leap seconds and VM pauses. So two events 2 ms apart on different machines can be stamped in the wrong order, and last-writer-wins will keep the wrong one, silently. For ordering events per entity, I'd route writes through one owner, a leader or partition, that assigns sequence numbers. For causality across nodes, Lamport clocks give an order consistent with causality, and vector clocks detect truly concurrent updates so you can merge them. Hybrid logical clocks combine physical time with a logical counter, used by databases like CockroachDB. Spanner uses tightly bounded clock uncertainty with specialised hardware and waits out the uncertainty, which isn't something to assume in ordinary infrastructure. Timestamps remain useful for display, TTLs and rough analytics, just not for deciding which write wins.
   - **Key points:**
     1. **Clock skew and jumps are normal.** NTP-synchronised clocks still differ by milliseconds or more, and can step backwards on correction. Monotonic clocks help within one machine only.
     2. **Last-writer-wins loses data.** If timestamps are wrong, LWW keeps the older value. Even with correct clocks, LWW discards concurrent updates rather than merging them.
     3. **Single sequencer per key.** The simplest correct ordering: one leader or partition owner assigns increasing sequence numbers for its keys.
     4. **Lamport and vector clocks.** Lamport clocks order events consistently with causality; vector clocks also reveal concurrency so conflicts can be detected and merged.
     5. **Hybrid logical clocks.** Combine physical time with a logical counter to stay close to wall time while preserving causality; common in distributed databases.
     6. **Where timestamps are fine.** Display, approximate analytics, TTLs and log correlation, with awareness of skew.
   - **When to choose what:** Order per entity through a single owner. Detect concurrency with version vectors where multiple writers exist. Use LWW only for data where losing a concurrent update is acceptable (caches, presence, last-seen).
   - **Numbers:**
     - Typical NTP sync within a data centre is around a millisecond or better; across the internet it's often tens of milliseconds, and much worse during faults.
   - **Pitfalls:**
     - Sorting events from many services by their local timestamps and treating it as truth.
     - LWW in multi-region replication for important data.
     - Using wall time for lease expiry across machines.
     - Assuming cloud clocks never jump.
   - **Follow-ups:**
     - _How does Spanner get away with timestamps?_ TrueTime exposes bounded uncertainty using GPS and atomic clocks, and commits wait out that uncertainty. Without such bounds, the approach isn't safe.
     - _How do you order events from many producers into one stream?_ Assign order at a single point (the broker partition or a sequencer), or carry per-producer sequence numbers and accept only partial order.
     - _When is LWW acceptable?_ When the data is a cache or 'latest status' where losing a concurrent update is harmless, like presence or last-seen time.
   - **Example:** A multi-region profile store used LWW by server timestamp. A clock 300 ms fast in one region caused older updates from there to overwrite newer ones from another. Moving to a home-region writer per user eliminated the conflicts.
   - **Sources:** [Leslie Lamport: Time, clocks, and the ordering of events in a distributed system](https://lamport.azurewebsites.net/pubs/time-clocks.pdf); [Martin Kleppmann: Designing Data-Intensive Applications, chapter 8 (unreliable clocks)](https://dataintensive.net/)

### Money & inventory correctness
51. **A flash sale has 1,000 units and 500,000 people trying to buy at once. How do you never oversell?** [mine · Advanced · Consistency, Scaling]
   - **Trap:** "Check stock, then decrement it" (or "cache the stock count in Redis and decrement it"). — _Why it fails:_ Check-then-act races oversell under concurrency, and a cache-only counter can lose decrements on failover or drift from the database. — _Probing:_ Atomic reservation, a single source of truth for stock, reservation expiry, and protecting the system from the spike. — _Say:_ "Stock is decremented atomically with a conditional update or token-based reservation, reservations expire if unpaid, and a queue or waiting room in front keeps the spike from overwhelming the database."
   - **Thesis:** Overselling is a concurrency bug; the spike is a load problem. Solve the first with atomic reservations against a single source of truth with expiring holds, and the second with admission control, a waiting room, and moving the hot counter off the main database path.
   - **60-second answer:** Correctness first: the decrement must be atomic, for example UPDATE inventory SET available = available - 1 WHERE sku = :sku AND available > 0, checking the affected rows, or pre-generating 1,000 reservation tokens and letting each buyer claim one atomically. A successful claim creates a time-limited hold; if payment doesn't complete in, say, 10 minutes, the hold expires and the unit returns to stock. Load second: 500,000 people hitting one row will serialise on that row and overload everything around it. So I'd put a waiting room or queue in front to admit buyers at a rate the system handles, shard the counter into buckets (for example 10 buckets of 100 units) or keep the counter in an atomic in-memory store with durable logging, and serve the product page from cache. Orders are confirmed only when payment completes, and a reconciliation job checks holds, orders and stock agree.
   - **Key points:**
     1. **Atomic decrement or token claim.** A conditional update on the stock row, or claiming one of N pre-created tokens, so two buyers can never take the same unit.
     2. **Holds with expiry.** Reserve on 'buy', confirm on payment, release on timeout. Without expiry, abandoned carts lock stock forever.
     3. **Single source of truth.** One authoritative stock record or token pool. Caches may display availability but never decide it.
     4. **Waiting room and admission control.** Admit users at a controlled rate, give them a queue position, and reject or defer the rest gracefully.
     5. **Shard the hot counter.** Split stock across N buckets so updates spread across rows or keys; a buyer tries a random bucket, then others.
     6. **Protect everything else.** Cache the product page, isolate the sale path from regular traffic, and rate-limit per user and per device.
     7. **Reconcile.** Compare holds, orders and stock after the sale to catch bugs, and fix with clear customer communication.
   - **When to choose what:** Atomic reservation with expiring holds for correctness, always. Add waiting rooms and counter sharding as scale requires. Deliberate overselling (with compensation) is a business decision, not an accident.
   - **Numbers:**
     - A single hot row taking 2 ms per update serialises to about 500 updates per second; 10 buckets raise the ceiling to roughly 5,000 per second.
     - 1,000 units with a 10-minute payment hold: if 30% abandon, those units return to stock within 10 minutes.
   - **Pitfalls:**
     - Check-then-decrement in application code.
     - Redis-only counters with no durable record or reconciliation.
     - Holds that never expire.
     - Letting the spike hit the main database and taking down unrelated features.
   - **Follow-ups:**
     - _How do you make the waiting room fair?_ Randomise positions among users who arrived before the start, then serve in order; tie queue tokens to verified accounts to stop bots.
     - _What if payment succeeds just after the hold expired and the unit was resold?_ Detect it at confirmation (hold no longer valid), refund automatically, and notify the customer; keep a small buffer if the business prefers to honour such orders.
     - _How do you handle bots?_ Per-account and per-device limits, bot detection, verified accounts for the sale, and purchase limits per customer.
   - **Example:** A sneaker drop pre-created 2,000 reservation tokens in a sharded table. A waiting room admitted 3,000 users per minute; each claimed a token atomically and had 8 minutes to pay. The sale sold out in 14 minutes with zero oversells, and unpaid holds returned 240 units to the pool.
   - **Sources:** [PostgreSQL documentation: UPDATE](https://www.postgresql.org/docs/current/sql-update.html); [AWS Builders' Library: Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/)
52. **Design a ledger for a payments or lending product. Why double-entry, and what invariants must it enforce?** [mine · Advanced · Transactions, Databases]
   - **Trap:** "A balance column on the account table that we update on each transaction." — _Why it fails:_ A mutable balance has no history, can't be audited, drifts from reality with every bug, and can't explain where money went. Updates can also race. — _Probing:_ Immutable entries, balanced transactions, derived balances, and idempotent posting. — _Say:_ "An append-only ledger of journal entries where every transaction's debits equal its credits; balances are derived (and cached with care); corrections are new reversing entries, never edits."
   - **Thesis:** A ledger records every movement of money as immutable, balanced journal entries: each transaction has entries that sum to zero across accounts. Balances are derived from entries, corrections are reversing entries, and posting is idempotent. This gives auditability and makes errors detectable.
   - **60-second answer:** I'd model accounts (customer wallet, loan principal, interest receivable, cash at bank, fees revenue) and journal transactions, each with two or more entries, debits and credits, that must sum to zero, enforced at write time. Entries are append-only: no updates or deletes. A mistake is fixed with a reversing transaction plus a correct one, so history explains itself. Balances are the sum of entries per account; for performance I'd keep a running balance updated in the same transaction as the entries, with a per-account lock or version to prevent races, and periodically verify it against the sum. Every posting carries an idempotency key from the business event, such as the payment id, so a retry can't double-post. Amounts are integers in minor units with an explicit currency, and multi-currency movements go through FX accounts. Finally, daily reconciliation against bank and provider statements, and trial balances that must net to zero.
   - **Key points:**
     1. **Balanced transactions.** Every transaction's entries sum to zero. A transaction that doesn't balance is rejected at write time.
     2. **Append-only entries.** No updates or deletes. Corrections are reversing entries, preserving a complete audit trail.
     3. **Derived balances.** Balance = sum of entries. A cached running balance must update in the same transaction as the entries and be verified against the sum.
     4. **Idempotent posting.** Each business event posts once, keyed by a stable id; retries return the existing transaction.
     5. **Integer minor units and currencies.** Store cents as integers with a currency code; never floats. Cross-currency postings use FX accounts with recorded rates.
     6. **Concurrency per account.** Serialise postings that touch the same account's balance check (row lock, conditional update) to enforce limits like non-negative balances.
     7. **Reconciliation and trial balance.** Daily checks against external statements, and system-wide sums that must net to zero.
   - **When to choose what:** Use a double-entry, append-only ledger for anything that holds or moves money. Keep it as its own component with a narrow API (post transaction, read balances and history), separate from product logic.
   - **Numbers:**
     - Integer minor units: an int64 holds amounts up to about 9.2 × 10^18 minor units, far beyond any realistic balance.
   - **Pitfalls:**
     - Mutable balances without entries.
     - Floats for money.
     - Editing or deleting entries to fix mistakes.
     - Posting without idempotency, so retries double-post.
   - **Follow-ups:**
     - _How do you get fast balance reads at scale?_ A running balance maintained transactionally with entries, plus periodic snapshots per account so verification sums only entries since the last snapshot.
     - _How do you represent a pending card authorisation?_ As entries to a pending or holds account, reversed and replaced by final entries on capture or released on expiry.
     - _A bug posted 10,000 wrong entries. How do you fix it?_ Post reversing transactions for each (or a batch with references), then post the correct ones, all traceable to the incident.
   - **Example:** A loan repayment of 100.00 posts: debit cash-at-bank 100.00; credit loan-principal 85.00; credit interest-receivable 15.00. The three entries sum to zero, carry the payment id as the idempotency key, and the customer's loan balance is derived from the principal account's entries.
   - **Sources:** [Martin Fowler: Accounting patterns (Account, Entry, Posting rule)](https://martinfowler.com/eaaDev/AccountingNarrative.html); [Modern Treasury: Accounting for developers](https://www.moderntreasury.com/journal/accounting-for-developers-part-i)

### Event sourcing & CQRS
53. **When is event sourcing with CQRS the right call, and when is it a trap?** [mine · Advanced · Architecture, Messaging]
   - **Trap:** "Event source everything so we have a full audit trail and can replay." — _Why it fails:_ Event sourcing makes schema evolution, querying, privacy deletion and debugging much harder. An audit log or CDC gives most of the audit benefit at a fraction of the cost. — _Probing:_ Whether you can weigh the real costs: event versioning, projections, eventual consistency, GDPR, team skill. — _Say:_ "I'd use event sourcing only where the history itself is the domain (ledgers, workflows needing temporal queries); elsewhere, current-state storage plus an audit log or CDC gives auditability without the complexity."
   - **Thesis:** Event sourcing stores state as an append-only sequence of domain events and derives current state by replay; CQRS separates write models from read models. Together they fit domains where history is central. Applied broadly, they add heavy costs in versioning, projections, consistency and data deletion.
   - **60-second answer:** Event sourcing earns its keep when the history is the product: ledgers, case management, workflows where you need 'what did we know on date X', or systems built around auditability and temporal queries. CQRS is useful when read and write shapes differ a lot, so you build read projections optimised for queries. The costs are real. Events are a permanent schema: you can't change old events, so you need upcasting and versioning forever. Every query needs a projection, projections lag the write side, and rebuilding them from years of events takes time. Deleting personal data from an immutable log needs crypto-shredding or careful design. Debugging means understanding event streams, not rows. And teams new to it often model CRUD updates as events, getting all the cost and none of the benefit. For most services I'd keep current-state tables with an audit table or CDC stream, and reach for event sourcing only in the parts of the domain where it clearly pays.
   - **Key points:**
     1. **Where it fits.** Financial ledgers, order or case lifecycles with rich state transitions, systems needing temporal queries and full replay.
     2. **Events are a permanent contract.** Old events can't be changed; versioning, upcasting and tolerant readers are needed for the life of the system.
     3. **Projections and lag.** Reads come from projections built asynchronously. Users may not see their own writes immediately unless you design for it.
     4. **Rebuild cost.** Replaying years of events to rebuild a projection can take hours; snapshots help but add complexity.
     5. **Privacy and deletion.** Immutable logs conflict with erasure; keep personal data out of events or encrypt it per subject and destroy keys.
     6. **CQRS without event sourcing.** Separate read models (via CDC or outbox) give most query benefits while keeping a normal current-state write model.
     7. **Cheaper alternatives for audit.** Audit tables, CDC streams, or temporal tables in the database capture history without making it the source of truth.
   - **When to choose what:** Event sourcing for the specific aggregates where history and temporal reasoning are core. CQRS read models where query shapes diverge. Current state plus audit log or CDC everywhere else.
   - **Numbers:**
     - Replay time grows with history: an aggregate type with 2 billion events replayed at 50,000 events/s takes about 11 hours to rebuild a projection without snapshots.
   - **Pitfalls:**
     - Modelling CRUD as 'FieldUpdated' events.
     - No versioning strategy for event schemas.
     - Personal data stored in immutable events.
     - Every service event-sourced by default, multiplying complexity.
   - **Follow-ups:**
     - _How do you handle a user reading their own write with CQRS?_ Return the result from the write side, wait for the projection to reach the event's position, or read that aggregate directly from the event store.
     - _How do you change the meaning of an old event?_ You don't; add a new event type and upcast old ones into the new shape when reading, keeping both readable.
     - _Is an outbox the same as event sourcing?_ No. An outbox publishes events about state changes; the source of truth is still the current-state tables.
   - **Example:** A lending platform event-sourced only its loan servicing aggregate, where regulators ask what balance and interest were on a given date. Origination, customer profiles and documents stayed as normal tables with CDC into the warehouse, keeping most teams away from event-sourcing complexity.
   - **Sources:** [Martin Fowler: Event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html); [Martin Fowler: CQRS](https://martinfowler.com/bliki/CQRS.html)

## Reliability & Failure (9)

### Failure modes & degradation
54. **List the ways a three-tier service fails under real load before drawing any boxes.** [mine + ref · Fundamental · Reliability, Observability]
   - **Trap:** "Server crashes and database goes down." — _Why it fails:_ Clean crashes are the easy case. Real outages come from slowness, saturation, feedback loops like retries, and bad changes. — _Probing:_ Do you know that slow is worse than down, and how failures cascade? — _Say:_ "The dangerous ones are a slow dependency exhausting pools, retry amplification, unbounded queues, cache stampedes and bad deploys, so timeouts, bounded queues and safe rollouts come before redundancy."
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
55. **How do I design for graceful degradation instead of hard failure?** [ref · Fundamental · Reliability]
   - **Trap:** "Add fallbacks for everything." — _Why it fails:_ Fallbacks that are rarely exercised are often broken, and fallbacks that call other dependencies fail the same way. Without a ranking, you don't know what to sacrifice. — _Probing:_ Ranking features, decoupling the critical path, and testing degraded modes. — _Say:_ "Rank features with product, keep the critical path free of optional calls, prefer always-on fallbacks like serving from cache, and test the degraded modes."
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
56. **Retries are amplifying an outage. Design retries that do not.** [mine + ref · Intermediate · Reliability]
   - **Trap:** "Exponential backoff" as the complete answer. — _Why it fails:_ Backoff without jitter synchronises clients, and retries at every layer still multiply load (3 attempts across 5 layers is 243 calls). Backoff alone doesn't stop the amplification. — _Probing:_ Retrying at one layer, jitter, retry budgets, deadlines and idempotency. — _Say:_ "One retry layer, capped backoff with full jitter, a retry budget around 10%, deadline propagation, and retries only for idempotent operations."
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
57. **Choose and size circuit breakers, bulkheads and timeouts.** [mine + ref · Intermediate · Reliability]
   - **Trap:** "Add a circuit breaker" with default settings and a 30-second timeout. — _Why it fails:_ Without data-driven timeouts and per-dependency pools, a slow dependency still exhausts shared capacity before the breaker trips. — _Probing:_ Sizing from p99 and Little's law, minimum call counts, half-open probing. — _Say:_ "Timeout just above the dependency's healthy p99 and below my deadline, a bulkhead sized by throughput × latency, and a breaker on the failure or slow-call rate with a minimum volume."
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
58. **Fail over between two regions without split brain.** [mine + ref · Advanced · Reliability, Consistency]
   - **Trap:** "Health checks detect the failure and automatically promote the other region." — _Why it fails:_ With two regions, a broken link looks exactly like a dead peer, so both sides promote and you get split brain. Without fencing, the old primary keeps writing. — _Probing:_ A third-party witness or a manual decision, epochs and fencing, stated RPO and RTO. — _Say:_ "One writer per partition, ownership changed only through a quorum with a witness or by an operator, epoch fencing at the storage layer, and RPO roughly equal to replication lag."
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
59. **How do I design for data center outage scenarios?** [ref · Advanced · Reliability]
   - **Trap:** "Deploy across multiple zones and we're covered." — _Why it fails:_ Being in several zones doesn't help if each runs too hot to absorb a lost zone, if failover depends on control-plane actions, or if hidden dependencies sit in one region. — _Probing:_ N+1 capacity, static stability, tiered regional strategies, finding hidden dependencies. — _Say:_ "Each zone runs at most at (N−1)/N of capacity so losing one needs no scaling; regional strategy is tiered by business impact; and drills hunt for hidden single-region dependencies."
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
60. **Plan a rollback for a release that has already migrated data.** [mine + ref · Advanced · Migration, Reliability]
   - **Trap:** "Just redeploy the previous version." — _Why it fails:_ The old code may not be able to read data the new code wrote, so rollback itself breaks things. — _Probing:_ N and N-1 compatibility, expand and contract, flags for new write formats, and a rule for rolling back versus fixing forward. — _Say:_ "Every release must be readable by the previous version: schema changes separate from behaviour, new formats behind a flag, and a repair script for records written in the bad window."
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
61. **Define SLOs for a lending platform and derive alerts from the error budget.** [mine + ref · Advanced · Observability, Reliability]
   - **Trap:** SLOs on CPU or uptime, aiming for 99.99% (or 100%), and alerting when errors cross a threshold. — _Why it fails:_ Users don't feel CPU. 100% leaves no room for change. Static thresholds page on blips and miss slow burns. — _Probing:_ User-journey SLIs, error budgets, multi-window burn-rate alerts, and a policy that changes behaviour. — _Say:_ "SLIs on submission, decision time and disbursal; 99.9% over 28 days; page on a 14.4x burn over 1 hour and 5 minutes; a release freeze when the budget is gone."
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
62. **How do I make rebuild from scratch possible if everything is lost?** [ref · Advanced · Reliability, Databases]
   - **Trap:** "We have backups and replication." — _Why it fails:_ Replication copies corruption and deletions instantly. Backups in the same account can be deleted with the same credentials. Untested backups may not restore at all. — _Probing:_ Isolated immutable backups, restore drills, infrastructure as code, and the bootstrap order. — _Say:_ "Backups in an isolated account with retention locks, quarterly restore drills, everything in infrastructure as code, and a rehearsed bootstrap order with a measured RTO."
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
63. **Event-driven or request-response for order placement? Decide and defend it.** [mine + ref · Fundamental · Messaging, Architecture]
   - **Trap:** Picking one side: "fully event-driven" or "fully synchronous." — _Why it fails:_ Fully async leaves the customer unsure whether the order exists; fully sync chains fulfilment and email into checkout and makes it fragile. — _Probing:_ Splitting the synchronous decision from asynchronous side effects, published reliably. — _Say:_ "The order decision is synchronous and commits with an outbox event; fulfilment, email and loyalty consume that event idempotently."
   - **Thesis:** Both. The customer needs an answer now, so placing the order is a synchronous request that commits the order and returns its status. Everything that follows (fulfilment, notifications, loyalty points, analytics) reacts to an OrderPlaced event published reliably from that commit.
   - **60-second answer:** I'd make the order write synchronous: validate the cart, check price and stock, authorise payment if that's part of placement, commit the order, and return an order id and status in one request. The customer gets a definite answer, and errors like out-of-stock or a declined card show immediately. In the same transaction I'd write an OrderPlaced event to an outbox, and everything downstream consumes it: warehouse fulfilment, confirmation email, loyalty, fraud review, analytics. That keeps the user-facing path short and dependent on only the services needed for the decision, while downstream consumers can be slow, fail or be added later without touching checkout. Where something downstream can still change the order, like fraud review cancelling it, the order has explicit states and the customer is notified when it changes.
   - **Key points:**
     1. **The decision is synchronous.** The customer needs to know immediately whether the order went through. Validation, pricing, stock reservation and payment authorisation produce that answer.
     2. **Side effects are events.** Fulfilment, emails, loyalty, analytics and CRM don't affect the immediate answer. They subscribe to OrderPlaced and act independently.
     3. **Publish reliably with an outbox.** Write the order and the event in one transaction, then relay the event. Never commit the order and then hope the publish succeeds.
     4. **Minimise synchronous dependencies.** Every synchronous call on the order path adds latency and a way to fail. Keep only what's needed for the decision; use local data or cached reference data where possible.
     5. **Explicit order states.** Placed, paid, fulfilling, shipped, cancelled. Asynchronous steps move the order between states and the customer can see where it is.
     6. **Defend the trade-off.** Fully event-driven placement would mean the customer waits on a 'pending' screen for an unknown time. Fully synchronous would chain fulfilment and email into checkout and make it fragile.
   - **When to choose what:** Synchronous for the steps that decide the order's success; events for everything after. If a downstream step can reverse the order, model it as a state change with customer notification rather than making it synchronous.
   - **Numbers:**
     - Latency budget example: placement path under 1 second at p99, including payment authorisation; downstream processing within seconds to minutes depending on the consumer.
   - **Pitfalls:**
     - Calling fulfilment, email and loyalty synchronously during checkout.
     - Publishing the event outside the order transaction (dual write).
     - Going fully async and leaving the customer unsure whether the order exists.
     - Consumers that aren't idempotent, sending duplicate emails or double points on redelivery.
   - **Follow-ups:**
     - _What if stock reservation is in another service?_ Call it synchronously with a short timeout if the answer is needed before confirming, or accept the order optimistically and compensate (cancel and notify) if the reservation later fails. The business decides which experience is acceptable.
     - _How do you handle payment that takes several seconds?_ Authorise synchronously if it fits the budget; otherwise accept the order as 'payment pending', return quickly, and notify on completion.
     - _How do downstream teams get the data they need?_ The event carries the facts consumers commonly need (order id, items, amounts, customer id), with a versioned schema, so they don't call back into the order service for every event.
   - **Example:** Checkout reserves stock and authorises payment synchronously, commits the order with an outbox event, and returns 'Order placed' in 700 ms. The warehouse, email service and loyalty service each consume OrderPlaced; when the email provider is down for an hour, orders keep flowing and emails catch up.
   - **Sources:** [Martin Fowler: What do you mean by 'event-driven'?](https://martinfowler.com/articles/201701-event-driven.html); [microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
   - _Also asked as:_ When do I choose event-driven over request-response?

### Delivery semantics
64. **Exactly-once in practice: what do Kafka and Flink give you, and what do you still own?** [mine + ref · Advanced · Messaging]
   - **Trap:** "Kafka supports exactly-once, so we're covered end to end." — _Why it fails:_ Exactly-once covers Kafka topics and Flink state. Database writes, API calls and emails are repeated on replay unless they're idempotent. — _Probing:_ Processing vs delivery, transactions with read_committed, two-phase-commit sinks, and what you still own. — _Say:_ "Exactly-once processing inside Kafka and Flink; any external sink needs deterministic idempotency keys because replay will repeat it."
   - **Thesis:** Kafka and Flink give exactly-once processing within their boundary: idempotent producers, transactions and checkpointed state make each record's effect on Kafka topics and Flink state happen once. Side effects outside that boundary (databases, APIs, emails) are still your job: make them idempotent or transactional with the checkpoint.
   - **60-second answer:** Delivery over a network is at least once; what systems provide is exactly-once effect. Kafka's idempotent producer removes duplicates from producer retries per partition. Kafka transactions let a consume-transform-produce application atomically write output records and commit its consumer offsets, so downstream consumers reading with read_committed isolation see each result once. Flink checkpoints its state and source offsets consistently; on failure it rewinds to the last checkpoint and reprocesses, and its two-phase-commit sinks, including the Kafka sink, commit output only when a checkpoint completes. What you still own: any sink that isn't transactional with Flink or Kafka, such as a database write, an HTTP call to a partner, or an email. On replay after failure those happen again, so they need idempotency keys or upserts keyed by a deterministic id. Also, consumers reading with read_uncommitted see aborted data, and exactly-once adds latency, because output becomes visible only at transaction or checkpoint commit.
   - **Key points:**
     1. **Be precise about the claim.** Exactly-once processing (effects applied once) not exactly-once delivery. Records may be read and processed more than once internally; the system makes the visible result as if once.
     2. **Kafka idempotent producer.** Producer id plus sequence numbers per partition let the broker discard duplicate writes from retries.
     3. **Kafka transactions.** Atomically write to multiple partitions and commit consumer offsets. Consumers with read_committed see only committed transactions.
     4. **Flink checkpoints.** Consistent snapshots of operator state and source positions. After a failure, the job restores state and replays input from the checkpointed offsets.
     5. **Two-phase-commit sinks.** Flink sinks that support it pre-commit output during a checkpoint and commit when the checkpoint completes. Output visibility is tied to checkpoint frequency.
     6. **What you still own.** External side effects: database writes, API calls, emails, payments. Make them idempotent (upsert by deterministic key, idempotency keys) because replay will repeat them.
     7. **Costs.** Latency equal to checkpoint or transaction interval for visible output, more coordination overhead, and careful configuration (isolation level, transaction timeouts).
   - **When to choose what:** Use Kafka transactions or Flink exactly-once for pipelines where Kafka-to-Kafka or Flink state correctness matters (aggregations, billing counts). For external sinks, rely on idempotent writes and treat the pipeline as at-least-once into them. If latency matters more than duplicates, at-least-once with idempotent consumers is simpler.
   - **Numbers:**
     - Visibility latency: with a 10-second checkpoint interval, transactional sink output appears in roughly 10-second steps; shortening the interval reduces latency but adds checkpoint overhead.
   - **Pitfalls:**
     - Claiming exactly-once end to end while the sink is a non-idempotent HTTP call.
     - Downstream consumers using read_uncommitted and seeing aborted records.
     - Transaction timeouts shorter than checkpoint intervals, causing aborted transactions and data loss or stalls.
     - Using random ids generated during processing as idempotency keys; replay generates new ids. Keys must be deterministic from input.
   - **Follow-ups:**
     - _How do you write exactly-once into Postgres from Flink?_ Either a two-phase-commit sink that commits the database transaction on checkpoint completion, or idempotent upserts keyed by a deterministic id derived from the input, which is simpler and usually enough.
     - _Does Kafka exactly-once cover consumers in other services?_ Only if they participate in the transaction or dedupe themselves. A normal consumer that writes to its own database must be idempotent.
     - _What about sending emails from a stream?_ Emails can't be undone, so dedupe before sending: record the deterministic message id in a store and send with a provider idempotency key; accept a small risk window or confirm via provider status.
   - **Example:** A billing pipeline aggregates usage events in Flink with exactly-once checkpoints and writes invoice line items into Kafka transactionally. The invoicing service consumes with read_committed and upserts line items by (customer, period, meter) so a replay never double-bills.
   - **Sources:** [Apache Kafka documentation: Message delivery semantics](https://kafka.apache.org/documentation/#semantics); [Apache Flink blog: End-to-end exactly-once processing with Apache Kafka](https://flink.apache.org/2018/02/28/an-overview-of-end-to-end-exactly-once-processing-in-apache-flink-with-apache-kafka-too/)
   - _Also asked as:_ How do I handle exactly once versus at least once semantics in practice?

### Poison messages & dead letters
65. **A poison message blocks a partition. Design the handling.** [mine + ref · Advanced · Messaging, Reliability]
   - **Trap:** "Retry until it succeeds" or "skip it and move on." — _Why it fails:_ Infinite retries stall the whole partition. Silently skipping loses business events and can break per-key ordering. — _Probing:_ Telling transient from permanent failures, retry topics, a DLQ with context, replay, and ordering implications. — _Say:_ "Bounded retries for transient errors, retry topics with delay, a DLQ carrying full context, an alert and replay tooling, and per-key parking where order matters."
   - **Thesis:** A poison message is one that fails every time. Don't let it block everything behind it: retry a bounded number of times, then move it aside to a retry or dead-letter topic with full context, keep the partition moving, alert on it, and provide a safe way to replay once fixed.
   - **60-second answer:** In an ordered partition, a consumer that keeps failing on one message stops all progress for that partition, and lag climbs. I'd first separate transient from permanent failures: a timeout to a dependency is worth retrying; a deserialisation error or validation failure isn't. Transient failures get a few in-place retries with backoff, then move to a delayed retry topic, so the main partition continues. Permanent failures, or messages that exhaust retries, go to a dead-letter topic with the original payload, headers, error, stack trace, attempt count and source offset. The consumer commits past it and keeps going. I'd alert on DLQ arrivals, provide tooling to inspect, fix and replay messages from the DLQ back into the main flow, and decide whether skipping is acceptable: for strictly ordered entities, later messages for the same key may need to wait or be parked too.
   - **Key points:**
     1. **Classify failures.** Transient (timeouts, 503s, lock conflicts) vs permanent (schema errors, invalid data, bugs). Only transient failures deserve retries.
     2. **Bounded in-place retries.** A few attempts with short backoff for transient errors. More than that stalls the partition.
     3. **Retry topics with delay.** Move the message to a retry topic consumed after a delay (for example 1 minute, then 10, then 1 hour) so the main partition keeps flowing.
     4. **Dead-letter topic with context.** Include the original payload and headers, error message, stack trace, attempt count, timestamps and source topic, partition and offset.
     5. **Alert and own the DLQ.** DLQ arrivals are signals of bugs or bad data. Alert on rate and depth, assign ownership, and review regularly.
     6. **Safe replay.** Tooling to replay selected DLQ messages after a fix, through the same idempotent consumer path, with rate limits.
     7. **Ordering implications.** If later messages for the same key depend on the poisoned one, either park them too (per-key parking) or accept that they may be applied out of order. Decide per domain.
   - **When to choose what:** Always have a dead-letter path for consumers of untrusted or evolving input. Use retry topics for transient failures in high-throughput streams. For strictly ordered domains, park per key rather than skipping silently.
   - **Numbers:**
     - Retry schedule example: 3 in-place attempts at 100 ms, 500 ms, 2 s; then retry topics at 1 min, 10 min, 1 h; then DLQ. Total time before DLQ about 71 minutes.
   - **Pitfalls:**
     - Infinite retries in place, stalling the partition for hours.
     - Dead-lettering without context, so nobody can diagnose or replay.
     - Nobody watching the DLQ, which silently accumulates lost business events.
     - Skipping a message for an entity whose later messages depend on it, corrupting state.
   - **Follow-ups:**
     - _How do you find out whether a failure is permanent?_ By error type: deserialisation, schema and validation errors are permanent; network and dependency errors are usually transient. Unknown errors get limited retries then DLQ.
     - _How do you park messages for one key without blocking the partition?_ Keep a 'parked keys' store; when a key is parked, route its subsequent messages to a parking topic until the poisoned one is resolved, then replay them in order.
     - _What if thousands of messages hit the DLQ at once?_ That's an incident, likely a bad deploy or schema change. Pause consumers or roll back, fix, then replay in bulk with rate limits.
   - **Example:** A schema change produced events with a missing required field. Consumers moved them to the DLQ with full context after one attempt, kept processing valid events, and paged the producing team. After the producer fix, a replay tool reprocessed the 18,000 dead-lettered events in 10 minutes.
   - **Sources:** [Enterprise Integration Patterns: Dead letter channel](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html); [Confluent: Error handling patterns for Apache Kafka applications](https://www.confluent.io/blog/error-handling-patterns-in-kafka/)
   - _Also asked as:_ How do I avoid processing the same event forever due to poison messages?
66. **How do I design dead-letter queues and retry policies?** [ref · Intermediate · Messaging, Reliability]
   - **Trap:** "Retry 3 times, then send to the DLQ" with nothing after that. — _Why it fails:_ A DLQ with no alert, owner or replay path is where business events go to die. Retrying non-retryable errors wastes capacity. — _Probing:_ Classifying errors, delayed retries, enriched DLQ messages, ownership and replay. — _Say:_ "Retry only transient errors with jittered delays, dead-letter with full context, alert on arrivals, a named owner, and a rate-limited replay into idempotent consumers."
   - **Thesis:** A retry policy decides which failures are worth trying again, how often and for how long; a dead-letter queue catches what's left so it isn't lost or blocking. Both need owners, alerts and a replay path, or they become a place where business events go to die.
   - **60-second answer:** I'd define per consumer: which errors are retryable, the backoff schedule with jitter, the maximum attempts or total time, and what happens after, which is a move to a dead-letter queue. Retries should be delayed rather than immediate, using the broker's visibility timeout or delay features or separate retry queues, so a failing dependency gets breathing room. The DLQ message keeps the original payload plus metadata: error, attempts, first and last failure times, and source. Then operations: an alert when anything lands in the DLQ or when depth grows, a dashboard, a named owner, and a replay tool that sends messages back through the normal consumer after a fix. I'd also set DLQ retention long enough to investigate, and make consumers idempotent because replay means reprocessing.
   - **Key points:**
     1. **Retryable vs non-retryable.** Retry timeouts, throttling and temporary dependency errors. Don't retry validation failures, authorisation errors or deserialisation errors; send them straight to the DLQ.
     2. **Delayed retries with backoff and jitter.** Use visibility timeouts or delay queues so retries happen after increasing intervals, not in a tight loop.
     3. **Bound the attempts.** A maximum count (for example SQS's maxReceiveCount on a redrive policy) or a maximum age. After that, dead-letter.
     4. **Enrich dead-lettered messages.** Keep payload and headers intact and add error details, attempt count and timestamps, so investigation doesn't require log archaeology.
     5. **Alert, own, review.** An alert on any DLQ arrival for critical flows, or on rate for noisy ones. A team owns each DLQ and reviews it regularly.
     6. **Replay tooling.** Inspect, filter, edit if needed, and redrive messages to the source queue at a controlled rate. Idempotent consumers make this safe.
     7. **Retention.** DLQ retention longer than the main queue's, so messages survive weekends and investigations.
   - **When to choose what:** Every production queue consumer has a DLQ and a retry policy. Critical business events alert on the first DLQ message; high-volume, low-value events alert on rates. Replay is a tested, routine operation.
   - **Numbers:**
     - Example policy: visibility timeout 30 s, exponential backoff on retries, maxReceiveCount 5, DLQ retention 14 days with an alert on depth greater than 0 for payment events.
   - **Pitfalls:**
     - Retrying non-retryable errors, wasting capacity and delaying the DLQ signal.
     - A DLQ with no alert and no owner.
     - Replaying into non-idempotent consumers and creating duplicates.
     - Retry delays that are too short, hammering a struggling dependency.
   - **Follow-ups:**
     - _How do you prevent a downstream outage from filling the DLQ?_ Use a circuit breaker or pause consumption when the downstream is failing, so messages stay in the main queue rather than burning through retries and dead-lettering.
     - _Should the DLQ be per consumer or shared?_ Per consumer (or per source queue), so ownership is clear and replay targets the right consumer.
     - _How do you replay safely?_ Fix the cause, replay a small sample, watch for errors, then replay the rest with rate limiting.
   - **Example:** An SQS-based notification consumer retries provider timeouts up to 5 times with visibility-based backoff. Invalid phone numbers go straight to the DLQ. When the provider had a 2-hour outage, a circuit breaker paused consumption, so the queue grew but the DLQ stayed empty; processing resumed automatically.
   - **Sources:** [AWS SQS documentation: Using dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html); [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)

### Ordering
67. **Keep ordering when you also need parallelism.** [mine + ref · Advanced · Consistency, Messaging]
   - **Trap:** "Use a single partition to guarantee order." — _Why it fails:_ That serialises everything and kills throughput. You almost never need a global order, only order per entity. — _Probing:_ Partitioning by the ordering key, key-level concurrency, and retries and rebalances that don't reorder. — _Say:_ "Order per entity: key by account id, process each key sequentially, run keys in parallel, and never let a later message overtake a failed one for the same key."
   - **Thesis:** You rarely need a global order, only order per entity. Partition by the key whose order matters, process each key sequentially, and run many keys in parallel. Size partitions for peak parallelism, and protect order during retries and rebalances.
   - **60-second answer:** The trick is to find the scope of ordering. For an account, deposits and withdrawals must apply in order, but two different accounts are independent. So I'd key messages by account id: Kafka guarantees order within a partition, so all of an account's events go to one partition and are consumed in order, while different partitions are consumed in parallel. Partition count caps parallelism, so I'd choose it for peak consumer count with room to grow, because changing it later remaps keys. Inside a consumer I can go further: process different keys from the same partition concurrently while keeping each key sequential, with per-key queues, as Confluent's parallel consumer does. Then the edge cases: a retry must not let a later message for the same key overtake the failed one; during a rebalance, a partition's in-flight work must finish or be abandoned before the new owner starts; and sequence numbers per key let consumers detect gaps and duplicates.
   - **Key points:**
     1. **Order per key, not globally.** Identify the entity whose events must be ordered (account, order, device). Global ordering forces a single consumer and kills throughput.
     2. **Partition by that key.** Same key, same partition, which gives ordered delivery. Different partitions run in parallel across consumers in a group.
     3. **Partition count sets max parallelism.** A consumer group can't have more active consumers than partitions. Choose the count for peak load plus growth; increasing it later changes key-to-partition mapping for new messages.
     4. **Key-level parallelism within a partition.** A consumer can process different keys concurrently while serialising per key, raising throughput without more partitions.
     5. **Retries without reordering.** If a message for key K fails, later messages for K must wait (block that key, not the partition) or be parked with it.
     6. **Rebalances.** Commit offsets only after processing; on revocation, finish or abandon in-flight work cleanly. Cooperative rebalancing reduces disruption.
     7. **Sequence numbers per key.** Producers stamp a per-key sequence; consumers detect gaps (missing events) and duplicates, and can reorder small windows if needed.
   - **When to choose what:** Key by the ordering entity and parallelise across keys. Add key-level concurrency in consumers when partitions are the bottleneck. Use per-key sequence numbers wherever correctness depends on order.
   - **Numbers:**
     - Parallelism: 48 partitions allow up to 48 consumers in a group. If each processes 500 msgs/s, peak throughput is about 24,000 msgs/s.
     - Hot keys limit throughput: one key can only go as fast as one sequential processor. A key at 2,000 msgs/s needs per-message processing under 0.5 ms.
   - **Pitfalls:**
     - Keying by a random or round-robin value and losing per-entity order.
     - Retrying a failed message asynchronously while later messages for the same key proceed.
     - Committing offsets before processing completes, so a rebalance skips messages.
     - A very hot key that one consumer can't keep up with.
   - **Follow-ups:**
     - _You need more partitions. What happens to ordering?_ Adding partitions changes which partition new messages for a key go to, so for a short time old and new messages for a key may be on different partitions. Drain or pause producers, or create a new topic and migrate.
     - _How do you handle a very hot key?_ Check whether its events truly need total order. If only sub-entities need order, refine the key. Otherwise make processing for that key faster or batch it.
     - _How do you order events from multiple producers for the same key?_ Route writes for a key through a single producer or the owning service, or use per-key sequence numbers assigned by the source of truth.
   - **Example:** A wallet service keys transaction events by account id across 64 partitions. Consumers use key-level concurrency, so each account is processed sequentially while thousands of accounts run in parallel. A failed event parks only that account's subsequent events until it's resolved.
   - **Sources:** [Apache Kafka documentation: Design (partitions and ordering)](https://kafka.apache.org/documentation/#design); [Confluent: Parallel consumer for Apache Kafka](https://github.com/confluentinc/parallel-consumer)
   - _Also asked as:_ How do I handle ordering of events when it matters?

### Schedulers & long-running jobs
68. **Design a scheduler for millions of delayed jobs a day.** [mine + ref · Advanced · Messaging, Scaling]
   - **Trap:** "A cron job that runs SELECT * FROM jobs WHERE due_time <= now() every minute." — _Why it fails:_ It slows as the table grows, multiple pollers grab the same jobs, and there's no story for crashed workers, clock skew or catching up after an outage. — _Probing:_ Time-bucketed sharded storage, leases, at-least-once with idempotent jobs, and catch-up policy. — _Say:_ "Jobs bucketed by shard and due minute, one lease-holding poller per shard, idempotent jobs because leases can expire, one time source, and rate-limited catch-up with expiry rules."
   - **Thesis:** Store jobs by due time in time-bucketed, sharded storage; have workers claim due jobs with leases; execute at least once and make jobs idempotent; and design explicitly for clock skew and catching up after an outage.
   - **60-second answer:** Millions of delayed jobs a day is tens to hundreds per second on average, with peaks, so throughput isn't the hard part; correctness and recovery are. I'd store each job with its due time, partitioned by shard and time bucket, say per minute, so finding due jobs is a cheap range scan rather than scanning everything. A poller per shard, with one active owner per shard enforced by a lease, moves due jobs into a ready queue, or workers claim them directly by atomically setting a lease with an expiry. Workers execute and mark done; if a worker dies, the lease expires and the job is reclaimed, so execution is at least once and jobs must be idempotent. Clocks: use the database's or coordinator's time, not each worker's, and tolerate small skew. After an outage there's a backlog of overdue jobs, so catch-up must be rate-limited and prioritised, with a policy for jobs that are now too late to matter.
   - **Key points:**
     1. **Storage by due time.** Index or partition by (shard, due_time). Time buckets (per minute) make 'what's due now' a small range query. Old buckets are dropped once processed.
     2. **Sharding for scale.** Hash job id into N shards; each shard has one active poller at a time, which avoids duplicate polling and contention.
     3. **Claim with leases.** A worker atomically marks a job claimed with a lease expiry (conditional update). If it doesn't finish in time, another worker can reclaim it.
     4. **At-least-once, idempotent jobs.** Leases can expire while a slow worker still runs, so jobs may run twice. Use idempotency keys or check-and-set in the job's own effects.
     5. **Clock skew.** Use one time source (the database's now()) for due checks and lease expiry. Allow a small tolerance; don't depend on second-level precision across machines.
     6. **Catch-up after an outage.** Rate-limit the backlog, process the most urgent or oldest first, and define expiry rules (for example skip reminders more than 1 hour late).
     7. **Observability.** Metrics on scheduling lag (actual start minus due time), backlog per shard, failures and retries.
   - **When to choose what:** For millions of jobs a day, a relational or key-value store with time-bucketed indexes and leases is enough; reach for dedicated workflow engines (Temporal, etc.) when jobs have multi-step state and long durations. Use broker delay features only for short delays within their limits.
   - **Numbers:**
     - Load: 5 million jobs/day ≈ 58 jobs/s average; with a 10x peak at certain times (for example the top of the hour), plan for around 600 jobs/s.
     - Storage: 5 million jobs × 1 KB = 5 GB/day; with 7-day retention of completed jobs, about 35 GB.
   - **Pitfalls:**
     - Polling a single table with 'WHERE due_time <= now()' and no partitioning, which slows as the table grows.
     - Multiple pollers per shard grabbing the same jobs.
     - Non-idempotent jobs running twice after a lease expiry.
     - Releasing a huge backlog all at once after an outage, overloading downstream services.
   - **Follow-ups:**
     - _Many jobs are due at exactly 09:00. How do you avoid a thundering herd?_ Spread them with small jitter if the use case allows, rate-limit execution, and pre-load the bucket into the ready queue slightly ahead of time.
     - _How do you cancel or reschedule a job?_ Update its due time or status by job id; the poller only picks jobs in 'scheduled' status, and workers re-check status before executing.
     - _Why not just use Kafka with delayed delivery?_ Kafka has no native per-message delay; you'd build delay topics or a scheduler anyway. Some queues (SQS) support delays only up to a limit (15 minutes), not days.
   - **Example:** A lending platform schedules 4 million repayment reminders and retries per day. Jobs are stored in Postgres partitioned by day with an index on (shard, due_time); 32 shard pollers move due jobs into a queue; workers use the reminder id as an idempotency key with the SMS provider. After a 40-minute outage, catch-up ran at 3x normal rate and skipped reminders more than 2 hours late.
   - **Sources:** [Google SRE book: Distributed periodic scheduling with Cron](https://sre.google/sre-book/distributed-periodic-scheduling/); [AWS SQS documentation: Delay queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)
   - _Also asked as:_ How do I design a job scheduler for millions of jobs a day?
69. **How do I track the status of long-running jobs for users?** [ref · Intermediate · Messaging]
   - **Trap:** "Keep the HTTP request open until it's done" or "check whether the message is still in the queue." — _Why it fails:_ Long requests time out and tie up resources; queue state isn't status, because it changes on redelivery and holds no results. — _Probing:_ 202 with a job id, a durable job record as source of truth, heartbeats. — _Say:_ "Return 202 with a job id; a job record holds state, progress, result and error; workers heartbeat; clients poll with backoff or subscribe."
   - **Thesis:** Return a job id immediately and make a durable job record the source of truth for its state, progress, result and error. Clients poll or subscribe for updates. The queue only carries work; it never answers 'what's the status?'.
   - **60-second answer:** When a request kicks off work that takes seconds to hours, like an export, a report, or video processing, I'd create a job record first, with id, owner, state, progress, timestamps, result location and error, and return 202 Accepted with the job id and a status URL. Workers update the record as they go: queued, running with a percentage or step, succeeded with a result link, failed with a reason, or cancelled. Clients poll the status endpoint with sensible intervals, or subscribe via WebSocket, server-sent events or a webhook for completion. The record is the source of truth, not the queue, so status survives worker restarts and queue redeliveries. I'd add heartbeats so stuck jobs are detected, make job steps resumable for long work, and support cancellation by having workers check a cancel flag between steps.
   - **Key points:**
     1. **202 Accepted with a job id.** Return immediately with the job id and a status URL. The client doesn't hold a connection open for minutes.
     2. **Job record as source of truth.** A table with state, progress, timestamps, owner, input reference, result reference and error. The queue message only carries the job id.
     3. **Clear state machine.** queued, running, succeeded, failed, cancelled, with allowed transitions enforced by conditional updates.
     4. **Progress and heartbeats.** Workers update progress and a heartbeat timestamp. A sweeper marks jobs with stale heartbeats as failed or requeues them.
     5. **Notification options.** Polling with backoff (simple), WebSocket or server-sent events (live UI), webhooks (server-to-server), or email for very long jobs.
     6. **Resumability.** Break long jobs into checkpointed steps so a retry continues from the last step rather than starting over.
     7. **Cancellation and cleanup.** A cancel endpoint sets a flag; workers check it between steps. Results expire after a retention period.
   - **When to choose what:** Polling for most cases; push (WebSocket or SSE) when users watch progress live; webhooks for API clients. Always back the API with a durable job record.
   - **Numbers:**
     - Polling cost: 10,000 active jobs polled every 5 seconds = 2,000 status reads/s, cheap if served from an indexed table or cache; use backoff (2 s, 5 s, 10 s) to cut it further.
   - **Pitfalls:**
     - Inferring status from the queue (message present means queued), which breaks on redelivery and doesn't record results.
     - No heartbeat, so crashed jobs show 'running' forever.
     - Status endpoints that leak other users' jobs; check ownership.
     - Clients polling every 100 ms.
   - **Follow-ups:**
     - _How do you handle the same export requested twice?_ Dedupe with an idempotency key or by input fingerprint, returning the existing job id.
     - _How do you show accurate progress?_ Report progress in known units (rows processed of total, steps completed) rather than time-based guesses.
     - _How would webhooks be made reliable?_ Sign payloads, retry with backoff, record delivery attempts, and let clients fetch status as a fallback if a webhook is missed.
   - **Example:** A loan portfolio export returns 202 with job id J. The worker updates the job every 10,000 rows; the UI polls with backoff and shows a progress bar; on completion the record holds a signed download URL valid for 24 hours.
   - **Sources:** [Microsoft Azure Architecture Center: Asynchronous request-reply pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply)
70. **How do I design a fan-out and fan-in pipeline for heavy computations?** [ref · Advanced · Scaling, Messaging]
   - **Trap:** "Spawn a worker per item and count completions in memory." — _Why it fails:_ An in-memory counter dies with the coordinator, non-idempotent tasks double-count on retry, and unbounded fan-out overwhelms shared databases. — _Probing:_ Idempotent keyed results, a durable completion barrier, stragglers, concurrency caps. — _Say:_ "Idempotent tasks writing results keyed by task id, a durable counter whose conditional transition triggers fan-in exactly once, timeouts for stragglers, and capped concurrency."
   - **Thesis:** Split the work into independent, idempotent tasks; track completion with a durable counter or barrier; handle stragglers and partial failure explicitly; and cap concurrency so the fan-out doesn't overwhelm shared resources.
   - **60-second answer:** For a heavy computation, say scoring a million loans, I'd fan out by splitting into tasks of a sensible size, for example 1,000 loans each, and writing a parent job record with the total task count. Tasks go onto a queue; workers process them idempotently, writing results keyed by task id, so retries don't double-count. Fan-in happens when all tasks complete: each task atomically records completion, through a counter decremented in the database or a set of completed task ids, and whoever completes the last task triggers aggregation. I'd plan for stragglers, a few tasks taking much longer, with timeouts, retries and possibly speculative duplicates, and for failures, deciding whether the job fails if one task fails or completes with partial results. And I'd limit concurrency, since a thousand workers hitting the same database at once is a self-inflicted outage.
   - **Key points:**
     1. **Task granularity.** Big enough that per-task overhead is small, small enough to balance load and retry cheaply. Seconds to a few minutes per task is a common target.
     2. **Idempotent tasks with keyed results.** Write results by task id with upsert semantics, so a retried or duplicated task doesn't corrupt the aggregate.
     3. **Completion tracking.** Parent record with total and completed counts, updated atomically, or a set of completed ids. The transition to 'all done' triggers fan-in exactly once (conditional update).
     4. **Stragglers.** Timeouts and retries for stuck tasks; speculative execution of slow tasks if idempotent; splitting tasks that are unexpectedly large.
     5. **Partial failure policy.** Fail the whole job, retry failed tasks a few times, or complete with partial results and a report. Decide per use case.
     6. **Concurrency limits.** Bound concurrent workers per shared resource (database, external API) with semaphores or worker pool sizes.
     7. **Use an engine when it pays.** Workflow engines and data processing frameworks (Step Functions map states, Spark, Beam) handle fan-out, retries and fan-in for you.
   - **When to choose what:** Hand-rolled queue plus job record for moderate scale and simple aggregation. A workflow engine for multi-step orchestration with retries and visibility. A data processing framework for large-scale data-parallel work.
   - **Numbers:**
     - Sizing: 1 million items, 1,000 per task = 1,000 tasks. With 50 workers and 30 s per task, about 10 minutes, plus straggler time.
     - Downstream load: 50 workers each issuing 100 queries/s = 5,000 queries/s on the shared database; confirm it can take that.
   - **Pitfalls:**
     - Non-idempotent tasks that double-count on retry.
     - Counting completions in memory on one coordinator that can crash.
     - Unbounded fan-out overwhelming a database or third-party API.
     - Fan-in triggered twice because two tasks see 'all complete' at the same time.
   - **Follow-ups:**
     - _How do you make sure fan-in runs exactly once?_ A conditional update on the parent record from 'running' to 'aggregating'; only the update that succeeds triggers aggregation.
     - _One task is 100x slower than others. What do you do?_ Detect via timeout, split it if the input can be subdivided, or run a speculative copy, then investigate the skew.
     - _How do you report progress?_ Completed and total task counts on the parent record, exposed through the job status API.
   - **Example:** Monthly risk scoring splits 2 million loans into 2,000 tasks on SQS. Forty workers write scores keyed by task id; a database counter tracks completions; the last task's conditional update triggers the portfolio aggregation. Concurrency is capped at 40 to protect the database.
   - **Sources:** [Enterprise Integration Patterns: Scatter-gather](https://www.enterpriseintegrationpatterns.com/patterns/messaging/BroadcastAggregate.html); [Jeff Dean and Sanjay Ghemawat: MapReduce, simplified data processing on large clusters](https://research.google/pubs/mapreduce-simplified-data-processing-on-large-clusters/)

### Event schema evolution
71. **Evolve an event schema without breaking consumers.** [mine + ref · Intermediate · Migration, Messaging]
   - **Trap:** "Version the topic whenever the schema changes." — _Why it fails:_ Most changes can be additive with no new version. Versioning every change multiplies topics and migrations. The sneakiest breaks are changes in meaning that no schema check catches. — _Probing:_ A schema registry with a compatibility mode, tolerant readers, and a consumer inventory. — _Say:_ "Additive changes under backward or full compatibility enforced in CI; a new event type only for true breaks, with dual-publishing and a dated deprecation; and never change a field's meaning in place."
   - **Thesis:** Treat event schemas as public contracts: register them, enforce a compatibility rule in CI and at publish time, make additive changes by default, and write consumers as tolerant readers. Breaking changes get a new event type or topic with a deprecation window, informed by a list of who consumes what.
   - **60-second answer:** Events outlive the code that produced them, and producers often don't know all consumers. So I'd use a schema registry with Avro, Protobuf or JSON Schema and a compatibility mode, usually backward or full, checked in CI and enforced when producers register a schema. Safe changes: adding optional fields with defaults, adding new event types. Unsafe changes: removing or renaming fields, changing types, or changing meaning. Consumers ignore unknown fields and handle missing optional ones. When a breaking change is truly needed, I'd publish a new version as a new event type or topic, dual-publish for a period, track which consumers have migrated, and retire the old one on a date. Semantic changes are the sneaky ones: same field, different meaning, such as amount switching from pounds to pence, which no schema check catches, so they also need a new field name.
   - **Key points:**
     1. **Schema registry with compatibility.** Producers register schemas; the registry rejects changes that violate the configured compatibility (backward, forward or full).
     2. **Additive by default.** New optional fields with defaults are safe. Never remove, rename or change the type of a field consumers may read.
     3. **Tolerant readers.** Consumers ignore unknown fields, tolerate missing optional fields, and handle unknown enum values with a safe default.
     4. **Compatibility checks in CI.** Fail the build if a schema change breaks compatibility, before it ever reaches production.
     5. **Breaking changes as new versions.** New event type or topic (OrderPlacedV2), dual-publish during migration, then retire the old one.
     6. **Know your consumers.** Maintain an inventory of consumer groups per topic and their owners, so deprecation is communicated and tracked.
     7. **Semantic changes need new names.** Changing units, meaning or business rules of an existing field breaks consumers silently. Add a new field instead.
   - **When to choose what:** Backward or full compatibility enforced by a registry for all shared topics. Additive evolution for most changes; versioned new types for breaking ones, with dual-publishing and a dated deprecation.
   - **Numbers:**
     - Deprecation window example: dual-publish for at least one full release cycle of the slowest consumer team, often 1–3 months for internal consumers.
   - **Pitfalls:**
     - Renaming a field because it reads better, breaking every consumer.
     - Strict deserialisation that rejects unknown fields.
     - Changing the meaning or units of an existing field.
     - Deleting the old topic before all consumers have moved, with no inventory to check.
   - **Follow-ups:**
     - _Backward vs forward compatibility?_ Backward: new readers can read old data, so consumers upgrade first. Forward: old readers can read new data, so producers can upgrade first. Full means both; it's the safest for independently deployed teams.
     - _How do you replay old events with a new schema?_ The registry stores every version; consumers deserialise with the writer's schema and project into their current model, with defaults for added fields.
     - _JSON without a registry?_ Possible with JSON Schema and contract tests, but enforcement is weaker. At least validate in CI and in the producer, and version event types explicitly.
   - **Example:** The order service needed to split 'address' into structured fields. It added the new fields alongside the old string, consumers migrated over six weeks tracked via the consumer inventory, and the old field was deprecated, never repurposed.
   - **Sources:** [Confluent documentation: Schema evolution and compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html); [Martin Fowler: Tolerant reader](https://martinfowler.com/bliki/TolerantReader.html)
   - _Also asked as:_ How do I design an event schema that can evolve safely?

## APIs & Boundaries (9)

### Service boundaries & gateway
72. **Draw service boundaries for a lending platform: origination, underwriting, servicing, collections.** [mine + ref · Intermediate · APIs, Architecture]
   - **Trap:** One service per noun: customer service, loan service, payment service. — _Why it fails:_ Entity boundaries force most features to change several services at once, and a shared 'loan' that everyone writes has no clear owner. — _Probing:_ Boundaries by data ownership and change rate, one owner for the loan's state machine at each stage. — _Say:_ "I'd cut by decisions and ownership: origination, underwriting, servicing (which owns the loan after disbursal), collections, and a separate ledger, with events for what others need."
   - **Thesis:** Draw boundaries around data ownership and rate of change, not around nouns. Origination, underwriting, servicing and collections are good candidates because each owns distinct data and decisions and changes for different reasons, but the loan itself has one owner for its state machine, and everyone else reacts to its events.
   - **60-second answer:** I'd map each area to the decisions it makes and the data it must own. Origination owns the application journey: applicant data, documents, consent, offers. Underwriting owns the credit decision: bureau data, models, policy rules, and the decision record, which must be auditable and reproducible. Servicing owns the active loan: the repayment schedule, balances, payments and the loan's lifecycle state machine. Collections owns arrears handling: contact strategies, promises to pay, hardship plans. The critical question is where the loan's state lives: I'd put it in servicing from disbursal onward, with origination owning it before that, so there's one writer at each stage. Other services consume events like LoanDisbursed, PaymentMissed and LoanSettled and keep their own read models. Some data is copied by event, such as collections holding a local view of balances; some is queried live, like the current payoff amount at the moment a customer pays. And I'd keep the ledger, the money truth, as its own component.
   - **Key points:**
     1. **Boundaries by ownership and change.** A good boundary owns its data, makes its own decisions, and changes for its own reasons (regulation, models, operations). If two areas always change together, they're one service.
     2. **Origination.** Application flow, applicant data, KYC and documents, offers and acceptance. High change rate driven by product and marketing.
     3. **Underwriting.** Decision engine: data retrieval (bureaus, bank data), models, policy rules. Produces an auditable decision record with inputs and versions. Changes with risk policy.
     4. **Servicing.** Owns the loan after disbursal: schedule, interest, payments, fees, lifecycle state (active, in arrears, settled, written off). Changes slowly and must be correct.
     5. **Collections.** Strategies and workflows for arrears: contact cadence, promises to pay, hardship and forbearance. Reads loan state; owns its own case data.
     6. **The ledger is separate.** Double-entry ledger as the money source of truth, used by servicing and finance. Keeps accounting invariants in one place.
     7. **Copy by event vs query live.** Copy data that's needed often and can lag (collections' view of arrears). Query live where correctness at the moment matters (payoff amount at payment time).
   - **When to choose what:** One owner per piece of data and per state machine at each lifecycle stage, events for everything others need to know, synchronous queries only where freshness is required. Start with these as modules in one deployable if the team is small; split when ownership and deployment needs diverge.
   - **Numbers:**
     - Sanity check: if a typical feature touches more than two of these services, the boundaries are probably wrong or too fine.
   - **Pitfalls:**
     - A shared 'loan' table written by several services.
     - Boundaries by entity (customer service, loan service, payment service) that force every feature to change several services.
     - Underwriting decisions without stored inputs and model versions, which breaks auditability.
     - Collections calling servicing synchronously for every case view, coupling availability.
   - **Follow-ups:**
     - _Who owns the customer?_ Usually a separate customer or identity service owns core identity and contact details; each domain keeps the customer data relevant to it, referenced by customer id.
     - _How does a hardship plan in collections change the repayment schedule?_ Collections requests a schedule change through servicing's API or a command; servicing owns and applies it, then emits ScheduleChanged.
     - _How do you keep underwriting reproducible?_ Store the decision with all inputs (bureau responses, features), the model and policy version, and the outcome, so it can be replayed for audit or disputes.
   - **Example:** LoanDisbursed is emitted by servicing when funds are sent. Collections subscribes to PaymentMissed to open cases, while finance consumes ledger postings. A customer paying early calls servicing synchronously for an exact payoff amount, because a stale copy could mis-settle the loan.
   - **Sources:** [Martin Fowler: Bounded context](https://martinfowler.com/bliki/BoundedContext.html); [Team Topologies: Key concepts](https://teamtopologies.com/key-concepts)
   - _Also asked as:_ How do I define clear boundaries between services?
73. **Design a gateway that can evolve independently of the services behind it.** [mine + ref · Intermediate · APIs, Architecture]
   - **Trap:** "The gateway aggregates calls and shapes responses for each client." — _Why it fails:_ Business logic in a shared gateway makes every product change a gateway change and one team a bottleneck for everyone. — _Probing:_ A thin gateway for cross-cutting concerns, declarative team-owned routes, BFFs for aggregation. — _Say:_ "The gateway does TLS, auth, rate limits, routing and observability only; aggregation goes in backends-for-frontend owned by client teams."
   - **Thesis:** Keep the gateway thin and generic: routing, authentication, rate limits, request validation at the edge, and observability, all driven by configuration. No business logic, no knowledge of service internals. Then services and the gateway can change on their own schedules.
   - **60-second answer:** A gateway becomes a bottleneck when it accumulates business logic: aggregation for one client, special-case transforms, feature rules. Then every product change needs a gateway change, and one team owns everyone's roadmap. I'd limit it to cross-cutting concerns: TLS termination, authentication and token validation, coarse authorisation, rate limiting and quotas, routing by path and version, request size limits, and consistent logging, metrics and tracing. Routes are declarative configuration, reviewed and deployed independently of gateway code, ideally owned by the service teams for their own paths. Canary and traffic-splitting support lets services roll out new versions behind stable public paths. If clients need aggregation, I'd use a backend-for-frontend owned by the client team rather than putting it in the shared gateway. And the gateway needs its own SLO and failure budget, because it's in front of everything.
   - **Key points:**
     1. **Cross-cutting concerns only.** TLS, authentication, rate limits, routing, size limits, CORS, observability. Everything that's the same across services.
     2. **No business logic.** No aggregation, domain transforms or feature rules. Those belong in services or backends-for-frontend.
     3. **Declarative, team-owned routes.** Routes as configuration in version control, owned by the teams whose services they point to, validated and deployed without a gateway release.
     4. **Versioned public paths.** Public paths and versions are stable; the gateway maps them to whichever internal service version serves them, allowing services to move.
     5. **Traffic management.** Canary releases, weighted routing and shadowing let services ship safely behind unchanged public endpoints.
     6. **Backends-for-frontend for aggregation.** Mobile and web clients with different needs get their own thin aggregation layer, owned by the client team.
     7. **Treat the gateway as critical infrastructure.** Own SLO, redundancy across zones, careful config rollout with validation and fast rollback; a bad route config can take down everything.
   - **When to choose what:** One thin edge gateway for cross-cutting concerns; per-client BFFs for aggregation; services own their APIs and route config. Avoid custom code in the gateway unless it's genuinely universal.
   - **Numbers:**
     - Overhead target: gateway adds low single-digit milliseconds at p99; anything more suggests too much work at the edge.
   - **Pitfalls:**
     - Gateway aggregation logic for one client, which every other team then has to work around.
     - A central team as the only one allowed to change routes, creating a queue.
     - Config pushed globally without validation or canary, turning a typo into an outage.
     - Gateway that knows internal service URLs and versions in code.
   - **Follow-ups:**
     - _Where does authorisation belong?_ Coarse checks (valid token, scope for this API) at the gateway; fine-grained resource-level authorisation in the service that owns the resource.
     - _API gateway or service mesh?_ The gateway handles north-south traffic from clients; a mesh handles east-west traffic between services (mTLS, retries, telemetry). They complement each other.
     - _How do you roll out a route change safely?_ Schema validation in CI, a canary to a fraction of traffic or one region, automatic rollback on error-rate increase.
   - **Example:** A fintech moved card-specific response shaping out of the gateway into a mobile BFF. Route configs moved into each service's repository; gateway releases dropped from weekly to monthly, while services deployed daily behind unchanged public paths.
   - **Sources:** [Sam Newman: Backends for frontends pattern](https://samnewman.io/patterns/architectural/bff/); [microservices.io: API gateway pattern](https://microservices.io/patterns/apigateway.html)
   - _Also asked as:_ How do I design a gateway that can evolve independently of services?

### Versioning, compatibility & deprecation
74. **Version a public API when you cannot force clients to upgrade.** [mine + ref · Fundamental · APIs, Migration]
   - **Trap:** "Bump to /v2 whenever anything changes." — _Why it fails:_ Most changes can be additive with no version at all. Frequent versions multiply what you support forever. — _Probing:_ Additive by default, a clear definition of breaking, per-version telemetry, translation at the edge. — _Say:_ "Additive changes need no version; a breaking change gets a new version translated at the edge, with a dated support policy and usage telemetry per client."
   - **Thesis:** Make additive change the default so most changes need no new version at all, reserve explicit versions for genuinely breaking changes, and back every version with a published support policy, per-version usage telemetry and contract tests. You can't force clients, so make staying compatible cheap and moving forward easy.
   - **60-second answer:** Most API evolution should be additive: new optional fields, new endpoints, new optional parameters, with clients required to ignore unknown fields, so nothing breaks and nothing needs a version bump. For breaking changes, like removing or renaming fields, changing types or semantics, or changing error behaviour, I'd introduce an explicit version, either in the path like /v2 or in a header or dated version like Stripe's, and keep the old one working. Each version has a published support policy with dates. I'd measure usage per version and per client, so deprecation decisions are data-driven and I can contact the clients still on old versions. Contract tests, from consumer-driven contracts or recorded real traffic, catch accidental breaks before release. Internally, translating old versions into the current model at the edge keeps the core code from forking per version.
   - **Key points:**
     1. **Additive by default.** New optional fields and endpoints don't break well-behaved clients. Document that clients must ignore unknown fields and tolerate new enum values.
     2. **Define what's breaking.** Removing or renaming fields, changing types or formats, making optional inputs required, changing defaults, semantics or error codes. Publish the list.
     3. **Choose a versioning scheme.** Path versions (/v2) are visible and simple; header or date-based versions (pin each client to the version at signup) allow finer-grained evolution. Be consistent.
     4. **Translate at the edge.** Keep one current internal model; adapters convert old request and response shapes. This avoids parallel codebases per version.
     5. **Support policy with dates.** How long each version is supported after its successor ships, communicated in docs and changelogs.
     6. **Per-version telemetry.** Track calls by version and client id. You can't deprecate safely without knowing who still depends on what.
     7. **Contract tests.** Consumer-driven contracts or tests replaying real requests verify that changes don't break existing clients.
   - **When to choose what:** Additive changes with no version bump whenever possible. A new version only for unavoidable breaking changes, with translation adapters, a dated support window, and telemetry-driven deprecation.
   - **Numbers:**
     - Support window example: a minimum of 12 months after a successor is available for external APIs, longer for mobile apps with slow upgrade curves.
   - **Pitfalls:**
     - Bumping the version for every change, multiplying versions to support.
     - Silent semantic changes within a version (same field, different meaning).
     - No per-client usage data, so deprecation is guesswork.
     - Forking the codebase per version instead of translating at the edge.
   - **Follow-ups:**
     - _Path versioning or header versioning?_ Path is easier to see, cache and route; header or date-based versioning suits APIs with frequent small changes and lets each client pin. Either works if applied consistently.
     - _How do you handle mobile apps that never update?_ Long support windows, server-side translation for old versions, minimum-version enforcement only for security-critical cases, with in-app upgrade prompts.
     - _How do you change an enum safely?_ Add values as a documented possibility; clients must handle unknown values. Never repurpose an existing value.
   - **Example:** A payments API pins each integration to the API version current at signup. Breaking changes ship as new dated versions; a translation layer converts responses for older versions. Usage dashboards show which merchants are on each version, and the team contacts the long tail before retiring anything.
   - **Sources:** [Stripe blog: APIs as infrastructure, future-proofing Stripe with versioning](https://stripe.com/blog/api-versioning); [Martin Fowler: Tolerant reader](https://martinfowler.com/bliki/TolerantReader.html)
   - _Also asked as:_ How do I design versioning for public APIs? / How do I design APIs so they can evolve without breaking clients?
75. **Deprecate an endpoint safely.** [mine + ref · Intermediate · Migration, APIs, Reliability]
   - **Trap:** "Announce it in the changelog and remove it on the date." — _Why it fails:_ Many callers never read changelogs. Without telemetry and brownouts, removal day becomes an outage for someone important. — _Probing:_ Finding real callers, in-band headers (Deprecation, Sunset), brownouts, chasing stragglers. — _Say:_ "Find callers from logs, announce a date, add Deprecation and Sunset headers, run brownouts, chase the long tail, then return 410 with a pointer."
   - **Thesis:** Deprecation is a process driven by data: find every real caller from logs, announce with a date, signal in-band with Deprecation and Sunset headers, run brownouts to flush out stragglers, and remove only when traffic is gone or the date has passed with everyone informed.
   - **60-second answer:** I'd start with telemetry: who actually calls this endpoint, how often, and from which client versions, from access logs keyed by API key or client id. Then announce: docs, changelog, and direct contact with known callers, with a sunset date and a migration guide. In-band signals help automated clients notice: a Deprecation header and a Sunset header with the date, defined in RFC 8594, plus warnings in SDKs. Then brownouts: scheduled short windows where the endpoint returns an error, first in staging, then briefly in production, which reveals callers who ignored the emails. Track traffic weekly; chase the remaining callers individually. Remove after the date if traffic is at or near zero; if a critical caller remains, negotiate an extension rather than break them, but keep the pressure on. Afterwards, return a clear 410 Gone with a pointer to the replacement rather than a confusing 404.
   - **Key points:**
     1. **Find real callers.** Access logs by client id, API key, user agent and version. Unknown callers are the biggest risk; make every client identifiable before you need to deprecate.
     2. **Announce with a date and a path.** Docs, changelog, email to owners of active keys, and a migration guide with examples for the replacement.
     3. **In-band signals.** Deprecation and Sunset (RFC 8594) headers, plus a Link to the migration docs. SDKs log warnings when deprecated calls are made.
     4. **Brownouts.** Planned short failure windows (minutes, then hours) announced in advance. Callers who missed the emails discover the dependency while there's still time.
     5. **Track and chase.** Weekly traffic reports; personal outreach to the remaining callers, sorted by volume and importance.
     6. **Remove with a clear response.** After the sunset date, return 410 Gone with a message pointing to the replacement. Keep monitoring for surprise callers.
   - **When to choose what:** Every deprecation follows the same playbook with dates set by caller population: weeks for internal endpoints with known callers, months or more for public APIs and mobile clients.
   - **Numbers:**
     - Example timeline for a public endpoint: announce at T, Deprecation header from T, brownouts at T+3 and T+5 months, removal at T+6 months, extended only for documented exceptions.
   - **Pitfalls:**
     - Deprecating based on assumptions about who uses an endpoint.
     - Announcing once and then removing on the date without checking traffic.
     - Anonymous clients that can't be contacted.
     - Removing the endpoint and returning 404, leaving callers confused about why.
   - **Follow-ups:**
     - _A large customer can't migrate by the date. What do you do?_ Agree an extension for their key only, with a firm new date and engineering help, while removing access for everyone else as planned.
     - _How do you deprecate fields rather than endpoints?_ Same steps: telemetry on field usage (harder; requires logging which fields clients read or send), docs, SDK warnings, and removal in a new version.
     - _Internal endpoints?_ Service-to-service calls are easier to find via tracing; the same process applies, faster, and owners of calling services get tickets.
   - **Example:** Retiring /v1/transactions: logs showed 14 active clients. After emails, headers and two one-hour brownouts, 12 migrated; the remaining two were contacted directly and moved within a month. The endpoint now returns 410 with a link to /v2.
   - **Sources:** [RFC 8594: The Sunset HTTP header field](https://www.rfc-editor.org/rfc/rfc8594); [IETF: The Deprecation HTTP header field (RFC 9745)](https://www.rfc-editor.org/rfc/rfc9745)
   - _Also asked as:_ How do I design a safe deprecation process?
76. **How do I design for backward compatibility with older clients?** [ref · Intermediate · APIs, Migration]
   - **Trap:** "Force everyone to upgrade." — _Why it fails:_ Forced upgrades frustrate users and aren't possible for many partners or devices. It should be a last resort for security. — _Probing:_ A support window, client version telemetry, capability negotiation, shims. — _Say:_ "Clients send version and capabilities; the server only sends what they can handle; shims cover the oldest supported versions; forced upgrade only for security."
   - **Thesis:** Older clients will keep calling for longer than you expect, so build compatibility into the server: a published support window, telemetry on client versions, capability negotiation so clients and servers agree on features, and server-side shims for the oldest supported versions. Know the conditions under which you can finally drop one.
   - **60-second answer:** Mobile apps, embedded devices and partner integrations upgrade slowly or never. I'd first set a support policy: which client versions are supported and for how long. Clients send their version and capabilities on every request, which feeds telemetry on how many users are on each version and lets the server tailor responses. Instead of forking endpoints, the server negotiates features: a client that doesn't support a new card type gets a fallback rendering; a client that doesn't know a new payment method doesn't see it offered. For the oldest supported versions, small server-side shims translate responses into shapes they understand. And I'd keep a minimum-supported-version mechanism, a forced upgrade prompt, for security-critical cases, used sparingly. A version can be retired when its usage is below an agreed threshold and the support window has passed.
   - **Key points:**
     1. **Support window policy.** For example, support the last N app versions or versions released in the past 18 months. Publish it internally so teams know what they must keep working.
     2. **Client identification on every request.** App version, platform, SDK version and declared capabilities in headers. Without this you can't measure, negotiate or retire.
     3. **Capability negotiation.** Clients declare what they can render or handle; servers only send features the client supports, with sensible fallbacks.
     4. **Server-side shims.** Small adapters that transform responses for specific old versions, kept separate from core logic and deleted when the version is retired.
     5. **Never repurpose fields or values.** Old clients interpret them the old way. Add new fields instead.
     6. **Minimum version enforcement.** A forced upgrade path for security or legal reasons, with clear user messaging. Using it for convenience burns user trust.
     7. **Retirement criteria.** Usage below a threshold (for example under 0.5% of active users) and the support window elapsed.
   - **When to choose what:** Telemetry plus capability negotiation as the default mechanism; shims for the oldest versions; forced upgrades only for security. Review the supported-version list quarterly.
   - **Numbers:**
     - Retirement example: drop a version when it's below 0.5% of weekly active users and older than 18 months, after in-app prompts for 60 days.
   - **Pitfalls:**
     - Server changes tested only against the latest client.
     - No version header, so you can't tell which clients break.
     - Shims accumulating forever because nobody tracks retirement.
     - Forced upgrades for minor features, frustrating users.
   - **Follow-ups:**
     - _How do you test against old clients?_ Keep recorded request and response contracts per supported version and run them in CI against the new server; also keep old app builds for manual or automated smoke tests.
     - _What if an old client has a bug that misbehaves with new data?_ Detect the version and avoid sending the triggering data, or use a shim to sanitise it, until the version is retired.
     - _How is this different from API versioning?_ Versioning creates explicit API versions; this handles many client versions within one API version through negotiation and shims, which suits apps with continuous releases.
   - **Example:** A lending app sends app-version and a capabilities header. When a new 'instant payout' option launched, only clients declaring that capability saw it; older ones still saw standard bank transfer. A shim for app versions older than 4.0 converted new date formats until those versions dropped below 0.3% of users.
   - **Sources:** [Martin Fowler: Tolerant reader](https://martinfowler.com/bliki/TolerantReader.html); [Stripe blog: API versioning](https://stripe.com/blog/api-versioning)
77. **How do I handle breaking change scenarios with minimal disruption?** [ref · Intermediate · APIs, Migration]
   - **Trap:** "Coordinate a cutover day with all clients." — _Why it fails:_ Big-bang switches across independent clients fail on the slowest one and leave no rollback. — _Probing:_ Parallel running, migration tooling, usage tracking, gradual cutover with rollback. — _Say:_ "Ship new alongside old, make migration cheap, track who's still on the old path, move cohorts gradually, and keep a switch back."
   - **Thesis:** When a breaking change is unavoidable, run old and new side by side, migrate clients with tooling and dates, measure who still uses the old path, and keep a rollback during cutover. The disruption comes from surprises, so remove them.
   - **60-second answer:** I'd first confirm the change really must break, because often an additive alternative exists. If it must, I'd ship the new behaviour alongside the old: a new endpoint, version or field, with the old one unchanged. Then make migration easy: a guide with before-and-after examples, updated SDKs, maybe a compatibility mode or automated codemod for SDK users. Communicate the timeline with dates. Track usage of the old path per client, and contact heavy users directly. During cutover, move traffic gradually, for example by client cohort or behind a flag, and keep the ability to switch back quickly. Only remove the old path when usage is near zero and the date has passed. For internal breaking changes, the same applies but faster: change consumers first if possible, or expand-and-contract so both shapes work during the transition.
   - **Key points:**
     1. **Challenge the need.** Can it be additive (new field, new endpoint) instead? Many 'breaking' changes are really naming preferences.
     2. **Run old and new in parallel.** New version or endpoint alongside the old. Both work against the same underlying data and logic where possible.
     3. **Make migration cheap.** Migration guides, SDK updates with deprecation warnings, examples, test environments, and help for large customers.
     4. **Dates and communication.** Announce the timeline, repeat it in-band (headers), and send reminders as dates approach.
     5. **Measure old-path usage.** Dashboards by client; outreach sorted by impact.
     6. **Gradual cutover with rollback.** Shift clients or traffic in cohorts, keep the old path warm, and have a switch to revert if the new path misbehaves.
     7. **Internal changes: expand and contract.** Producers support both shapes; consumers migrate; then the old shape is removed.
   - **When to choose what:** Breaking changes are rare, scheduled events with parallel running, tooling and telemetry. Internal changes use expand-and-contract; external changes use versions with long overlap.
   - **Numbers:**
     - Overlap example: 6–12 months of parallel running for external APIs, a few weeks for internal services with known consumers.
   - **Pitfalls:**
     - Big-bang switch with no parallel period.
     - Underestimating client effort; a 'small' change can mean a mobile release cycle for them.
     - No rollback path during cutover.
     - Leaving the old path running indefinitely because nobody owns removal.
   - **Follow-ups:**
     - _How do you handle a security fix that requires a breaking change quickly?_ Shorten timelines, communicate urgently, provide a mitigation in the old path if possible, and enforce on a date with direct outreach to affected clients.
     - _How do you share logic between old and new paths?_ One internal implementation with adapters for each external shape, so fixes apply to both.
     - _How do you know cutover is safe?_ Error rates and business metrics for migrated cohorts compared with the old path, plus contract tests.
   - **Example:** Changing money amounts from decimal strings to integer minor units: v2 shipped with the new format, v1 kept working via an adapter, SDKs added conversion helpers, and usage dashboards drove outreach. v1 was removed 9 months later after traffic fell to zero.
   - **Sources:** [Martin Fowler: Parallel change (expand and contract)](https://martinfowler.com/bliki/ParallelChange.html); [Stripe blog: API versioning](https://stripe.com/blog/api-versioning)
78. **How do I design for backward compatibility when schemas change?** [ref · Intermediate · Migration, APIs]
   - **Trap:** "We only change types or names when it improves clarity, and we update the consumers too." — _Why it fails:_ You rarely control every consumer's deploy timing. Renames, type changes and reused field numbers break readers silently or loudly. — _Probing:_ Additive-only evolution, tolerant readers, never reusing a field, automated checks. — _Say:_ "Add optional fields with defaults, never remove or rename in-use fields, reserve retired field numbers, give meaning changes a new name, and enforce it in CI."
   - **Thesis:** Schema changes stay compatible when you add rather than change: new optional fields with defaults, readers that ignore unknown fields and supply defaults for missing ones, and never reusing or repurposing a field. Enforce it with compatibility checks in CI, not good intentions.
   - **60-second answer:** Whether it's a database schema, an API payload or a message format, the rules are the same. Add fields as optional with sensible defaults; never remove, rename or change the type of a field that's in use; never reuse a field name or Protobuf field number for something else; and make readers tolerant, ignoring fields they don't know and defaulting fields that are missing. With Protobuf that means reserving retired field numbers; with Avro, giving new fields defaults; with JSON, documenting optionality and not failing on unknown properties. Changing meaning is the subtle failure: a field that switches from dollars to cents breaks consumers silently, so it needs a new name. I'd enforce compatibility with automated checks: schema registry compatibility modes, buf breaking for Protobuf, or OpenAPI diff tools in CI. And for databases, expand-and-contract across releases.
   - **Key points:**
     1. **Add optional fields with defaults.** Old writers don't send them, old readers ignore them, new readers default them. Safe in every direction.
     2. **Never remove or rename in-use fields.** Deprecate first, stop reading, stop writing, then remove after all readers are gone.
     3. **Never reuse names or field numbers.** In Protobuf, reserve retired field numbers and names. Reusing them makes old data decode as the wrong field.
     4. **Tolerant readers.** Ignore unknown fields; default missing ones; handle unknown enum values gracefully.
     5. **Meaning changes need new fields.** Units, formats, time zones and business meaning. Changing them in place passes every schema check and breaks every consumer.
     6. **Automate compatibility checks.** Registry compatibility modes, buf breaking, OpenAPI diff, and migration linting in CI.
     7. **Databases: expand and contract.** Additive migration, dual write, backfill, switch reads, drop old later.
   - **When to choose what:** Additive-only evolution as the rule, automated checks as the enforcement, and versioned replacements (new field, new type, new endpoint) when something must truly change.
   - **Numbers:**
     - Check cost: compatibility checks run in seconds in CI and catch breaking changes before review, far cheaper than a production incident.
   - **Pitfalls:**
     - Changing a field's type from int to string because 'it's more flexible'.
     - Reusing a Protobuf field number for a new field.
     - Strict JSON deserialisers that reject unknown properties.
     - Changing semantics without changing the name.
   - **Follow-ups:**
     - _How do you make a required field optional, or vice versa?_ Making a required input optional is usually safe for servers; making an optional input required breaks old clients. For outputs, it's the reverse. Think about which side reads it.
     - _What's the difference between backward and forward compatibility?_ Backward: new code reads old data. Forward: old code reads new data. Independent deployments need both.
     - _How do you clean up deprecated fields eventually?_ Track readers (telemetry, consumer inventory), remove reads, then writes, then the field, reserving its name or number.
   - **Example:** A Protobuf message replaced 'amount' (double) with 'amount_minor' (int64). 'amount' was deprecated, still populated for a year, then removed with its field number reserved. buf breaking in CI blocked an attempt to reuse that number six months later.
   - **Sources:** [Protocol Buffers documentation: Updating a message type](https://protobuf.dev/programming-guides/proto3/#updating); [Confluent documentation: Schema evolution and compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)

### Rate limits & quotas
79. **Design per-tenant rate limits that do not punish well-behaved bursty clients.** [mine + ref · Intermediate · APIs, Reliability, Scaling]
   - **Trap:** "A fixed limit of N requests per minute per IP." — _Why it fails:_ Fixed windows punish bursty but well-behaved clients and allow double the limit around window boundaries; IPs don't map to tenants. — _Probing:_ Token bucket with burst, per-tenant keys, local approximation, clear 429s, a global safety layer. — _Say:_ "A token bucket per tenant (sustained rate plus burst) backed by a shared store with local approximation, 429 with Retry-After, and global load shedding underneath."
   - **Thesis:** Use token buckets per tenant: a sustained rate plus a burst allowance, so short spikes from good clients pass while sustained abuse is limited. Keep counters in a fast shared store with local approximation to avoid a round trip per request, return clear 429s with Retry-After, and tier quotas by plan.
   - **60-second answer:** Fixed-window limits punish bursty clients: a client that sends 100 requests in one second and nothing for the rest of the minute looks abusive. A token bucket fits better: tokens refill at the sustained rate, the bucket holds a burst capacity, and each request takes a token. Good clients with occasional bursts never notice; a client sending at a sustained high rate drains the bucket and gets limited. I'd key buckets by tenant and optionally by endpoint class, since writes or expensive endpoints get tighter limits. For a distributed fleet, the state lives in Redis or similar, updated atomically with a script, but calling Redis on every request adds latency, so I'd have each instance hold a local share of the tenant's budget and sync periodically, accepting small overshoot. Responses include 429 with Retry-After and rate-limit headers showing remaining quota. Limits come from the tenant's plan, and I'd add a global concurrency or load-shedding layer above it, because per-tenant limits don't protect you if every tenant bursts at once.
   - **Key points:**
     1. **Token bucket semantics.** Refill rate = sustained limit; bucket size = burst allowance. A request consumes tokens; an empty bucket means 429.
     2. **Key by tenant and cost class.** Separate buckets for cheap reads and expensive writes or reports, or weight requests by cost.
     3. **Shared counters.** Atomic token updates in Redis (Lua scripts) give a fleet-wide view. Plan for Redis being unavailable: fail open with local limits, usually.
     4. **Local approximation.** Each instance gets a slice of the tenant's budget or syncs counts every few hundred milliseconds. Cuts latency and load on the store, at the cost of slight overshoot.
     5. **Clear client feedback.** 429 with Retry-After, plus headers for limit, remaining and reset. Document the limits so clients can design for them.
     6. **Tiered quotas.** Limits by plan, with overrides for specific tenants and a process for temporary increases.
     7. **A global safety layer.** Per-tenant limits don't cap total load. Keep service-wide admission control and load shedding too.
   - **When to choose what:** Token bucket per tenant with burst headroom for API rate limits; concurrency limits for long-running or expensive operations; global load shedding underneath. Fail open on limiter outages for most APIs, closed for abuse-prone endpoints such as login.
   - **Numbers:**
     - Example plan: 100 requests/s sustained with a burst of 500. A client sending 400 requests in one second after being idle passes; sustained 200 requests/s drains the bucket within a few seconds and is limited to 100/s.
     - Local approximation: with 20 instances syncing every 250 ms, worst-case overshoot is roughly the tokens consumed in one sync interval across instances.
   - **Pitfalls:**
     - Fixed one-minute windows allowing double the limit around window boundaries and punishing bursts.
     - Per-IP limits for B2B APIs where many tenants share NAT gateways, or one tenant uses many IPs.
     - A Redis round trip on every request in the hot path.
     - 429s without Retry-After, causing clients to retry immediately.
   - **Follow-ups:**
     - _Token bucket or sliding window?_ Sliding window counters are good for 'N per period' quotas (daily limits); token bucket is better for rate plus burst behaviour. Many systems use both: a token bucket for rate, a daily quota for volume.
     - _What happens when Redis is down?_ Fall back to per-instance local limits (limit divided by instance count) so you neither block everyone nor remove protection entirely.
     - _How do you rate-limit fairly when overloaded?_ Combine per-tenant limits with weighted fair queueing or shedding by tenant share, so a big tenant can't take all remaining capacity.
   - **Example:** A B2B API moved from 6,000 requests per minute fixed windows to a token bucket of 100/s with a 1,000-token burst. Batch jobs that sent spikes at the top of each hour stopped getting 429s, while a misbehaving client looping at 400/s was held to 100/s.
   - **Sources:** [Stripe blog: Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters); [RFC 6585: Additional HTTP status codes (429 Too Many Requests)](https://www.rfc-editor.org/rfc/rfc6585)
   - _Also asked as:_ How do I design tenant-level rate limits and quotas? / How do I design rate limiting that does not break good users?

### Partial failure
80. **One request fans out to five services and two fail. What do you return?** [mine + ref · Advanced · Reliability, APIs]
   - **Trap:** "Return a 500" or "wait for all five, then respond." — _Why it fails:_ Failing everything because an optional widget failed is a bad experience, and waiting on every call lets the slowest optional service set the latency. — _Probing:_ Required versus optional, per-call timeouts, degraded responses with markers, and partial writes. — _Say:_ "Classify required versus optional up front, call in parallel with per-call timeouts, return a degraded response with markers for optional failures, and fail clearly only when required data is missing."
   - **Thesis:** Classify each call as required or optional before you build the endpoint. If a required call fails, fail the request clearly (or compensate if it wrote something); if optional calls fail, return a degraded response with markers saying what's missing. Per-call timeouts make sure the slowest optional call never holds the response hostage.
   - **60-second answer:** I'd decide in advance which of the five calls the response can't exist without and which are enrichments. Say a product page needs product details and price (required) and adds reviews, recommendations and stock badges (optional). Calls run in parallel with individual timeouts inside the overall deadline. If an optional call fails or times out, I return the response without that section and mark it, for example a field saying reviews are unavailable, so clients render a placeholder instead of guessing. If a required call fails, the request fails with a clear error, but only after retrying idempotent reads within budget, maybe serving a cached copy if that's acceptable. If the fan-out includes writes, a partial failure leaves some steps done, so the operation needs compensation or should be a saga with an idempotency key so the client can retry safely. And I'd measure degraded responses as a metric, because a feature silently degraded for a week is an incident nobody noticed.
   - **Key points:**
     1. **Required vs optional, decided up front.** Document per endpoint which dependencies are required. This drives timeouts, error handling and client expectations.
     2. **Parallel calls with per-call timeouts.** Independent calls run concurrently; each has a timeout below the overall deadline. Optional calls get tighter timeouts.
     3. **Degraded responses with markers.** Return what you have and say what's missing (a 'partial' flag or per-section status) so clients render accordingly.
     4. **Fallbacks for required data.** Cached or stale data, if acceptable, can turn a failure into a degraded success. Otherwise fail clearly.
     5. **Partial writes need compensation.** If some calls wrote state, failing the request leaves inconsistency. Use idempotency keys, sagas or compensations so retries and failures converge.
     6. **Status codes.** Success with partial content flagged in the body is common for reads; avoid returning 500 when the core data is present. Fail with 5xx or 503 when required data is missing.
     7. **Observe degradation.** Count degraded responses per dependency and alert on sustained degradation.
   - **When to choose what:** Reads: degrade on optional failures, fail on required failures after bounded retries or cache fallback. Writes: avoid multi-service fan-out in one request where possible; otherwise saga plus idempotency key and a clear pending or failed status.
   - **Numbers:**
     - Budget example: 300 ms overall; required calls 200 ms timeout; optional calls 100 ms; response assembled by 250 ms with whatever arrived.
   - **Pitfalls:**
     - Waiting for every call, so the slowest optional service sets the response time.
     - Returning 500 because one widget failed.
     - Silent partial responses that clients interpret as 'no reviews exist'.
     - Fan-out writes without idempotency, so client retries duplicate the steps that succeeded.
   - **Follow-ups:**
     - _Two required services failed. What do you return?_ A clear error (503 if transient, with Retry-After), never a misleading partial success. Log which dependencies failed for debugging.
     - _How should clients handle partial responses?_ Render available sections and placeholders for missing ones; optionally retry the missing section separately.
     - _GraphQL makes this easier?_ GraphQL returns data plus an errors array per field, which models partial failure naturally, but you still need timeouts and required/optional decisions in resolvers.
   - **Example:** A loan dashboard calls loan details and balance (required) plus offers, documents and rewards (optional). Rewards times out; the response includes loans and balances, omits rewards, and sets rewards.status = 'unavailable'. The app shows 'Rewards temporarily unavailable'.
   - **Sources:** [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/); [Jeff Dean and Luiz Barroso: The tail at scale](https://research.google/pubs/the-tail-at-scale/)
   - _Also asked as:_ How do I handle partial failures in multi-service calls?

## Security & Identity (0)

### Authentication & sessions

### Authorization

### Secrets & encryption

### Abuse & audit

## Observability & Operations (8)

### Logging & tracing
81. **What should each layer log, and what must never be logged?** [mine + ref · Fundamental · Observability, Cost & compliance, Reliability]
   - **Trap:** "Log the full request and response for debugging." — _Why it fails:_ Full payloads capture tokens, card numbers and personal data, a security and compliance incident waiting to happen, and they're expensive. — _Probing:_ Structured logs with correlation ids, what each layer logs, enforced redaction, volume control. — _Say:_ "Structured logs with a trace id at every layer, decisions and failures logged richly, successes sampled, and secrets and personal data blocked by allow-lists and redaction."
   - **Thesis:** Every layer emits structured logs carrying a shared request or trace id, recording what a responder needs: what was requested, what was decided, what failed, with enough context to act. Never log secrets, credentials, full card numbers or unnecessary personal data. Control volume with levels and sampling, and retain by sensitivity.
   - **60-second answer:** I'd standardise structured JSON logs with common fields: timestamp, service, environment, version, trace and request id, tenant, and a stable event name. Per layer: the edge logs request line, status, latency, client identity and bytes; the gateway logs authentication outcomes and rate-limit decisions; services log business decisions and their reasons, like 'loan declined, policy rule X', calls to dependencies with latency and outcome, and errors with stack traces and relevant identifiers; data access logs slow queries and errors, not every query. What must never be logged: passwords, tokens, API keys, session cookies, full card numbers and CVVs, national ids, and free-text personal data you don't need. I'd enforce that with allow-lists of fields, redaction in the logging library, and scanning in the pipeline. Volume is controlled by log levels, sampling of high-volume success logs, and moving high-cardinality analytics to metrics or traces. Retention depends on sensitivity and regulation, with access controlled because logs are data.
   - **Key points:**
     1. **Structured logs with correlation ids.** JSON with consistent field names and a trace or request id propagated across services, so one request's logs can be joined.
     2. **Edge and gateway.** Access logs: method, path template, status, latency, bytes, client id, user agent, rate-limit and auth outcomes.
     3. **Services.** Business decisions with reasons, state transitions, dependency calls with latency and result, and errors with stack traces and entity ids.
     4. **Data layer.** Slow queries above a threshold, errors, deadlocks and connection pool exhaustion, not every successful query.
     5. **Never log sensitive data.** Credentials, tokens, secrets, full payment card data, government ids, health data and raw personal free text. Mask or tokenise identifiers where needed.
     6. **Enforce, don't hope.** Logging libraries with field allow-lists and redaction, linting for risky patterns, and pipeline scanners that detect secrets and card numbers.
     7. **Volume and retention.** Levels, sampling of high-volume success paths, retention tiers by sensitivity, and access controls on log stores.
   - **When to choose what:** Logs for discrete events and debugging context, metrics for aggregates, traces for request flow. Log decisions and failures richly; sample successes; never log secrets or unneeded personal data.
   - **Numbers:**
     - Cost check: 10,000 req/s × 1 KB of logs per request ≈ 860 GB/day. Sampling successful request logs at 10% cuts most of that while keeping all errors.
   - **Pitfalls:**
     - Logging full request and response bodies, capturing tokens and personal data.
     - Unstructured messages that can't be searched or aggregated.
     - No correlation id, so incidents become log archaeology.
     - Debug logging left on in production, blowing up cost and drowning signal.
   - **Follow-ups:**
     - _A secret was logged. What do you do?_ Rotate the secret immediately, purge or restrict the affected logs, find and fix the code path, and add a redaction rule and test so it can't recur.
     - _How do you debug a specific customer's issue without logging personal data?_ Log stable pseudonymous ids (customer id, not name or email), and look up details in the source system with proper access controls.
     - _Logs or traces for latency debugging?_ Traces show where time went across services; logs give detail within a span. Link them by trace id.
   - **Example:** A lending service logs 'decision_made' with application id, policy version, outcome and reason codes, but not bureau data or income values. A redaction filter masks any field matching card or token patterns, and success logs are sampled at 5% while all errors are kept.
   - **Sources:** [OWASP: Logging cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html); [OpenTelemetry: Logs](https://opentelemetry.io/docs/concepts/signals/logs/)
   - _Also asked as:_ What should I log at each layer, and what should I never log?
82. **Trace a request across 50 services without a runaway bill.** [mine + ref · Advanced · Observability, Cost & compliance]
   - **Trap:** "Sample 1% of traces at the start of each request." — _Why it fails:_ Random head sampling throws away most of the rare failed and slow traces you actually need. — _Probing:_ Context propagation everywhere, including queues, tail-based sampling, attribute discipline, budgets. — _Say:_ "W3C context through every hop including message headers, and tail sampling that keeps all errors and slow traces plus a small baseline, with per-team budgets."
   - **Thesis:** Propagate trace context everywhere with a standard (W3C Trace Context via OpenTelemetry), keep the traces that matter with tail-based sampling (errors and slow requests at 100%, a small sample of normal ones), make span attributes queryable, and give teams a budget. You want every interesting trace, not every trace.
   - **60-second answer:** First, propagation: every service, queue and async hop must carry trace context, or traces break into fragments. I'd standardise on OpenTelemetry SDKs and W3C traceparent headers, including in message headers for Kafka or SQS. Second, sampling: head-based sampling decides at the start and is cheap, but randomly drops the rare slow or failed requests you most need. Tail-based sampling buffers spans in collectors and decides after the trace completes: keep all errors, all traces above a latency threshold, and maybe 1% of the rest. That keeps costs proportional to interesting traffic. Third, useful spans: consistent naming, attributes like tenant, endpoint and result that you can filter on, and links from metrics exemplars and logs to traces. Fourth, cost governance: per-team volume budgets, limits on attribute cardinality and span counts, and dropping noisy internal spans.
   - **Key points:**
     1. **Context propagation everywhere.** W3C Trace Context headers over HTTP and gRPC, and in message metadata for queues. A single service that drops context breaks every trace through it.
     2. **Standard instrumentation.** OpenTelemetry SDKs and auto-instrumentation for frameworks, clients and databases, with shared conventions for span names and attributes.
     3. **Head sampling: cheap but blind.** Decides at trace start with a fixed probability. Simple, low overhead, but misses rare failures unless rates are high.
     4. **Tail sampling: keep what matters.** Collectors buffer spans and decide per trace: keep errors, slow traces and a baseline sample. Needs collector capacity and trace-aware routing.
     5. **Queryable attributes.** Endpoint, tenant tier, region, version and outcome as span attributes so you can ask 'slow traces for tenant X after deploy Y'.
     6. **Connect signals.** Metric exemplars point to example traces; logs include trace ids; dashboards link to trace search.
     7. **Budgets and hygiene.** Per-team span volume budgets, caps on spans per trace, and removing high-volume low-value spans (health checks, tight loops).
   - **When to choose what:** OpenTelemetry with W3C context everywhere; tail-based sampling at the collector for production; head sampling only as a pre-filter at very high volumes. Measure trace completeness as a health metric.
   - **Numbers:**
     - Volume example: 20,000 req/s × 30 spans per trace = 600,000 spans/s. Keeping 100% of errors (say 0.5%), slow traces (1%) and 1% of the rest keeps about 2.5% of traces, roughly 15,000 spans/s.
     - Tail sampling buffer: collectors hold spans for the decision window (for example 10–30 seconds), which sizes their memory.
   - **Pitfalls:**
     - Async hops (queues, thread pools) that lose context.
     - Head sampling at 1% and wondering why no failed traces are captured.
     - High-cardinality attributes (user ids in span names) exploding storage and indexing.
     - Each team choosing different span names and attributes, making cross-service queries useless.
   - **Follow-ups:**
     - _How does tail sampling work with spans arriving at different collectors?_ Route all spans of a trace to the same collector instance (load-balance by trace id), then decide when the trace completes or times out.
     - _How do you trace through Kafka?_ Put trace context in message headers; the consumer starts a span linked to the producer's span, since processing may happen much later.
     - _What's a good baseline sampling rate?_ Enough to see normal behaviour per endpoint: often 1–5% of successful traces, adjusted per service by volume.
   - **Example:** A payments platform with 60 services moved from 0.1% head sampling to tail sampling that keeps all errors and all traces above 1 second plus 2% of the rest. Tracing cost fell 40% while engineers could now find a trace for nearly every customer-reported failure.
   - **Sources:** [OpenTelemetry: Sampling](https://opentelemetry.io/docs/concepts/sampling/); [W3C: Trace Context](https://www.w3.org/TR/trace-context/)
   - _Also asked as:_ How do I design tracing across 50+ microservices?

### Metrics, dashboards & alerts
83. **Alert on user pain, not on noise.** [mine + ref · Intermediate · Observability, Reliability]
   - **Trap:** "Alert when CPU goes above 80% or a pod restarts." — _Why it fails:_ Cause-based thresholds page on things users never feel and train on-call to ignore pages. — _Probing:_ Symptom-based paging tied to SLOs, burn rates, a runbook per alert, deleting noise. — _Say:_ "Page only on fast SLO burn for user journeys, ticket on causes, link every alert to a runbook, and delete alerts nobody acts on."
   - **Thesis:** Page a human only for symptoms users feel, measured against SLOs, and only when someone needs to act now. Causes such as high CPU or a full disk become tickets or dashboard signals unless they're about to cause user pain. Every page has an owner and a runbook, and alerts that never lead to action get deleted.
   - **60-second answer:** Noise comes from paging on causes: CPU above 80%, a pod restart, a queue above a number. Most of those don't hurt users, and the ones that do will show up as symptoms. So I'd page on symptoms tied to SLOs: error rate and latency for key user journeys, ideally as error-budget burn rate, which naturally ignores short blips and catches slow burns. Cause-based alerts that predict imminent pain, like a disk filling within four hours or a certificate expiring in seven days, are fine as tickets or business-hours alerts. Every alert must answer: who owns it, what does the responder do, and why now? Each links to a runbook. Then hygiene: track alert volume per on-call shift and the fraction that led to action; review regularly; delete or downgrade alerts that are routinely acknowledged and ignored; group and deduplicate related alerts so one incident means one page.
   - **Key points:**
     1. **Page on symptoms.** User-facing error rates, latency and availability for key journeys. These capture all causes, including ones you didn't predict.
     2. **Use SLO burn rates.** Multi-window burn-rate alerts page when the error budget is being consumed fast and resolve quickly when it stops. They ignore brief blips.
     3. **Causes as tickets.** Capacity trends, single-instance failures, certificate expiry and disk growth become tickets or daytime notifications unless user impact is imminent.
     4. **Actionable and owned.** Each alert has an owning team, a severity, and a runbook link. If there's nothing to do, it shouldn't page.
     5. **Deduplicate and group.** One incident should produce one page, with related alerts grouped under it. Alert storms bury the signal.
     6. **Measure alert quality.** Pages per shift, percent actionable, time to acknowledge, and repeat offenders. Review in on-call handoffs.
     7. **Delete aggressively.** Alerts that were ignored repeatedly are removed or downgraded. Keeping them trains people to ignore pages.
   - **When to choose what:** Pages: SLO burn-rate and hard user-facing outages only. Tickets: predictive cause-based signals. Dashboards: everything else. Revisit alert rules after every incident and every few months.
   - **Numbers:**
     - On-call health target from the Google SRE book: at most about two incidents per 12-hour shift, so each gets proper attention.
     - Fast-burn example: page when burning 14.4x budget over both 1 hour and 5 minutes; slow-burn ticket at 1x over 3 days.
   - **Pitfalls:**
     - Static thresholds on CPU or memory that page at night with no user impact.
     - Alerts without runbooks, so responders improvise.
     - Duplicate alerts from every layer for the same outage.
     - Never deleting alerts, so the on-call rotation learns to ignore the pager.
   - **Follow-ups:**
     - _How do you catch problems that aren't covered by SLOs?_ Add synthetic checks for important paths, and review incidents to see whether a missing SLI should be added.
     - _What about batch jobs?_ Alert on symptoms too: job didn't complete by its deadline, or output freshness exceeded its target.
     - _How do you reduce a noisy rotation quickly?_ Pull a month of pages, classify actionable vs not, delete or downgrade the non-actionable ones, and fix the top recurring causes.
   - **Example:** A team receiving 40 pages a week replaced 60 threshold alerts with burn-rate alerts on four SLOs plus ticketed capacity warnings. Pages dropped to about four a week, and every one was a real customer-facing problem.
   - **Sources:** [Google SRE book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/); [Google SRE workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
   - _Also asked as:_ How do I design alerting that catches real issues but avoids noise?
84. **How do I design metrics that actually tell me system health?** [ref · Intermediate · Observability]
   - **Trap:** "Average latency, CPU and memory dashboards." — _Why it fails:_ Averages hide the tail, and resource metrics don't tell you whether users are succeeding. Silent functional bugs show no errors at all. — _Probing:_ RED plus USE, histograms, per-dependency metrics, business metrics, cardinality control. — _Say:_ "RED for every endpoint with histograms, USE for every resource with saturation, per-dependency client metrics, and a few business metrics that catch silent breakage."
   - **Thesis:** Measure each service the way users experience it (rate, errors, duration) and each resource by how close it is to its limit (utilisation, saturation, errors), with histograms rather than averages, broken down by dependency, and alongside a few business metrics. Health is 'users succeed quickly and nothing is near its limit'.
   - **60-second answer:** I'd combine two well-known methods. For every service and endpoint, the RED method: request rate, error rate, and duration as a histogram so you can read p50, p95 and p99. For every resource, like CPU, memory, connection pools, thread pools, queues and disks, the USE method: utilisation, saturation such as queue length or waiting, and errors. Saturation is the early warning that averages hide. Then per-dependency metrics: rate, errors and latency for every outbound call, so you can see which dependency is slow without guessing. Then business metrics, such as applications submitted, payments completed and sign-ups, because they catch problems that technical metrics miss, like a broken button that produces no errors at all. I'd keep label cardinality under control and put deploy markers on every graph.
   - **Key points:**
     1. **RED for services.** Rate, Errors, Duration per endpoint. Duration as histograms, never only averages; percentiles reveal tail behaviour.
     2. **USE for resources.** Utilisation, Saturation, Errors for CPU, memory, disks, network, pools and queues. Saturation (waiting work) predicts trouble before utilisation hits 100%.
     3. **Per-dependency client metrics.** Each outbound call: rate, errors, latency, timeouts and circuit-breaker state. Tells you who's slow during an incident.
     4. **Business metrics.** Orders per minute, sign-ups, conversion. A drop with no technical errors often means a functional bug or upstream problem.
     5. **Histograms and percentiles.** Averages hide the tail. Use histograms so percentiles can be computed and aggregated correctly.
     6. **Control cardinality.** Labels like endpoint, status class, region and version are fine; user ids and raw URLs are not. High cardinality explodes cost and slows queries.
     7. **Context on graphs.** Deploy and config-change markers, and SLO thresholds drawn on charts.
   - **When to choose what:** RED plus USE plus per-dependency plus a handful of business metrics for every service, using shared libraries so naming and labels are consistent. SLOs are built on the RED metrics of key journeys.
   - **Numbers:**
     - Cardinality math: a metric with labels endpoint (50) × status (5) × region (3) × version (2) = 1,500 series; adding a user_id label with 1 million users makes it 1.5 billion.
   - **Pitfalls:**
     - Average latency as the main metric.
     - Only resource metrics, so you know CPU is high but not whether users are affected.
     - Unbounded label values (ids, full URLs) causing cost explosions.
     - No business metrics, missing silent functional failures.
   - **Follow-ups:**
     - _Why can't you average percentiles across instances?_ Percentiles aren't additive; averaging per-instance p99s gives a meaningless number. Aggregate histograms, then compute percentiles.
     - _What's a saturation metric for a thread pool?_ Queue length or time tasks spend waiting for a thread, plus active threads versus maximum.
     - _How do you spot a functional regression with metrics?_ Business metrics compared with the same time last week; a drop in completions without a rise in errors suggests a broken flow.
   - **Example:** Checkout errors were flat but completed orders dropped 30% after a deploy. A business-metric alert caught it: a front-end change hid the pay button on one browser. RED metrics alone would never have shown it.
   - **Sources:** [Brendan Gregg: The USE method](https://www.brendangregg.com/usemethod.html); [Grafana: The RED method](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/)
85. **How do I design dashboards that help during incidents?** [ref · Intermediate · Observability, Operations]
   - **Trap:** "A big dashboard with every metric we have." — _Why it fails:_ During an incident, fifty panels slow you down. Responders need to find impact, location and recent changes in minutes. — _Probing:_ A top-level health view, a standard per-service template, dependencies, change annotations. — _Say:_ "A journey health view first, then identical service dashboards with traffic, errors, latency, saturation and dependencies, with deploy and config annotations on every graph."
   - **Thesis:** Incident dashboards answer three questions fast: are users hurting, where, and what changed? Start with one top-level health view of symptoms, drill down by service and dependency, show deploys and config changes on every graph, and keep the layout identical across services so responders aren't learning a new screen at 3 a.m.
   - **60-second answer:** I'd design a hierarchy. The top-level dashboard shows user-facing health for key journeys: success rate, latency percentiles against SLOs, and business throughput, by region. If something is red, it links to the service dashboard, which follows a standard template for every service: RED metrics per endpoint, then saturation of its resources, then each dependency's error rate and latency, then recent deploys, config changes and feature-flag flips as annotations. From there, links go to traces filtered to the time window and logs with the same filters. I'd remove vanity panels, keep time ranges and axes consistent, and show 'same time last week' as a comparison line. And test dashboards in game days: if responders can't find the cause using them, change them.
   - **Key points:**
     1. **Top-level health first.** One screen with user-facing SLIs per journey and region. It answers 'is this real and how big?' within seconds.
     2. **Standard service template.** Every service dashboard has the same layout: traffic, errors, latency, saturation, dependencies, changes. Familiarity speeds diagnosis.
     3. **Dependencies visible.** Per-dependency latency and error panels show immediately whether the problem is upstream or downstream.
     4. **Change annotations.** Deploys, config pushes, flag changes and infrastructure events overlaid on graphs. 'What changed?' is the most productive incident question.
     5. **Comparison baselines.** Overlays for last week or yesterday make anomalies obvious without memorising normal values.
     6. **Links to traces and logs.** Pre-filtered by service and time range, so drilling down doesn't mean retyping queries.
     7. **Few panels, clear purpose.** Each panel answers a question. Remove panels nobody uses in incidents.
   - **When to choose what:** A top-level journey health dashboard, a templated dashboard per service generated from code, and links between them and to traces and logs. Dashboards are reviewed after incidents like runbooks.
   - **Numbers:**
     - Target: a responder should go from page to the affected service and dependency within a few minutes using dashboards alone; measure it in game days.
   - **Pitfalls:**
     - Fifty-panel dashboards where nobody knows which panel matters.
     - Every team's dashboard laid out differently.
     - No deploy markers, so correlations with changes are missed.
     - Dashboards built by hand that drift and break; generate them from code.
   - **Follow-ups:**
     - _How do you keep dashboards consistent across 50 services?_ Generate them from a template in code (dashboards as code) using standard metric names from shared instrumentation libraries.
     - _What goes on a status page for customers?_ Only user-facing components and their state, updated by the incident commander; not internal metrics.
     - _How do dashboards relate to alerts?_ Alerts tell you something is wrong; the alert should link to the dashboard that shows where.
   - **Example:** During an outage, the top-level dashboard showed payment success dropping in one region only. The payments service dashboard showed the fraud-check dependency's latency rising at the same time as a config annotation. Rolling back the config resolved it in 12 minutes.
   - **Sources:** [Google SRE book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/); [Grafana: Dashboard best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)

### Latency debugging
86. **p50 is flat but p99 doubled. How do you debug it?** [mine + ref · Advanced · Latency, Observability]
   - **Trap:** "Scale up" or "add caching." — _Why it fails:_ A flat median means most requests are fine; extra capacity won't fix a minority hitting a slow path. You need to find who that minority is. — _Probing:_ Slicing by dimension, queueing near saturation, GC, retries, fan-out, exemplars to traces. — _Say:_ "First what changed, then p99 sliced by instance, endpoint, tenant and dependency, then exemplar traces to see which span grew. Hedging is a mitigation, not the fix."
   - **Thesis:** A flat median with a rising tail means most requests are fine and a minority are hitting something slow. Narrow down who that minority is (which instance, endpoint, tenant, dependency or shard) by comparing percentiles across dimensions, then jump from the metric to example traces to find the slow span.
   - **60-second answer:** I'd start by asking what changed when p99 moved: a deploy, config change, traffic shift, or new tenant. Then slice: p99 by instance, zone, endpoint, tenant, client version and downstream dependency. If one instance is slow, think noisy neighbour, a bad host, or garbage collection on that JVM. If one endpoint, think a new query or a payload-size change. If one tenant, think a large account hitting a slow path. If one dependency, think its own tail or a hot shard behind it. Common tail causes: queueing when utilisation creeps up, since latency rises sharply as utilisation approaches saturation; GC pauses; lock contention; retries, where a timed-out first attempt plus a retry lands in the tail; cache misses for a subset of keys; and fan-out, where waiting on many calls makes the slowest one dominate. Exemplars on the latency histogram link straight to slow traces; I'd look at several and see which span grew.
   - **Key points:**
     1. **What changed?.** Line up the start of the regression with deploys, config changes, traffic patterns, dependency changes and infrastructure events.
     2. **Slice by dimension.** Compare p99 per instance, zone, endpoint, tenant, payload size and dependency. The dimension where one value stands out points to the cause.
     3. **Queueing near saturation.** As utilisation rises, waiting time grows sharply even if the median service time is unchanged. Check pool and queue wait times.
     4. **GC and runtime pauses.** Stop-the-world pauses hit a fraction of requests. Check GC logs and pause-time metrics on slow instances.
     5. **Retries and timeouts.** Requests that time out once and succeed on retry land squarely in the tail. Count retries per request.
     6. **Partial cache misses and hot shards.** A subset of keys missing cache or living on a hot shard produces a slow minority.
     7. **Fan-out amplification.** If a request waits on 20 calls, its latency is the max of 20, so each call's p99 becomes the request's common case.
     8. **Exemplars to traces.** Click from the histogram to example slow traces and compare their spans with normal traces to see which step grew.
   - **When to choose what:** Diagnose by elimination with dimensional slicing and traces before tuning anything. Fixes depend on cause: capacity or concurrency limits for queueing, GC tuning, query fixes, reduced fan-out, or hedged requests for idempotent reads as a mitigation.
   - **Numbers:**
     - Fan-out math: if each backend call has a 1% chance of being slow, a request that waits on 100 calls has 1 − 0.99^100 ≈ 63% chance of hitting at least one slow call.
     - Queueing intuition: in simple queueing models, average wait grows roughly in proportion to u / (1 − u); going from 70% to 90% utilisation roughly quadruples it.
   - **Pitfalls:**
     - Looking only at averages or medians.
     - Averaging p99 across instances, hiding the one slow host.
     - Adding hedged requests or bigger timeouts without finding the cause.
     - Ignoring client-side retries that inflate observed latency.
   - **Follow-ups:**
     - _Hedged requests: fix or mask?_ A mitigation. Sending a second request after the p95 delay cuts the tail for idempotent reads at modest extra load, but the underlying slow path is still there.
     - _p99 doubled only for one tenant. What next?_ Look at that tenant's data shape (much larger result sets, more items, a hot partition) and their request pattern; consider limits or dedicated capacity.
     - _How do you prevent tail regressions?_ Track p99 per endpoint as part of SLOs, include tail latency in load-test gates, and alert on p99 regressions after deploys.
   - **Example:** Checkout p99 rose from 400 to 900 ms with flat p50 after a deploy. Slicing showed it only on instances in one zone, where a new sidecar version added connection setup on 2% of calls. Exemplar traces pointed straight to the sidecar span; pinning the old version fixed it.
   - **Sources:** [Jeff Dean and Luiz Barroso: The tail at scale](https://research.google/pubs/the-tail-at-scale/); [Brendan Gregg: The USE method](https://www.brendangregg.com/usemethod.html)
   - _Also asked as:_ How do I debug high tail latency in a distributed system?

### Runbooks & failure drills
87. **Rehearse failure before production does it for you.** [mine + ref · Intermediate · Reliability, Observability]
   - **Trap:** "Run Chaos Monkey in production." — _Why it fails:_ Randomly killing things without a hypothesis, monitoring or stop condition is just causing outages, and it skips testing people and runbooks. — _Probing:_ A hypothesis, controlled blast radius, abort conditions, game days, fixing findings. — _Say:_ "Each experiment has a hypothesis in user metrics, a small blast radius and an automatic abort. Start in staging, expand gradually, and run game days that test runbooks and people."
   - **Thesis:** Run failure deliberately, with a hypothesis and a stop condition: inject dependency faults, kill instances and zones, restore from backup, and run game days where people practise the response. Start in staging, move to production in small, controlled steps, and fix what you find.
   - **60-second answer:** I'd treat failure rehearsal as experiments. Each one starts with a hypothesis, like 'if the recommendation service returns errors, checkout success stays above 99.5%', a blast radius such as one zone or 1% of traffic, and a stop condition such as an SLO burn threshold, with a one-click abort. Types: dependency fault injection, adding latency or errors to calls; infrastructure failure, killing instances, failing a zone, failing over a database; data drills, restoring a backup to a clean environment and verifying it; and game days, where a team responds to a simulated incident using real dashboards and runbooks, testing people and process as well as systems. I'd start in staging, then run small production experiments during business hours with the owning team present, and expand as confidence grows. Every finding becomes a tracked fix, and successful experiments can be automated to run continuously.
   - **Key points:**
     1. **Hypothesis first.** State expected behaviour in terms of user-facing metrics. An experiment without a hypothesis is just breaking things.
     2. **Control the blast radius.** Limit to a percentage of traffic, one zone, one cell or internal users. Expand only after success.
     3. **Stop conditions and abort.** Predefined thresholds that end the experiment automatically, plus a manual kill switch.
     4. **Dependency fault injection.** Inject latency, errors and timeouts into calls via proxies, service mesh or libraries to test timeouts, breakers and fallbacks.
     5. **Infrastructure failure.** Terminate instances, block a zone, fail over databases, expire certificates in staging. Validates redundancy and static stability.
     6. **Restore drills.** Restore real backups into isolated environments and verify integrity and time to restore.
     7. **Game days for people.** Practise detection, communication, runbooks and escalation. Debrief and fix gaps in tools, docs and process.
   - **When to choose what:** Start with game days and staging experiments; move to small production experiments for critical paths once basics (timeouts, breakers, monitoring) are in place. Automate recurring experiments where safe.
   - **Numbers:**
     - Cadence example: quarterly game day per critical service, monthly restore drill for core databases, continuous low-level fault injection (for example 1% added latency on a non-critical dependency) once mature.
   - **Pitfalls:**
     - Running chaos experiments without monitoring good enough to see the effect.
     - No abort mechanism or stop condition.
     - Treating findings as interesting rather than as bugs to fix.
     - Only testing infrastructure, never people and runbooks.
   - **Follow-ups:**
     - _How do you convince leadership to break production on purpose?_ Start small and controlled, show findings from staging, and frame it as finding failures on our schedule rather than at 3 a.m. Track incidents prevented.
     - _What's the first experiment you'd run?_ Kill one instance of a stateless service during business hours and confirm no user impact; then add latency to an optional dependency.
     - _How do you test a regional failover safely?_ Practise in staging, then shift a small share of production traffic, then full planned failovers during low-traffic windows with rollback ready.
   - **Example:** A game day simulated the credit bureau timing out. Checkout's breaker worked, but the runbook pointed to a dashboard that no longer existed and on-call didn't have permission to enable the cached-score fallback. Both were fixed the same week.
   - **Sources:** [Principles of Chaos Engineering](https://principlesofchaos.org/); [AWS Well-Architected: Test reliability](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/test-reliability.html)
   - _Also asked as:_ How do I simulate failures before they hit production?
88. **Write a runbook the on-call engineer can follow at 3 a.m.** [mine + ref · Fundamental · Operations, Observability, Reliability]
   - **Trap:** "Document the architecture and how the service works." — _Why it fails:_ At 3 a.m., the responder needs steps, not a tour. Architecture docs don't tell them what to check or do first. — _Probing:_ Starting from the symptom, ordered checks, mitigating before diagnosing, exact commands, escalation. — _Say:_ "Symptom and severity first, ordered checks with links, mitigations from safest to riskiest with exact commands, escalation after a time limit, tested by someone who didn't write it."
   - **Thesis:** A good runbook starts from the alert's symptom, lists checks in order, gives exact commands and links, offers safe mitigations before risky ones, says when to escalate, and has been tested by someone who didn't write it. It's written for a tired person who has never seen this failure before.
   - **60-second answer:** I'd structure every runbook the same way. What this alert means in user terms and how bad it is. Quick checks in order, each with an exact command or dashboard link and what 'bad' looks like: is it all regions or one; did something deploy recently; is a dependency failing. Then mitigations from safest to riskiest: roll back the last deploy, flip this feature flag, shift traffic away from a zone, scale up, restart, with exact commands and expected effects. Then when to escalate and to whom, with a time limit, like 'if not mitigated in 20 minutes, page the database team'. Then communication: where to post updates and when to declare an incident. I'd keep it short, version it next to the code or alert definition, link it from the alert, and have someone outside the team follow it in a game day. After each incident, update it.
   - **Key points:**
     1. **Start from the symptom.** What the alert means, who is affected, and how to judge severity. The responder arrives from the page, not from the architecture doc.
     2. **Ordered checks.** The first few checks that split the problem space: scope, recent changes, dependency health. Each with a direct link or command and what to look for.
     3. **Mitigate before diagnosing.** Restore service first: rollback, feature flag, traffic shift, scaling. Root cause can wait.
     4. **Exact commands.** Copy-pasteable commands with placeholders clearly marked, required permissions noted, and expected output described.
     5. **Safe to risky.** Order actions by risk; warn explicitly about anything that could make things worse (restarting a primary, clearing a cache).
     6. **Escalation and communication.** Who to page and after how long, where to post updates, when to declare a formal incident.
     7. **Tested and maintained.** Someone who didn't write it follows it in a game day. Updated after every incident where it was used; reviewed when the system changes.
   - **When to choose what:** Every paging alert links to a runbook following one template. Runbooks live with the code or alert definitions and are tested during game days and onboarding.
   - **Numbers:**
     - Target: a responder new to the service should reach a mitigation within 15 minutes using the runbook alone; measure it in drills.
   - **Pitfalls:**
     - Runbooks that explain architecture instead of telling the responder what to do.
     - Stale commands, dashboards or permissions.
     - Mitigations that require access on-call doesn't have.
     - Runbooks stored somewhere that's down during the incident.
   - **Follow-ups:**
     - _Should runbooks be automated?_ Automate safe, frequently used steps (scripts, buttons, auto-remediation) and keep the runbook as the decision guide around them.
     - _How do you keep runbooks current?_ Link them from alerts, review them in post-incident actions, and run them during onboarding so new engineers find stale steps.
     - _What if the runbook doesn't cover the situation?_ Escalate early, follow incident process, and add the new scenario to the runbook afterwards.
   - **Example:** Runbook for 'Payment success rate burn': step 1, check the regional health dashboard (link); step 2, check deploys in the last hour (command); mitigation A, roll back (command); mitigation B, disable new-provider routing flag (link); escalate to the payments lead after 20 minutes; post updates in #inc every 15 minutes.
   - **Sources:** [Google SRE book: Being on-call](https://sre.google/sre-book/being-on-call/); [Google SRE book: Managing incidents](https://sre.google/sre-book/managing-incidents/)
   - _Also asked as:_ How do I design runbooks so on-call engineers can act fast?

## Delivery & Infrastructure (0)

### Deployments & config

### Autoscaling & serverless

### Multi-region & estimation

## AI & LLM Systems (0)

### Retrieval & vectors

### Serving & cost

### Quality & safety

## Evolution, Cost & Trade-offs (8)

### MVP, platforms & cost
89. **How do I design something MVP-first that can still grow?** [ref · Fundamental · Scaling, Architecture]
   - **Trap:** "Build it properly from day one with microservices and Kubernetes so we don't have to rewrite." — _Why it fails:_ That spends the startup's scarcest resource on scale it may never need, while the expensive-to-change parts (ids, APIs, data ownership) are what actually matter. — _Probing:_ Simplicity plus the specific seams worth investing in early. — _Say:_ "Boring single deployable on managed services, but stable ids, module-owned data, versionable APIs and observability from day one, plus a written list of limits and triggers."
   - **Thesis:** Build the cheapest thing that meets today's load, but invest early in the few seams that are expensive to retrofit: identifiers, data ownership and boundaries, API contracts, and observability. Everything else can be replaced later because those stay stable.
   - **60-second answer:** For an MVP I'd pick boring, managed components: one deployable, one relational database, a managed queue if needed, and no custom infrastructure. The time saved goes into four things that are painful to change later. Identifiers: globally unique, non-sequential ids from day one, because renumbering is miserable. Data ownership: clear modules that own their tables, even inside a monolith, so later splits follow existing lines. API contracts: versionable, additive-friendly public APIs with consistent error formats, because external clients are the hardest thing to migrate. Observability: structured logs, basic metrics and tracing hooks, because you can't scale what you can't see. I'd also keep the infrastructure as code from the start. Then I'd write down the known scaling limits and the trigger for each, like 'move search out of Postgres when queries exceed X', so growth is planned rather than an emergency.
   - **Key points:**
     1. **Boring, managed, single deployable.** A monolith on managed services lets a small team ship fast. Complexity is added only when a measured need appears.
     2. **Seam 1: identifiers.** Use UUIDv7 or similar globally unique ids everywhere. Sequential integers leak volume and make merging, sharding and multi-region painful.
     3. **Seam 2: data ownership.** Modules own their tables; no cross-module joins or writes. This keeps a later split or extraction mechanical.
     4. **Seam 3: API contracts.** Consistent resource design, pagination via cursors, error formats, idempotency keys on writes, and versioning rules. External clients lock these in quickly.
     5. **Seam 4: observability.** Structured logs with request ids, RED metrics and trace propagation from the first version.
     6. **Infrastructure as code.** Even small setups in code, so environments can be recreated and changes reviewed.
     7. **Write down the limits.** Known bottlenecks with the metric and threshold that trigger the next step. Makes scaling a planned project.
   - **When to choose what:** Spend complexity budget only on seams that are expensive to change later; keep everything else as simple as possible. Revisit the limits list monthly as usage grows.
   - **Numbers:**
     - A single modern relational database and a handful of app instances can typically serve thousands of requests per second, far beyond most MVPs' first year.
   - **Pitfalls:**
     - Microservices, Kubernetes and event sourcing for a product with no users yet.
     - Sequential ids exposed in URLs and APIs.
     - Shared tables across modules, making later splits a rewrite.
     - No logging or metrics, so the first scaling problem is diagnosed blind.
   - **Follow-ups:**
     - _What would you deliberately not build?_ Multi-region, custom caching layers, a plugin system, and generic configurability, until there's a measured need.
     - _How do you avoid the MVP becoming permanent technical debt?_ Keep a visible list of shortcuts with their triggers, and budget time each cycle to address the ones approaching their limits.
     - _Which decision is hardest to reverse?_ Public API shapes and data models with external dependents. Spend design time there.
   - **Example:** A lending startup launched on one Rails app and Postgres, with UUIDs, module-owned tables, cursor pagination and idempotency keys on payment endpoints. Two years later, extracting underwriting into a service took weeks, not months, because its tables and APIs were already separate.
   - **Sources:** [Martin Fowler: Monolith first](https://martinfowler.com/bliki/MonolithFirst.html); [Dan McKinley: Choose boring technology](https://mcfunley.com/choose-boring-technology)
90. **How do I choose between building a platform and a one-off service?** [ref · Intermediate · Architecture]
   - **Trap:** "Build the platform up front so every team can reuse it." — _Why it fails:_ A platform built before the use cases are understood encodes the wrong abstractions, and teams work around it. — _Probing:_ The rule of three, a stable interface, a team that owns it as a product, adoption by pull. — _Say:_ "Build it once, adapt it the second time, extract a platform the third time, owned by a team that treats it as a product."
   - **Thesis:** Build a platform when several teams need the same capability, the interface has stabilised, and the cost of everyone building it separately is clear. Otherwise ship the one-off and extract a platform later from real, repeated usage.
   - **60-second answer:** Platforms are tempting because they promise reuse, but a platform built before you understand the use cases encodes the wrong abstractions and then every team works around it. My rule of thumb: the first time, build it for the one use case; the second time, copy and adapt and notice what changed; the third time, you understand the variation well enough to extract a platform. I'd also check that the interface has stabilised, that there's a team willing to own it as a product with support, documentation and roadmap, and that the cost of duplication, such as divergent security, operational load and inconsistent behaviour, is real. When building a platform, start from the existing implementations, keep the first version narrow, make the easy path the default, and measure adoption and satisfaction rather than mandating it.
   - **Key points:**
     1. **Rule of three.** Extract a shared capability after it's been built and adapted several times, when you can see what really varies.
     2. **Stable interface.** If requirements still change monthly, a platform will churn its users. Wait until the shape settles.
     3. **Real duplication cost.** Security fixes applied in five places, inconsistent behaviour customers notice, five on-call burdens. Without real cost, duplication may be fine.
     4. **A team that owns it as a product.** Platforms need roadmaps, docs, support, versioning and migration help. Without an owner they decay.
     5. **Extract from working code.** Base the platform on existing implementations rather than designing from scratch, and migrate those users first.
     6. **Narrow first version.** Cover the common 80% well; leave escape hatches for the rest rather than trying to handle every case.
     7. **Adoption by pull.** Make it the easiest option. Measure adoption and user satisfaction; mandates hide a bad product.
   - **When to choose what:** One-off first; extract when three or more teams need it, the interface is stable, duplication costs are measurable, and an owning team exists.
   - **Numbers:**
     - Break-even sketch: if a capability costs each team 4 engineer-weeks to build and 1 week/quarter to maintain, a platform costing 12 weeks plus 2 weeks/quarter pays off once 3–4 teams use it.
   - **Pitfalls:**
     - Building a platform for one team's use case and calling it general.
     - No owner, so the platform's bugs block every team.
     - Over-general abstractions that make the common case hard.
     - Forcing adoption before the platform is better than the alternatives.
   - **Follow-ups:**
     - _How do you handle teams with needs the platform doesn't cover?_ Provide extension points or let them build outside the platform, then fold common patterns back in.
     - _Internal platform or managed service?_ If a managed service covers the need, use it and build only thin glue; build internally only for what's specific to you.
     - _How do you measure platform success?_ Adoption, time for a new team to onboard, incidents caused, and developer satisfaction surveys.
   - **Example:** Three teams had built their own notification sending, each with different retry logic and provider integrations. A small team extracted a notification service from the best implementation, migrated the three teams over a quarter, and new teams adopted it voluntarily because it was faster than building their own.
   - **Sources:** [Team Topologies: Key concepts (platform teams)](https://teamtopologies.com/key-concepts); [Martin Fowler: What I talk about when I talk about platforms](https://martinfowler.com/articles/talk-about-platforms.html)
91. **How do I design for cost visibility and optimization from day one?** [ref · Intermediate · Cost & compliance, Observability]
   - **Trap:** "Finance reviews the cloud bill monthly and asks teams to cut costs." — _Why it fails:_ Without attribution, nobody owns the spend; looking at totals punishes growth rather than inefficiency. — _Probing:_ Tagging enforced by policy, allocating shared costs, unit costs, anomaly alerts. — _Say:_ "Enforced tags, shared costs allocated by usage, cost per request or per customer next to latency on dashboards, and anomaly alerts per service."
   - **Thesis:** You can only optimise what you can attribute. Tag every resource by team, service and environment from day one, expose unit costs (per request, per tenant, per transaction), set budgets and anomaly alerts, and review top spenders on a schedule. Make cost a metric engineers see next to latency.
   - **60-second answer:** I'd start with attribution: every cloud resource tagged with owner team, service, environment and cost centre, enforced by policy so untagged resources can't be created, plus allocation rules for shared costs like Kubernetes clusters, data transfer and observability. Then unit economics: cost per request, per active customer, per loan originated, per tenant, because absolute spend rising is fine if units grow faster. Put these on dashboards next to performance metrics and include cost estimates in design docs. Then guardrails: budgets per team with alerts, anomaly detection for sudden jumps, which are often a misconfiguration like a debug log level or runaway autoscaling, and lifecycle policies for storage and logs. Then a rhythm: monthly reviews of the top cost drivers with owners, and simple, safe wins first: rightsizing, committed-use discounts for steady load, deleting idle resources, and tiering storage.
   - **Key points:**
     1. **Tag and enforce.** Owner, service, environment and cost centre tags on every resource, enforced by policy-as-code. Untagged spend is unmanageable spend.
     2. **Allocate shared costs.** Split shared clusters, networking and observability by usage (CPU requests, bytes, log volume) so teams see their real footprint.
     3. **Unit costs.** Cost per request, per customer, per transaction or per tenant. Unit cost trends tell you whether efficiency is improving.
     4. **Cost in design reviews.** Estimate the monthly cost of new designs, including data transfer and observability, which are often underestimated.
     5. **Budgets and anomaly alerts.** Team budgets with alerts at thresholds; anomaly detection on daily spend per service.
     6. **Lifecycle policies.** Automatic expiry or tiering for logs, backups, snapshots and object storage.
     7. **Regular review.** Monthly top-spender review with owners; track savings actions like any other backlog.
   - **When to choose what:** Tagging, unit-cost dashboards and anomaly alerts from day one, because they're cheap early and very hard to retrofit. Deeper optimisation (commitments, architecture changes) once spend and usage patterns are stable.
   - **Numbers:**
     - Unit cost example: $40,000/month for a service handling 200 million requests = $0.20 per 1,000 requests; if traffic doubles and cost rises to $60,000, unit cost fell to $0.15.
     - Observability spend is often a significant share of cloud bills; sampling and retention policies are usually the quickest savings.
   - **Pitfalls:**
     - Untagged resources that nobody owns.
     - Looking at total spend only, punishing growth instead of inefficiency.
     - Ignoring data transfer costs (cross-zone, cross-region, egress) in designs.
     - Debug logging or high-cardinality metrics quietly multiplying costs.
   - **Follow-ups:**
     - _How do you allocate a shared Kubernetes cluster's cost?_ By resource requests (CPU and memory reserved) per namespace or team, plus a share of idle capacity, using tools that read cluster metrics.
     - _What's the fastest way to cut a cloud bill?_ Delete idle resources, rightsize over-provisioned instances, apply storage lifecycle rules, reduce log and metric volume, and buy commitments for steady baseline load.
     - _How do you make engineers care?_ Show their service's cost and unit cost next to its latency and errors, include cost in design reviews, and celebrate savings.
   - **Example:** A team's tracing bill doubled in a month. Anomaly alerts flagged it; the cause was a new high-cardinality span attribute. Removing it and adding tail sampling cut tracing cost 60%. Unit cost per 1,000 requests is now on every service dashboard.
   - **Sources:** [FinOps Foundation: What is FinOps?](https://www.finops.org/introduction/what-is-finops/); [AWS Well-Architected: Cost optimization pillar](https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html)

### Build vs buy
92. **Decide what to buy and what to build.** [mine + ref · Intermediate · Architecture, Cost & compliance]
   - **Trap:** "Build it so we control it" or "always buy, it's cheaper." — _Why it fails:_ Building commodity capabilities wastes engineers on undifferentiated work; buying core differentiators gives away control. Comparing build cost to licence price ignores the cost of running what you build. — _Probing:_ The differentiation test, total cost of ownership including operations, lock-in and exit. — _Say:_ "Build what makes customers choose us or what regulation forces us to control; buy commodity. Compare three-to-five-year cost including running it, and price the exit."
   - **Thesis:** Build what differentiates you or what you must control deeply; buy what's commodity. Decide on total cost over several years: integration, lock-in, data portability, compliance, and the people cost of running either option.
   - **60-second answer:** I'd ask first: does this capability make customers choose us, or does it just need to work? Underwriting models for a lender differentiate; email delivery, observability, authentication and payroll don't. For commodity capabilities, buying usually wins: vendors spread the cost across many customers and keep up with security and features. Then I'd compare total cost over three to five years: licence or usage fees against engineering time to build and, more importantly, to run, maintain, secure and support it. I'd weigh lock-in, meaning how hard it is to leave, including data export formats and proprietary APIs; compliance and data residency; vendor risk; and integration effort. For things we must control, like core data models, regulatory logic and latency-critical paths, building can be justified even if a vendor exists. And keep a thin abstraction around bought services where switching is plausible, not everywhere.
   - **Key points:**
     1. **Differentiation test.** If doing it better than competitors wins customers, consider building. If it just has to work, buy.
     2. **Total cost of ownership.** Build: initial engineering plus ongoing maintenance, on-call, security patches and feature work. Buy: fees, integration, vendor management and constraints.
     3. **Lock-in and portability.** Can you export your data in usable form? Are APIs standard? What would migration cost? Negotiate exit terms.
     4. **Control requirements.** Regulatory logic, auditability, latency, and data residency may require control a vendor can't provide.
     5. **Vendor risk.** Financial stability, security posture, SLAs, support quality and roadmap alignment.
     6. **Integration effort.** Bought products still need integration, configuration, and sometimes workarounds for missing features.
     7. **Thin abstraction where switching is plausible.** Wrap a bought service behind your own interface when you might realistically change vendors; don't abstract everything.
   - **When to choose what:** Buy commodity, build differentiators, and treat 'buy then extend' (a vendor core with your logic on top) as a common middle path. Revisit when a bought product becomes a constraint or its costs scale faster than your business.
   - **Numbers:**
     - TCO sketch: building in-house = 3 engineers × 6 months to build + 1.5 engineers ongoing; at a fully loaded cost per engineer, that often exceeds a vendor fee for commodity capabilities several times over.
   - **Pitfalls:**
     - Building commodity infrastructure because it's interesting.
     - Buying a product that can't meet a core regulatory or latency requirement and working around it forever.
     - Ignoring exit costs and data portability.
     - Comparing build cost to vendor price but forgetting the cost of running what you build.
   - **Follow-ups:**
     - _When would you switch from bought to built?_ When the vendor becomes a meaningful constraint on differentiation, when costs scale badly with your volume, or when control requirements change.
     - _How do you evaluate vendors?_ Requirements checklist, proof of concept on your hardest use case, security and compliance review, reference customers, and contract terms including exit.
     - _Open source as a third option?_ It removes licence fees but not running costs. Self-hosting open source is closer to building in operational terms; managed offerings of open source are a middle path.
   - **Example:** A lender buys identity verification, email delivery and observability, but builds its decisioning engine and repayment schedule logic, because those encode credit policy and regulatory rules that set it apart and must be fully auditable.
   - **Sources:** [Martin Fowler: Utility vs strategic dichotomy](https://martinfowler.com/bliki/UtilityVsStrategicDichotomy.html)
   - _Also asked as:_ How do I decide what to buy versus what to build?

### Extensibility, experiments & compliance
93. **How do I design systems that multiple teams can safely extend?** [ref · Advanced · Architecture, Leadership]
   - **Trap:** "A central architecture team reviews every change." — _Why it fails:_ Gatekeeping doesn't scale and becomes the bottleneck. Safety should come from design, not approvals. — _Probing:_ Explicit versioned extension points, isolation, ownership, contract tests, a paved path. — _Say:_ "Versioned extension points, per-extension timeouts and breakers so failures stay local, an ownership registry, and contract tests in CI instead of approval queues."
   - **Thesis:** Make extension safe by design: clear, versioned extension points with stable contracts, isolation so one team's extension can't take down the core or other extensions, documented ownership per component, and guardrails (tests, limits, review) that scale without a central bottleneck.
   - **60-second answer:** When many teams extend one system, the risks are breaking each other, coupling to internals, and one team's bug taking down everything. I'd define explicit extension points: plugin interfaces, events to subscribe to, configuration schemas, APIs, each versioned and documented like a public API, so teams don't reach into internals. Isolation: extensions run with resource limits, timeouts and failure containment, in separate processes or sandboxes where the risk justifies it, so a slow plugin degrades only its own feature. Ownership: every component and extension has an owning team in a registry, used for routing alerts and reviews. Guardrails: contract tests that every extension must pass, automated checks in CI, and staged rollouts with feature flags. The core team sets standards and builds the paved path, but doesn't approve every change; the aim is autonomy within safe boundaries.
   - **Key points:**
     1. **Explicit extension points.** Plugin interfaces, hooks, events, configuration and APIs. Anything not exposed is internal and may change.
     2. **Stable, versioned contracts.** Extension APIs follow the same compatibility rules as public APIs: additive changes, deprecation windows.
     3. **Isolation and limits.** Timeouts, resource quotas, separate thread pools or processes, and circuit breakers per extension so failures stay local.
     4. **Ownership registry.** Every service, extension and config owned by a named team, used for alert routing, reviews and incident escalation.
     5. **Contract and compatibility tests.** A test suite extensions must pass, run in CI against current and next core versions.
     6. **Safe rollout.** Feature flags and staged rollouts for extensions, with per-extension kill switches.
     7. **Paved path over gatekeeping.** Templates, libraries and docs that make the right way the easy way, instead of a central approval queue.
   - **When to choose what:** Invest in extension points and isolation proportional to the number of contributing teams and the blast radius of failures. In-process plugins with limits for trusted teams; out-of-process or sandboxed for untrusted or high-risk code.
   - **Numbers:**
     - Isolation budget example: each extension gets a 50 ms timeout and a bounded pool of 10 concurrent executions; exceeding either disables it via circuit breaker without affecting the core request.
   - **Pitfalls:**
     - Teams depending on internal classes or tables because no extension point existed.
     - Plugins running unbounded in the core request path.
     - No ownership, so broken extensions linger and alerts go nowhere.
     - A central team reviewing every change, becoming the bottleneck.
   - **Follow-ups:**
     - _How do you change an extension API without breaking teams?_ Version it, support old and new in parallel, provide migration guides and tooling, and track which extensions still use the old version.
     - _How do you stop teams coupling to internals?_ Module boundaries enforced by build tooling, internal packages that can't be imported, and making the extension points good enough that nobody needs to bypass them.
     - _What isolation level for third-party code?_ Out-of-process with strict resource and permission limits (containers, WebAssembly sandboxes) and no direct database access.
   - **Example:** A checkout platform lets product teams add pricing rules through a versioned plugin interface. Each plugin runs with a 30 ms budget and its own circuit breaker; a buggy promotion plugin once timed out on every call, and checkout simply ran without it while its owning team was paged.
   - **Sources:** [Team Topologies: Key concepts](https://teamtopologies.com/key-concepts); [AWS Builders' Library: Workload isolation using shuffle-sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/)
94. **How do I plan for data residency and regional regulations?** [ref · Intermediate · Cost & compliance, Reliability]
   - **Trap:** "Put the EU database in an EU region." — _Why it fails:_ Personal data also leaks through backups, replicas, logs, traces, analytics, support tools and vendors. Residency covers the whole data flow. — _Probing:_ A data inventory, regional cells, a minimal global directory, controlling side paths. — _Say:_ "Regional cells with a global directory holding only routing data, and every side path (backups, logs, analytics, vendors) kept in-region or pseudonymised."
   - **Thesis:** Classify data by jurisdiction and sensitivity, pin storage and processing to the right regions, control every path data can leak out (replication, backups, logs, analytics, support tools, vendors), and implement access and deletion rights per region. Residency is a property of the whole data flow, not just the primary database.
   - **60-second answer:** I'd start with a data inventory: which data is personal or regulated, which jurisdictions' rules apply, and what each requires, whether storage in-country, processing restrictions, transfer mechanisms or retention. Then architecture: deploy regional cells, so EU customers' data lives and is processed in the EU, with a global directory that routes each customer to their home region and contains only minimal non-sensitive data. The hard part is all the side paths: cross-region replication and backups, logs and traces that contain personal data, analytics pipelines, support and admin tools, and third-party processors. Each must respect the region or carry only pseudonymised data. I'd implement data-subject rights per region, such as access, deletion and export, and keep audit evidence. And I'd involve legal early, since requirements differ by country and change over time.
   - **Key points:**
     1. **Inventory and classify.** Map data types to jurisdictions and rules (storage location, transfer restrictions, retention). Without this, compliance is guesswork.
     2. **Regional cells.** Separate deployments per region with their own databases and processing. Customers have a home region.
     3. **Minimal global directory.** A global routing layer holds only what's needed to route (customer id to region), not regulated personal data.
     4. **Control replication and backups.** Replicas and backups stay within allowed regions; disaster recovery uses another region in the same jurisdiction where required.
     5. **Logs, traces and analytics.** Scrub or pseudonymise personal data before it leaves the region, or keep observability regional too.
     6. **Vendors and support access.** Third-party processors must meet the same residency constraints; support tooling must respect regional access rules.
     7. **Rights and evidence.** Access, export and deletion workflows per region, with audit logs proving compliance.
   - **When to choose what:** Regional cells with a minimal global directory for strict residency; regional storage with global processing of pseudonymised data where rules allow. Bring in legal review before architecture is fixed.
   - **Numbers:**
     - Cost intuition: each additional regional cell adds a baseline of infrastructure and operational cost regardless of customer count, so enter regions deliberately.
   - **Pitfalls:**
     - Regional primary databases but global logs, analytics or backups containing the same personal data.
     - A global user table holding names and emails 'for routing'.
     - Support staff in another region with unrestricted access.
     - Vendors (email, analytics, support desk) processing data outside allowed regions.
   - **Follow-ups:**
     - _A customer moves from the EU to the US. What happens?_ Follow policy and law: often their data stays in the EU unless they consent to migration; the directory continues to route them to the EU cell.
     - _How do you run global analytics?_ Aggregate or pseudonymise within each region and export only aggregates or non-identifying data, or run analytics regionally and combine results.
     - _How do you test compliance?_ Automated checks on resource locations, data-flow reviews for new features, and periodic audits of logs and vendor configurations.
   - **Example:** A lender entering the EU built a separate EU cell. The global directory stores only customer id and home region. Logs leaving the EU are scrubbed of personal fields, backups replicate between two EU regions, and the support tool restricts EU records to EU-based staff.
   - **Sources:** [GDPR Chapter 5: Transfers of personal data to third countries](https://gdpr-info.eu/chapter-5/)
95. **How do I design to support experiments such as A/B tests and flags cleanly?** [ref · Intermediate · Architecture]
   - **Trap:** "Randomly assign each request to A or B." — _Why it fails:_ Per-request assignment flips users between variants and ruins both experience and statistics. Analysing assigned rather than exposed users biases the results. — _Probing:_ Deterministic bucketing, exposure logging, flag lifecycles, guardrail metrics. — _Say:_ "Hash the user or account id with the experiment key for stable buckets, log exposures, give every flag an owner and expiry, and add guardrails that stop a bad variant automatically."
   - **Thesis:** Put experiments and flags on a central service with stable user bucketing, log every exposure, give every flag an owner, expiry and kill switch, and keep experiment logic at the edges of business code so cleaning up a finished experiment is deleting a branch, not untangling logic.
   - **60-second answer:** I'd use a central flag and experiment service, built or bought, with SDKs that evaluate flags locally from cached rules, so a flag check is fast and doesn't fail if the service is down. Bucketing is deterministic: hash the user or account id with the experiment key, so a user consistently sees the same variant across sessions and devices. Every time a user is exposed to a variant, the SDK logs an exposure event, which analysis needs to compare like with like. I'd separate kinds of flags: release toggles, which are short-lived; experiments; operational kill switches; and permissions. Each flag has an owner and expected removal date, and stale flags are flagged in reviews or CI. In code, evaluate the flag once near the entry point and pass the decision down, rather than scattering checks through business logic. And I'd guard experiments with metrics that automatically stop them if errors or key business metrics degrade.
   - **Key points:**
     1. **Central service, local evaluation.** Rules managed centrally; SDKs cache them and evaluate in-process, with safe defaults if the service is unreachable.
     2. **Deterministic bucketing.** hash(experiment_key + unit_id) mod 100 assigns a stable bucket. Choose the unit (user, account, session) to match how the experience is shared.
     3. **Exposure logging.** Log when a user actually encounters a variant, not just assignment. Analysis on exposed users avoids dilution and bias.
     4. **Flag types and lifecycles.** Release toggles (days to weeks), experiments (weeks), ops kill switches (permanent), permissions (long-lived). Each type has different review rules.
     5. **Ownership and expiry.** Every flag has an owner and removal date; dashboards and CI warnings surface stale ones.
     6. **Keep logic at the edges.** Branch once near the entry point (choose implementation A or B) rather than sprinkling checks in core logic. Cleanup becomes deleting a branch.
     7. **Guardrail metrics.** Automatic alerts or stops if error rates, latency or core business metrics drop in a variant.
   - **When to choose what:** Buy or adopt a flag platform unless you have unusual needs; invest in exposure logging, guardrails and cleanup discipline either way. Statistical rigour (sample size, pre-registered metrics) matters as much as the tooling.
   - **Numbers:**
     - Sample size intuition: detecting a 1 percentage-point change on a 10% conversion rate with typical power needs on the order of tens of thousands of users per variant; small effects need large samples.
   - **Pitfalls:**
     - Random assignment per request, so users flip between variants.
     - Analysing assigned users instead of exposed users.
     - Hundreds of stale flags making code paths untestable.
     - Flags evaluated by remote call on every request, adding latency and a failure point.
   - **Follow-ups:**
     - _How do you run experiments on the backend, like a new pricing algorithm?_ Same bucketing in the service, exposure logged when the algorithm's output is used, and guardrails on revenue and error metrics; consider shadow mode first.
     - _How do you avoid experiments interfering with each other?_ Mutually exclusive layers for experiments that touch the same area, or factorial designs when interactions are wanted.
     - _How do you clean up flags?_ Expiry dates with automatic tickets, CI warnings for flags past expiry, and periodic cleanup sprints.
   - **Example:** A loan application redesign ran as an experiment bucketed by applicant id, with exposure logged on first view of the new form. A guardrail stopped one variant within an hour when submission errors spiked; the winning variant was rolled out and the flag removed two weeks later.
   - **Sources:** [Martin Fowler (Pete Hodgson): Feature toggles](https://martinfowler.com/articles/feature-toggles.html); [Kohavi, Tang, Xu: Trustworthy online controlled experiments](https://experimentguide.com/)

### Legacy migration
96. **How do I design migration paths when the legacy system cannot just die?** [ref · Advanced · Migration, Architecture]
   - **Trap:** "Rewrite it from scratch and switch over when it's ready." — _Why it fails:_ Big-bang rewrites push all the risk to one day, deliver nothing for years, and usually miss undocumented behaviour. — _Probing:_ Strangler pattern, routing in front, slice by capability, data ownership during overlap, exit criteria. — _Say:_ "A routing layer in front, then migrate one capability at a time with shadow comparisons, a clear source of truth per data set during the overlap, and a defined exit for the old system."
   - **Thesis:** Use the strangler pattern: put a routing layer in front of the legacy system, move functionality slice by slice to the new system, keep data in sync during the overlap, and define a measurable exit criterion for turning the old system off. Big-bang rewrites fail because they defer all risk to one day.
   - **60-second answer:** When a legacy system can't just be switched off, I'd first put a facade or routing layer in front of it, at the API gateway, a proxy, or an anti-corruption layer in code, so traffic can be directed per capability. Then pick a first slice that's valuable, well understood and loosely coupled, build it in the new system, and route that traffic over, often starting with shadow traffic to compare results. Data is the hard part: during the overlap, either the new system owns the migrated data and syncs back to legacy for the remaining functions, or legacy remains the source and the new system reads from it via CDC. Ownership must be clear for each piece of data at every stage. Each slice moves with a rollback path. And I'd define the exit: which functions remain on legacy, the date or traffic threshold for decommissioning, and who signs off, because otherwise the 'temporary' coexistence lasts a decade.
   - **Key points:**
     1. **Route in front.** A facade (gateway, proxy, or interception layer) lets you move traffic per endpoint, per customer segment or per product without clients noticing.
     2. **Slice by capability.** Migrate business capabilities one at a time, starting with something valuable but not the most entangled core.
     3. **Shadow and compare.** Send copies of real requests to the new system and compare outputs before switching traffic, catching behavioural differences.
     4. **Clear data ownership during overlap.** For each data set at each stage, one system is the source of truth; the other is synced via CDC, events or batch, with reconciliation.
     5. **Anti-corruption layer.** Translate legacy models and quirks at the boundary so they don't leak into the new system's design.
     6. **Rollback per slice.** Routing can send traffic back to legacy if the new path misbehaves, as long as data sync allows it.
     7. **Exit criteria.** A defined end: remaining functions migrated, traffic at zero, data archived, contracts ended. Track progress visibly.
   - **When to choose what:** Incremental strangler migration with routing and data sync for any legacy system with active users. Big-bang cutovers only for small, well-understood systems where parallel running is impossible.
   - **Numbers:**
     - Progress metric: percent of traffic, endpoints or business volume served by the new system, reported monthly; stalled progress is a signal to revisit scope or staffing.
   - **Pitfalls:**
     - A full rewrite that runs for years without delivering value and then fails at cutover.
     - Both systems writing the same data with no clear source of truth.
     - Copying legacy quirks into the new system through a direct model translation.
     - No exit criterion, so both systems run forever and double the operational cost.
   - **Follow-ups:**
     - _The legacy system has no APIs, only a shared database. How do you start?_ Use CDC on its database to feed the new system, and intercept at the UI or batch-job level, while wrapping writes behind a new API as functions move.
     - _How do you choose the first slice?_ High value, clear boundaries, limited data dependencies, and a team that understands it. A quick win builds credibility for the rest.
     - _How do you handle reports that span old and new data?_ Feed both into a warehouse with a unified model during the overlap, so reporting doesn't depend on where a record lives.
   - **Example:** A bank migrated loan servicing off a mainframe over 30 months. A gateway routed by product: personal loans moved first, with CDC syncing balances back to the mainframe for statements. Each product moved after a month of shadow comparisons, and the mainframe contract ended when the last product migrated.
   - **Sources:** [Martin Fowler: Strangler fig application](https://martinfowler.com/bliki/StranglerFigApplication.html); [Microsoft Azure Architecture Center: Anti-corruption layer pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)

## Judgment & Leadership (11)

### Trade-offs & design reviews
97. **Defend a design trade-off to a skeptical architect in five minutes.** [mine + ref · Intermediate · Leadership, Architecture]
   - **Trap:** Walking through the diagram and arguing why your design is best. — _Why it fails:_ Skeptics aren't moved by boxes, and ignoring their preferred option makes them stop listening. Hiding the downside lets them find it for you. — _Probing:_ Agreeing the constraints, steelmanning alternatives, naming costs, and stating what would change your mind. — _Say:_ "Here are the constraints; here's the decision in one sentence; here's why your option loses on these constraints; here's what we give up; and here's the metric that would make me reverse it."
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
98. **Review a peer's design deeply and still be easy to work with.** [mine + ref · Advanced · Leadership]
   - **Trap:** Twenty comments of equal weight, mostly about how you'd have done it. — _Why it fails:_ Preference-driven, unlabelled comments bury the real risks and make every comment feel blocking. — _Probing:_ Reviewing against goals, probing failure and operations, labelling blocking versus suggestion, offering alternatives. — _Say:_ "I review against the stated goals, ask about failure, capacity and rollback, mark only correctness, security and operability issues as blocking, and pair every objection with an alternative."
   - **Thesis:** Review the design against its goals, not your preferences. Understand the problem first, ask questions that expose assumptions about failure and scale, separate blocking concerns from suggestions, offer an alternative whenever you object, and say what's good. Depth and kindness aren't in tension; vagueness and point-scoring are the problems.
   - **60-second answer:** I'd start by reading the goals, non-goals and constraints, and if they're missing, that's my first comment, because I can't judge a design without knowing what it's for. Then I'd probe the places designs usually break: what happens when each dependency is slow or down, what the capacity numbers are, how data stays consistent, how it's deployed and rolled back, and who operates it. I'd phrase concerns as questions where I'm unsure, like 'what happens if the queue consumer falls an hour behind?', and as clear statements where I'm confident. I'd label each comment: blocking, meaning it must be resolved because of a correctness, security or operational risk; or suggestion, a preference the author can take or leave. When I object, I offer an alternative or at least the criteria a solution must meet. And I'd call out strong decisions explicitly. For big disagreements I'd talk in person rather than in a comment thread.
   - **Key points:**
     1. **Start from goals and constraints.** Read what the design is meant to achieve and what's out of scope. Many review fights are really disagreements about requirements.
     2. **Probe failure, scale and operations.** Dependencies failing, capacity and growth, data consistency, deploy and rollback, observability, on-call ownership. These are where designs most often fall short.
     3. **Ask, don't assert, when unsure.** Questions surface assumptions without putting the author on the defensive, and sometimes reveal that the reviewer missed something.
     4. **Label blocking vs non-blocking.** Make it clear which comments must be addressed and why, and which are preferences. Unlabelled comments all feel blocking.
     5. **Object with an alternative.** When you disagree, propose another approach or the criteria that would satisfy you. 'I don't like this' gives the author nothing to act on.
     6. **Acknowledge what's good.** Specific praise for good decisions reinforces them and shows you read carefully.
     7. **Take big disagreements offline.** A short conversation resolves in minutes what a comment thread drags out for days. Record the outcome in the doc.
   - **When to choose what:** Block only on correctness, security, data integrity, operability or a mismatch with stated goals. Everything else is a suggestion the author decides on. Escalate unresolved blocking disagreements to a named decider rather than letting them stall.
   - **Numbers:**
     - Practical shape: a handful of well-explained, prioritised comments beats dozens of nits. If you have more than a few blocking concerns, ask for a meeting.
   - **Pitfalls:**
     - Reviewing against how you would have designed it rather than against the goals.
     - Burying the one serious issue among twenty style nits.
     - Vague concerns ('this won't scale') with no specifics.
     - Approving to be nice and raising issues after launch.
   - **Follow-ups:**
     - _The author is senior to you. How does that change the review?_ It doesn't change the standard. Ask questions grounded in specifics; senior engineers generally appreciate being challenged on failure modes.
     - _You and the author still disagree on a blocking issue. What then?_ Write down both positions and the trade-offs, and take it to the agreed decision-maker. Commit to the outcome either way.
     - _How do you review a design in an area you know little about?_ Focus on what you can judge (goals, failure handling, operability, clarity) and say explicitly which parts you can't evaluate, so someone else can.
   - **Example:** Reviewing a new notification system, I marked one blocking issue (no plan for provider outages: messages would be lost), asked two questions about capacity, offered a queue-with-DLQ alternative, labelled three formatting comments as non-blocking, and called out the clean idempotency design. The author fixed the blocker in a day.
   - **Sources:** [Google engineering practices: The standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html)
   - _Also asked as:_ How do I review someone else's design deeply but respectfully?
99. **How do I explain my design to a junior developer so they truly get it?** [ref · Intermediate · Leadership]
   - **Trap:** Presenting the full architecture diagram component by component, then asking "any questions?" — _Why it fails:_ A wall of boxes without reasons doesn't stick, and "any questions?" never reveals what didn't land. — _Probing:_ Problem first, one concrete request, components introduced when needed, checking with predictions. — _Say:_ "I start from the problem, walk one real request and add each component when the story needs it, then ask them to predict what happens when something fails."
   - **Thesis:** Start from the problem and walk one real request through the system, adding each component only when the story needs it. Use one diagram, connect new ideas to things they already know, and check understanding by asking them to predict what happens when something fails.
   - **60-second answer:** I'd begin with why the system exists: the user problem and the one or two constraints that shape everything, such as 'payments must never double-charge'. Then I'd trace a single concrete request end to end, say a user submitting a loan application, and introduce each component at the moment it's needed: the load balancer because we have several servers, the queue because document checks are slow, the outbox because we can't lose events. Each component arrives with the reason it exists, which makes it memorable. I'd draw one diagram as we go rather than presenting a finished wall of boxes, and connect ideas to familiar ones, for example a queue as a to-do list workers pick from. Then I'd check understanding by asking them to predict: 'what happens if the payment provider times out here?' Their answer shows what landed. Finally, I'd give them a small change to make in that flow, because explaining isn't the same as understanding.
   - **Key points:**
     1. **Problem and constraints first.** Explain what the system is for and the key constraints. Components make sense only in light of what they protect.
     2. **Follow one concrete request.** A specific scenario (this user, this action) gives a narrative thread and avoids abstract tours of components.
     3. **Introduce components just in time.** Each box appears when the story needs it, along with why it exists. Reasons stick better than names.
     4. **One evolving diagram.** Draw as you talk. A diagram built in front of someone is far easier to follow than a finished one.
     5. **Anchor to what they know.** Analogies and comparisons to systems or code they've used. Be clear where the analogy breaks.
     6. **Check with predictions.** Ask what happens when something fails or load doubles. Predictions reveal gaps that 'does that make sense?' never will.
     7. **Hands-on follow-up.** A small, real change in the flow you described, with support. Doing consolidates understanding.
   - **When to choose what:** Narrative and reasons over completeness. Leave out details that don't serve the first mental model; they can come later once the skeleton is in place.
   - **Numbers:**
     - Session shape: about 5 minutes of problem and constraints, 20 minutes on one request flow, 10 minutes of prediction questions, then a follow-up task.
   - **Pitfalls:**
     - Starting with the full architecture diagram and every component.
     - Jargon without definition.
     - Asking 'any questions?' instead of checking with concrete prediction questions.
     - Explaining once and assuming it stuck, with no hands-on follow-up.
   - **Follow-ups:**
     - _How do you know they really understood?_ They can predict failure behaviour correctly, explain the flow back in their own words, and make a small change without hand-holding.
     - _What if they're too shy to ask questions?_ Ask them targeted questions instead, normalise not knowing by admitting what confused you when you learned it, and follow up one-on-one.
     - _How does this apply to writing docs?_ Same structure: purpose, constraints, one walkthrough, then reference details. Most design docs fail by starting with the reference.
   - **Example:** Explaining the repayment system to a new engineer, I started with 'every payment must be applied exactly once and in the right order', walked through one customer's payment from bank webhook to ledger posting, introduced the inbox table at the point a duplicate webhook arrived, and then asked what happens if the ledger is down. They worked out the retry and DLQ path themselves.
   - **Sources:** [Simon Brown: The C4 model for visualising software architecture](https://c4model.com/)

### Simplicity & over/under-engineering
100. **How do you tell when a design is over-engineered?** [mine + ref · Intermediate · Leadership, Architecture]
   - **Trap:** "When it has too many services" or "when it's complex." — _Why it fails:_ Complexity isn't the issue; unjustified complexity is. Some complexity (idempotency, backups) protects against known risks. — _Probing:_ Tying each component to a current requirement or measured risk. — _Say:_ "If I can't name the current requirement or measured risk a component addresses, or the team can't operate everything it owns, it's over-engineered."
   - **Thesis:** A design is over-engineered when it carries complexity with no current requirement or measured risk behind it: abstractions with one user, flexibility nobody has asked for, more moving parts than people to run them, and components whose need you can't explain in a sentence.
   - **60-second answer:** I'd test every component against a simple question: what requirement or risk does this address today, and what happens if we remove it? If the answer is 'we might need it later' with no evidence, that's a warning sign. Concrete signals: abstractions or plugin systems with exactly one implementation; configuration for options nobody has requested; multiple services for a team of four, so every feature crosses network boundaries; distributed infrastructure, like Kafka, Kubernetes or a service mesh, for load a single database and a couple of servers would handle; and custom frameworks where a library exists. Another signal is operational: more systems than the team can realistically monitor, patch and be on call for. Over-engineering isn't free insurance; it slows every change, adds failure modes and costs money. The fix is to delete what isn't needed and keep the seams that make future change cheap.
   - **Key points:**
     1. **No requirement behind it.** Components justified by hypothetical future needs rather than current requirements or measured risks.
     2. **Abstractions with one user.** Interfaces, plugin systems and generic frameworks with a single implementation add indirection without benefit.
     3. **Unrequested flexibility.** Configuration options, multi-tenancy or multi-cloud support nobody has asked for.
     4. **More services than teams.** Distribution without independent teams means coordination through network calls instead of function calls.
     5. **Infrastructure beyond the load.** Distributed streaming, sharding or global replication for traffic a simple setup handles comfortably.
     6. **Operational capacity exceeded.** If the team can't monitor, upgrade and be on call for every component, the design is too big for the team.
     7. **Can't explain the need in a sentence.** If a component's purpose takes a paragraph of 'in case' scenarios, it's probably not needed yet.
   - **When to choose what:** Remove components without a current justification; keep the cheap seams (clear module boundaries, stable ids and contracts) that make adding them later easy. Revisit when a real requirement or measured limit appears.
   - **Numbers:**
     - Load sanity check: if peak load is a few hundred requests per second, a single database and a few app servers are typically more than enough; distributed infrastructure needs a stronger reason.
   - **Pitfalls:**
     - Mistaking complexity for seniority or robustness.
     - Copying the architecture of companies with thousands of times your scale.
     - Calling everything over-engineered and skipping essential safety (that's under-engineering).
     - Keeping unused components because removing them feels risky.
   - **Follow-ups:**
     - _How do you push back on an over-engineered proposal without discouraging the author?_ Ask what requirement each component serves and what the simpler alternative would cost; propose deferring parts with explicit triggers for adding them.
     - _What's the difference between over-engineering and planning ahead?_ Planning ahead keeps future options cheap (good boundaries, stable contracts). Over-engineering builds the future option now, paying its cost before you know you need it.
     - _Give an example of complexity that's justified early._ Idempotency keys on payment APIs, audit logs in regulated domains, and backups. They protect against known, high-cost risks.
   - **Example:** A four-person team proposed six microservices, Kafka and a service mesh for an internal tool with 200 users. In review we kept one service with clear modules, a Postgres database and a simple job queue, and wrote down triggers for extracting services later. It shipped in six weeks instead of the planned five months.
   - **Sources:** [Martin Fowler: Yagni](https://martinfowler.com/bliki/Yagni.html); [Dan McKinley: Choose boring technology](https://mcfunley.com/choose-boring-technology)
   - _Also asked as:_ How do I know when a design is over-engineered?
101. **How do you tell when a design is dangerously under-engineered?** [mine + ref · Intermediate · Leadership, Reliability]
   - **Trap:** "When it can't scale to 10x." — _Why it fails:_ Scale is rarely the dangerous gap. The dangerous gaps are no answer for dependency failure, no rollback, untested backups, single points of failure and a bus factor of one. — _Probing:_ Whether you check for foreseeable failures and operability. — _Say:_ "It's dangerous when there's no answer for failures we can already name: dependency outage, bad deploy, data loss, a single point of failure, or one person who understands it."
   - **Thesis:** A design is dangerously under-engineered when it has no answer for failures you can already name: no plan for a dependency outage, no capacity numbers, no way to roll back or recover data, a single point of failure on a critical path, or only one person who understands it.
   - **60-second answer:** The test is whether the design has an answer for foreseeable problems, not exotic ones. I'd ask: what happens when each dependency is down or slow; is there a timeout, a fallback, or at least a clear failure mode? What are the expected and peak loads, and has anyone checked the design handles them with headroom? How do we roll back a bad deploy, and how do we recover if data is corrupted; are there tested backups? Is there a single component whose failure takes down a critical path with no redundancy? Can we tell it's broken before customers tell us, meaning monitoring and alerts? Who owns it and who else understands it? And for money or personal data: are there idempotency, audit and access controls? A missing answer to any of these on a critical system is a real risk, not a nice-to-have. The fix is targeted: add the specific safeguard, not a platform.
   - **Key points:**
     1. **No failure handling for known risks.** No timeouts, retries, fallbacks or failure modes defined for dependencies that will certainly fail sometimes.
     2. **No capacity estimate.** Nobody has estimated peak load or checked limits (connections, throughput, storage growth).
     3. **No rollback or recovery path.** Deploys can't be reverted safely, migrations are one-way, backups are untested or missing.
     4. **Single points of failure on critical paths.** One instance, one zone, one manual step, one credential that everything depends on.
     5. **No observability.** No metrics, logs or alerts that would reveal problems before customers report them.
     6. **Bus factor of one.** Only one person understands or can operate it; no docs or runbooks.
     7. **Missing domain safeguards.** No idempotency for payments, no audit trail for regulated actions, no access controls for personal data.
   - **When to choose what:** Critical systems must have answers for dependency failure, capacity, rollback, recovery, observability and ownership before launch. Add the specific missing safeguard; don't use under-engineering as a reason for a rewrite.
   - **Numbers:**
     - Minimum bar example for a critical service: at least two instances across zones, timeouts on every call, tested backup restore, an SLO with alerting, and a runbook.
   - **Pitfalls:**
     - Calling necessary safeguards 'over-engineering' to ship faster.
     - Assuming the cloud provider handles availability for you.
     - Untested backups counted as a recovery plan.
     - Launching with the only expert about to go on leave.
   - **Follow-ups:**
     - _How do you prioritise which gaps to fix first?_ By likelihood times impact: dependency failures and bad deploys are frequent; data loss is rare but catastrophic. Fix cheap, high-impact gaps (timeouts, backups, rollback) first.
     - _How do you raise this without blocking a launch unreasonably?_ List specific risks with concrete failure scenarios and the minimal fix for each, and agree which must be done before launch and which can follow with dates.
     - _Over- vs under-engineering in the same design?_ Common: elaborate abstractions with no timeouts or backups. Complexity in the wrong place is both.
   - **Example:** A new disbursement service had elegant code but one instance, no timeouts on the bank API, and no idempotency on transfers. A review listed three concrete failure scenarios, including double disbursement on retry. Adding a second instance, a 5-second timeout with a pending state, and idempotency keys took a week and was done before launch.
   - **Sources:** [Google SRE book: Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/); [AWS Well-Architected Framework: Reliability pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)
   - _Also asked as:_ How do I know when a design is dangerously under-engineered?
102. **How do I simplify a complex design without losing guarantees?** [ref · Advanced · Leadership, Reliability]
   - **Trap:** "Merge everything into a monolith" or "remove the components that seem unnecessary." — _Why it fails:_ Without writing the guarantees down, you can remove a component that silently protected an invariant, or lose isolation that protected availability. — _Probing:_ Listing guarantees, mapping components to them, incremental change, proving the invariants. — _Say:_ "I write the guarantees down, map each component to the one it protects, remove or merge only what protects nothing, and prove the invariants with tests and fault injection."
   - **Thesis:** List the guarantees that must hold, map each component to the guarantee it protects, remove components that protect none, merge components that always change together, and prove the invariants still hold, ideally with tests or fault injection rather than argument.
   - **60-second answer:** I'd start by writing down the guarantees explicitly: for example, no payment is applied twice, every application gets a decision within 30 seconds, customer data stays in-region, and the service survives a zone loss. Then for each component and mechanism, I'd ask which guarantee it serves. Components that serve none are candidates for removal; often they're leftovers from old requirements or speculative flexibility. Components that serve the same guarantee in overlapping ways, like two layers of retries or two caches, can often be collapsed. Services that always change and deploy together can be merged. Then I'd check that simpler mechanisms still provide each guarantee: maybe a database transaction replaces a saga if the data can live in one place, or a managed service replaces a self-run cluster. Finally, prove it: tests for the invariants, fault injection for the availability guarantees, and a staged rollout. Simplicity is valuable precisely because it makes guarantees easier to verify.
   - **Key points:**
     1. **Write the guarantees down.** Correctness invariants, latency and availability targets, compliance constraints. If a guarantee isn't written, you can't tell what a simplification risks.
     2. **Map components to guarantees.** For each component, name the guarantee it protects. Unmapped components are removal candidates.
     3. **Remove what protects nothing.** Old features, speculative extension points, abandoned integrations and redundant layers.
     4. **Collapse overlapping mechanisms.** Multiple retry layers, duplicate caches, parallel queues for similar work. Keep one well-understood mechanism.
     5. **Merge what changes together.** Services or modules that always deploy together gain nothing from being separate.
     6. **Use stronger primitives.** Moving data into one database can replace sagas and reconciliation with transactions; a managed service can replace a custom cluster.
     7. **Prove the invariants still hold.** Property tests, integration tests and fault injection for each guarantee before and after the change; staged rollout with monitoring.
   - **When to choose what:** Simplify incrementally, one removal or merge at a time, with the guarantee tests as a safety net. Prefer changes that replace distributed coordination with local transactions when ownership allows.
   - **Numbers:**
     - Simplification payoff is often visible in operational metrics: fewer components to patch, fewer alert rules, lower incident counts and faster lead time for changes.
   - **Pitfalls:**
     - Removing a component whose guarantee was implicit and undocumented.
     - Simplifying by merging everything into one service, losing isolation that protected availability.
     - Big-bang simplification instead of incremental steps.
     - Assuming a simpler design is correct without testing the invariants.
   - **Follow-ups:**
     - _How do you find implicit guarantees?_ Read incident history, interview the people who operate it, and look at what breaks in tests when a component is stubbed out.
     - _Give an example of replacing distributed machinery with a simpler primitive._ Two services coordinating via a saga merged into one service with one database, replacing the saga, outbox and reconciliation with a single transaction.
     - _How do you convince people simplification is worth it?_ Show the cost of current complexity in incidents, on-call load and lead time, and propose small steps with clear rollback.
   - **Example:** A loan pipeline had five services, two queues and a reconciliation job to keep application status consistent. Mapping components to guarantees showed three services always deployed together and existed for a team structure that no longer existed. Merging them let a single transaction replace two queues and the reconciliation job, while integration tests confirmed every application still received exactly one decision.
   - **Sources:** [Rich Hickey: Simple made easy (talk)](https://www.infoq.com/presentations/Simple-Made-Easy/); [Martin Fowler: Microservice trade-offs](https://martinfowler.com/articles/microservice-trade-offs.html)
103. **How do I design for boring reliability instead of cleverness?** [ref · Intermediate · Leadership, Reliability]
   - **Trap:** "Use the newest technology because it's more advanced." — _Why it fails:_ Novel technology has unknown failure modes and few people who can operate it. Reliability comes from well-understood systems. — _Probing:_ An innovation budget, fewer moving parts, simple failure modes. — _Say:_ "Proven technology by default, novelty only where it differentiates, as few critical-path components as possible, and failure modes simple enough that anyone on call can handle them."
   - **Thesis:** Choose proven components, minimise moving parts, prefer designs whose failure modes are simple and well understood, and spend your limited 'innovation budget' only where it creates real advantage. Reliability comes from boring systems that many people can operate, not clever ones only their author can.
   - **60-second answer:** Clever designs often work beautifully until something unusual happens, and then only one person can debug them. Boring designs use well-known technology with mature tooling, documented failure modes and a large community. I'd apply a few rules. Default to technologies the team already runs well, like a relational database, a mainstream queue and a standard deploy pipeline, and treat each new technology as a cost to justify. Minimise components on the critical path, because every component is a failure mode. Prefer simple failure behaviour: fail fast with clear errors rather than complex self-healing that can misbehave. Make operations predictable: the same deployment, monitoring and runbook patterns everywhere. And reserve novelty for the parts that actually differentiate the product. Dan McKinley's idea of innovation tokens captures this: you only get a few, so spend them where they matter.
   - **Key points:**
     1. **Proven technology by default.** Mature tools have known failure modes, tooling, documentation and people who know them. New tools have unknown unknowns.
     2. **Innovation budget.** Each new technology or novel design pattern costs learning, operational effort and risk. Spend that budget only on differentiators.
     3. **Fewer moving parts.** Every component on the critical path is a way to fail. Remove components whose value doesn't clearly exceed that risk.
     4. **Simple failure modes.** Fail fast, clear errors, predictable degradation. Complex automatic recovery can create new, harder failures.
     5. **Uniform operations.** Same deploy, observability and runbook patterns across services, so anyone on call can work on any of them.
     6. **Readable over clever code.** Code that a new team member can follow at 3 a.m. beats a concise trick. Optimise for the reader.
     7. **Defend the choice with operational data.** Incident counts, time to recover and on-call load show the value of boring choices.
   - **When to choose what:** Boring by default; novel only where it provides a measurable advantage and the team can operate it. Revisit 'boring' periodically, since today's novel tool can become tomorrow's standard.
   - **Numbers:**
     - Rule of thumb: limit new production technologies to a small number per year per team, each with a named owner and an exit plan.
   - **Pitfalls:**
     - Adopting a new database or framework because it's exciting.
     - Elaborate self-healing logic that causes outages when it misfires.
     - Clever one-off solutions that nobody else understands.
     - Confusing boring with neglected: boring systems still need upgrades and care.
   - **Follow-ups:**
     - _When is a novel technology worth it?_ When it solves a real problem existing tools can't, the advantage is significant, and the team commits to learning and operating it.
     - _Doesn't boring tech hold back innovation?_ It frees capacity for innovation where it matters: in the product. Infrastructure novelty rarely wins customers.
     - _How do you retire a clever system?_ Document what it does, replace it incrementally with a standard approach, and verify behaviour with tests before removing it.
   - **Example:** A team replaced a custom-built distributed lock manager, written by an engineer who'd left, with Postgres advisory locks and leases. Throughput was more than enough, three lock-related incidents a quarter dropped to zero, and any engineer could now debug it.
   - **Sources:** [Dan McKinley: Choose boring technology](https://mcfunley.com/choose-boring-technology)
104. **How do I decide what not to build into a system?** [ref · Intermediate · Leadership, Architecture]
   - **Trap:** "Build everything in the requirements list to be safe." — _Why it fails:_ Every feature carries ongoing costs in maintenance, testing, support and failure modes. Unjustified features slow everything else. — _Probing:_ A requirement-or-risk test, a reversibility test, written non-goals. — _Say:_ "Build what the core use case and known risks require, keep cheap seams for likely needs, and write explicit non-goals with triggers for revisiting them."
   - **Thesis:** Tie every feature and component to a present requirement or a measured risk, defer what's cheap to add later, and write the non-goals down so the decision survives the next planning meeting. Saying no is a design activity, not an absence of one.
   - **60-second answer:** I'd sort candidate features into three groups. Must have now: needed for the core use case, legal or safety requirements, or protection against a known, costly risk. Cheap to add later: features whose absence doesn't lock in anything, like extra reports, more configuration, or another integration; these are deferred without guilt. Expensive to add later: things that shape data models, public APIs or security boundaries; these deserve discussion now, even if the decision is to keep a seam rather than build the feature. Then I'd write explicit non-goals in the design doc, such as 'we won't support multi-currency in v1' and 'we won't build our own notification system', so scope creep has to argue against a written decision. I'd also look at the cost side: every feature adds code to maintain, test surface, documentation, support load and failure modes, so 'nice to have' needs to be worth that ongoing cost.
   - **Key points:**
     1. **Requirement or risk test.** Each feature must trace to a current user need, legal requirement, or measured risk. 'Someone might want it' isn't enough.
     2. **Reversibility test.** Defer features that are cheap to add later; discuss now the ones that would force data model, API or security changes later.
     3. **Keep seams, not features.** For likely future needs, make the design not preclude them (an id format, a currency field) without building the feature.
     4. **Write non-goals.** Explicit non-goals in the design doc stop scope creep and make trade-offs visible to stakeholders.
     5. **Count the ongoing cost.** Maintenance, testing, documentation, support and operational load for every feature, forever.
     6. **Use evidence to add later.** Usage data, customer requests and incidents decide when a deferred feature becomes a requirement.
   - **When to choose what:** Build what the core use case and known risks require; keep cheap seams for likely needs; defer everything else with written non-goals and triggers for reconsideration.
   - **Numbers:**
     - Rough heuristic: the lifetime cost of a feature is often several times its build cost once maintenance, support and the drag on future changes are counted.
   - **Pitfalls:**
     - Building configurability for imagined future customers.
     - Deferring something that's expensive to retrofit (like multi-tenancy or audit logging in a regulated domain).
     - Non-goals not written down, so they're relitigated every month.
     - Saying no without explaining the trade-off, which damages trust with stakeholders.
   - **Follow-ups:**
     - _A stakeholder insists on a feature you think is unnecessary. What do you do?_ Ask for the underlying need and evidence, estimate the full cost, propose a cheaper way to meet the need or a trigger to revisit, and escalate to the product owner if needed.
     - _How do you decide what's expensive to add later?_ Anything that changes the shape of stored data, public APIs, security or tenancy boundaries, or requires migrating many clients.
     - _How do non-goals help later?_ They record why something was excluded, so future teams can tell whether circumstances have changed rather than guessing.
   - **Example:** For a new lending product, the team deferred co-borrower support, custom report builders and a partner API, but stored amounts with currency codes and kept applicant data in a structure that could hold multiple applicants. When co-borrowers were added a year later, no migration was needed.
   - **Sources:** [Martin Fowler: Yagni](https://martinfowler.com/bliki/Yagni.html)
105. **How do I design so that mistakes are cheap, not catastrophic?** [ref · Advanced · Reliability, Leadership]
   - **Trap:** "More code review and testing so mistakes don't happen." — _Why it fails:_ Mistakes will happen anyway. The question is about limiting blast radius and making undo fast. — _Probing:_ Progressive delivery, cells, reversible changes, guardrails on destructive actions, tested recovery. — _Say:_ "Assume mistakes: canary and progressive rollouts with automatic rollback, flags for instant off, cells to contain damage, deletion protection, and practised restores."
   - **Thesis:** Assume mistakes will happen and design so each one has a small blast radius and a fast undo: progressive rollouts, reversible changes, feature flags, cells or shards that contain failures, backups with tested restores, and guardrails on destructive operations.
   - **60-second answer:** People will deploy bugs, push bad config, run the wrong command and delete the wrong thing. The goal is to make each of those cheap. I'd limit blast radius: progressive rollouts that start with a canary, one cell or one region and expand only if metrics stay healthy, with automatic rollback; cell-based architecture so a bad change or overload affects a fraction of customers. I'd make changes reversible: backward-compatible schema changes, feature flags that turn new behaviour off without a deploy, config changes versioned and quickly revertible. I'd add guardrails on destructive operations: soft delete, deletion protection on databases and buckets, confirmation and peer approval for dangerous commands, and least-privilege access so one mistake can't touch everything. And I'd make recovery real: tested backups and point-in-time restore. Culturally, blameless postmortems make people report and fix near-misses instead of hiding them.
   - **Key points:**
     1. **Progressive delivery.** Canary, then a small percentage, then wider, with automated health checks and rollback. Most bad changes are caught at a few percent of traffic.
     2. **Cells and blast-radius limits.** Partition customers into independent cells; deploy and configure one cell at a time so failures stay contained.
     3. **Reversible changes.** Backward-compatible migrations, feature flags, and versioned config with one-step revert.
     4. **Guardrails on destructive actions.** Deletion protection, soft delete, required approvals, dry-run modes, and rate limits on bulk operations.
     5. **Least privilege.** Narrow permissions and separate production credentials so one mistake or compromised account can't affect everything.
     6. **Tested recovery.** Point-in-time recovery, backups in an isolated account, and regular restore drills.
     7. **Blameless learning.** Postmortems focus on how the system allowed the mistake, leading to better guardrails rather than blame.
   - **When to choose what:** Invest first in fast rollback and progressive delivery (they catch the most common mistakes), then guardrails on destructive operations, then cell isolation as scale and risk grow.
   - **Numbers:**
     - Rollout example: 1% for 15 minutes, 10% for 30 minutes, 50% for 30 minutes, then 100%, with automatic rollback if error rate rises by more than a set threshold at any stage.
     - Cell math: with 20 cells, a bad change caught in the first cell affects about 5% of customers.
   - **Pitfalls:**
     - Global config pushes that apply everywhere at once.
     - Rollbacks that are possible in theory but never practised.
     - Production databases without deletion protection or point-in-time recovery.
     - Blame culture, so near-misses go unreported.
   - **Follow-ups:**
     - _How do you make config changes as safe as code deploys?_ Store config in version control, validate it in CI, roll it out progressively, and monitor and revert it like code.
     - _What's the most valuable guardrail to add first?_ Fast, practised rollback for deploys and config, because bad changes cause a large share of incidents.
     - _How do cells differ from shards?_ Cells are complete, independent copies of the service stack serving a subset of customers, so a failure or bad deploy in one doesn't spread; shards usually partition only the data.
   - **Example:** A bad fee-calculation rule was deployed behind a flag to 2% of loans. Automated checks comparing fees with the previous version flagged anomalies within 10 minutes; the flag was turned off, 140 loans were corrected by a script, and no customer was charged incorrectly.
   - **Sources:** [AWS Builders' Library: Automating safe, hands-off deployments](https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/); [Google SRE book: Postmortem culture](https://sre.google/sre-book/postmortem-culture/)

### Design docs & ownership
106. **Write a design doc that is still useful in three years.** [mine + ref · Advanced · Leadership]
   - **Trap:** A detailed doc with class diagrams and implementation specifics. — _Why it fails:_ Implementation details go stale fast and the code already shows them. What future readers need is why. — _Probing:_ Context, constraints, alternatives considered, non-goals, decision records. — _Say:_ "Context and constraints, goals and non-goals, alternatives with honest trade-offs, and the decision with reasons, plus ADRs linked as things change. Reasons age better than diagrams."
   - **Thesis:** Write down what will still matter when the code has changed: the context and constraints, the goals and non-goals, the alternatives considered, and the decisions with their reasons. Reasons age well; diagrams and implementation details don't. Date it, keep it short, and link decisions to follow-up records as things change.
   - **60-second answer:** In three years, nobody will need the class diagram, because the code shows that. They'll need to know why: what problem we were solving, which constraints we had, such as team size, deadline, regulation or traffic, which options we considered and why we rejected them, and what we explicitly chose not to do. So I'd structure the doc as context, goals and non-goals, the proposed design at the level of components and data flows, alternatives considered with honest trade-offs, risks and open questions, and a decision record. I'd keep diagrams simple and high-level so they stay true longer. The doc gets a date, an author and a status. When decisions change later, I'd add short architecture decision records that link back, rather than silently editing history, so the trail of reasoning survives. And I'd store it next to the code or in a searchable place people actually look.
   - **Key points:**
     1. **Context and constraints.** The problem, the users, and the forces at the time: scale, deadline, team, regulation. Future readers judge the decision against these.
     2. **Goals and non-goals.** What success means and what was deliberately excluded. Non-goals prevent future readers from assuming omissions were oversights.
     3. **Design at the right altitude.** Components, data ownership, flows and key interfaces. Skip details that the code expresses better and that will change quickly.
     4. **Alternatives considered.** Two or three real options with trade-offs, including why the chosen one won. This is the most valuable section later.
     5. **Risks and open questions.** Known weaknesses and assumptions, so future teams know what to watch and what might have changed.
     6. **Dated, owned, with status.** Draft, approved, superseded. A reader should know immediately whether it's current.
     7. **Decision records for changes.** Short ADRs for later decisions, linked from the original doc, preserve the reasoning trail without rewriting history.
   - **When to choose what:** Design docs for significant or hard-to-reverse decisions; ADRs for smaller decisions and changes. Store them where the code lives or in a well-indexed repository.
   - **Numbers:**
     - Length guide: most design docs are clearer at a handful of pages; if it's much longer, split decisions into separate ADRs or appendices.
   - **Pitfalls:**
     - Docs that describe implementation details already in the code.
     - No alternatives section, so readers can't tell whether options were considered.
     - Editing the original doc to match current reality, losing the history of why.
     - Docs stored where nobody can find them.
   - **Follow-ups:**
     - _How do you keep docs from going stale?_ Don't try to keep them current in detail; mark status, link superseding ADRs, and keep living reference docs (runbooks, API docs) separate.
     - _What's an ADR?_ A short record of one decision: context, decision, status and consequences. Michael Nygard popularised the format.
     - _Who should review a design doc?_ People who will build it, operate it, depend on it, and someone outside the team for a fresh view on assumptions.
   - **Example:** A 2023 doc explaining why the team chose a single Postgres instance over a distributed database (team of five, 2,000 writes/s peak, regulator-mandated simplicity) saved a later team weeks of debate: they saw the constraints had changed, wrote an ADR superseding it, and moved to partitioning with the original reasoning as a baseline.
   - **Sources:** [Michael Nygard: Documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions); [ADR GitHub organisation: Architecture decision records](https://adr.github.io/)
   - _Also asked as:_ How do I write a design doc that survives 3 years of evolution?
107. **How do I design systems that can be owned by teams, not heroes?** [ref · Advanced · Leadership, Operations]
   - **Trap:** "Our best engineer owns it and is always available." — _Why it fails:_ A hero is a single point of failure and a sign the system isn't operable by the team. — _Probing:_ Clear ownership, runbooks, shared on-call, boring technology, removing hero dependencies. — _Say:_ "One owning team, runbooks and decision records, a shared sustainable rotation, and I track who gets pulled into incidents so we can spread that knowledge."
   - **Thesis:** A system is team-owned when anyone on the rotation can understand, operate and change it: clear ownership boundaries, documented runbooks and design records, shared on-call, boring technology, and no component that only one person can fix. Hero dependence is a design flaw, not a staffing detail.
   - **60-second answer:** I'd start with ownership: every service, job and data store has one owning team, recorded in a catalogue used for alerts and reviews, with boundaries matching team boundaries so a team can change its system without coordinating with five others. Then make knowledge transferable: runbooks for every alert, design docs and decision records for the why, and onboarding that includes doing real operational tasks. On-call is shared by the whole team on a sustainable rotation, which spreads knowledge and makes pain visible to everyone, motivating fixes. Technology choices favour things many people already know. And I'd actively look for heroes: if one person is always pulled into incidents for a component, that's a risk to fix with pairing, documentation and simplification, not a person to praise and rely on. Measure it: can someone new to the team handle a typical incident with the runbook alone?
   - **Key points:**
     1. **Single, clear owner.** Every component owned by one team in a service catalogue, linked to alerts, dashboards and docs.
     2. **Boundaries match teams.** Systems divided so each team can change and deploy its part independently, reducing coordination and diffusion of responsibility.
     3. **Runbooks and decision records.** Operational knowledge and design reasoning written down where the team can find them.
     4. **Shared on-call.** The whole team rotates, sustainably. Knowledge spreads, and the people who build the system feel its operational pain.
     5. **Boring, familiar technology.** Fewer specialised components means fewer specialists required.
     6. **Find and remove hero dependencies.** Track who gets pulled into incidents; pair, document and simplify until others can handle those components.
     7. **Test it.** Game days and onboarding tasks where newer team members handle realistic incidents using only docs and tools.
   - **When to choose what:** Make ownership, documentation and shared on-call explicit requirements for production readiness. Treat a bus factor of one on a critical component as a risk with an owner and a deadline.
   - **Numbers:**
     - On-call sustainability guide: rotations of at least several people (Google's SRE book suggests a minimum of around eight for a single-site 24/7 rotation) so on-call doesn't burn people out.
   - **Pitfalls:**
     - Components 'owned' by everyone, meaning no one.
     - Rewarding heroics in incidents instead of fixing what made heroics necessary.
     - On-call only for a few senior engineers.
     - Documentation written once at launch and never updated.
   - **Follow-ups:**
     - _A key engineer is the only one who understands the billing engine. What do you do?_ Schedule pairing and shadowing, have others lead the next changes and incidents with their support, write runbooks from their knowledge, and simplify the scariest parts.
     - _How do you assign ownership for shared libraries or platforms?_ A platform team owns them as products, with clear support channels and versioning; consuming teams own their use of them.
     - _How do you know ownership is working?_ Incidents are resolved by whoever is on call, without escalation to specific individuals, and changes ship without cross-team coordination.
   - **Example:** Incident data showed one engineer joined 70% of payment incidents. Over a quarter, the team wrote runbooks from their knowledge, paired on every payment change, and had others lead game days. The next two payment incidents were resolved by on-call engineers alone.
   - **Sources:** [Google SRE book: Being on-call](https://sre.google/sre-book/being-on-call/); [Team Topologies: Key concepts](https://teamtopologies.com/key-concepts)

## Domain Traps (0)

### Fintech & lending

### Adtech

### E-commerce & marketplaces

### Ride-hailing & delivery

### Supply chain & logistics

### Edtech

### Media & streaming

### Social & messaging

### Travel & booking

### SaaS & B2B

### Gaming

### Healthcare
