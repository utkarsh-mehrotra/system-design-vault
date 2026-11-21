# Coverage map

Generated from coverage.json by scripts/build.mjs. 151 concepts, 187 cards.

## Scale & traffic

| Concept | Cards |
|---|---|
| Request path and latency budget | Walk one request from DNS to the database and back. Where does each millisecond go?<br>Size a system for 50,000 requests per second with a 100 ms hard deadline. |
| Back-of-envelope estimation | Estimate QPS, storage and bandwidth from daily active users. What are the common estimation traps?<br>Size a system for 50,000 requests per second with a 100 ms hard deadline. |
| Vertical vs horizontal scaling | What are the trade-offs between vertical and horizontal scaling?<br>Read traffic grows 10x in one quarter. What do you change first, and what do you refuse to change? |
| Load balancing algorithms and long-lived connections | Choose a load balancing strategy for long-lived connections versus short RPCs. |
| Admission control and load shedding | Design admission control so a service stays up through a 20x spike.<br>The original trigger is gone, but the system stays down. What's happening, and how do you get out of it? |
| Backpressure and bounded queues | How do I design for backpressure in a high-traffic system? |
| Sync vs async communication | How do I choose between synchronous and asynchronous communication?<br>Event-driven or request-response for order placement? Decide and defend it. |
| Queues vs RPC | When should I use a queue versus direct RPC? |
| Monolith vs microservices | When does splitting a monolith pay for itself?<br>Draw service boundaries for a lending platform: origination, underwriting, servicing, collections. |
| Autoscaling | Autoscaling is enabled, yet the service still falls over during spikes. Why?<br>You moved an API to serverless functions and the relational database started failing under load. What went wrong? |
| Tail latency | p50 is flat but p99 doubled. How do you debug it?<br>One request fans out to five services and two fail. What do you return? |

## Data & storage

| Concept | Cards |
|---|---|
| SQL vs NoSQL vs search | How do I decide between SQL, NoSQL, and search engines? |
| OLTP vs OLAP and CDC | Where is the boundary between OLTP and OLAP, and how does data cross it?<br>How do I model data differently for OLTP versus OLAP workloads? |
| Partition key design | Pick a partition key for a multi-tenant ledger, then show how it fails.<br>How do I shard data by user, tenant, region, or something else? |
| Hot partitions and skew | A hot partition shows up at 2 a.m. Diagnose it and fix it without downtime.<br>What is my caching story for hot keys and large objects? |
| Secondary indexes in sharded stores | Your data is sharded by user id, but you need to query by email or by order status. How do secondary indexes work in a sharded store? |
| Indexing and write amplification | Design indexes for a table that takes 90 percent writes. |
| Isolation levels and anomalies | Your database runs at read committed. Which bugs can that cause, and when do you need something stronger? |
| Optimistic vs pessimistic concurrency | Optimistic or pessimistic concurrency control: how do you choose, and what breaks with each? |
| Replication topologies | Leader-follower, multi-leader or leaderless replication: what does each cost you, and which would you pick?<br>Give users read-your-writes when reads are served from replicas. |
| Zero-downtime migrations | Migrate a billion-row table to a new schema with zero downtime.<br>How do I do schema changes without downtime? |
| Backfills | How do I safely backfill data in production? |
| Retention, soft delete and erasure | Design retention, soft delete and legal erasure so they do not contradict each other. |
| Multi-tenant isolation | How do I handle multi-tenant data isolation?<br>Enterprise customers each want custom fields, workflows and rules. How do you support customisation without forking the product? |
| Large object storage and uploads | Design uploads of multi-gigabyte files from users with unreliable connections. |
| Probabilistic data structures | Count unique visitors and top-K items across billions of events per day. Do you need exact answers? |
| Geospatial indexing | Find the nearest drivers, stores or users to a location quickly. How do you index location data?<br>Hundreds of thousands of drivers send GPS updates every few seconds. How do you ingest, store and serve them? |
| Vector indexes | Choose and size a vector index for 100 million embeddings. What trade-offs matter? |
| Pagination | How do I design pagination for massive datasets efficiently? |

## Caching

| Concept | Cards |
|---|---|
| Cache placement (client, edge, service, DB) | Where should I cache: client, edge, service, or DB layer? |
| Write strategies | How do I pick between write-through, write-back, and write-around caching? |
| Invalidation and TTLs | How do I design cache invalidation rules that do not become a nightmare? |
| Stampedes and thundering herds | How do I handle cache stampede and thundering herd? |
| Cache failure and fall-through | Your Redis cache cluster goes down at peak. What happens, and how should the system behave? |
| Eviction and sizing | How do you size a cache and choose an eviction policy? |
| Measuring cache value | How do I measure whether a cache is actually helping? |
| CDN and streaming delivery | Deliver video to millions of viewers, on-demand and live, with smooth playback. How do adaptive bitrate and CDNs fit together? |
| Caching LLM outputs | Can you cache LLM responses? What about semantic caching? |

## Consistency & transactions

| Concept | Cards |
|---|---|
| Consistency models | How do I model consistency levels across services and data stores?<br>Where is eventual consistency acceptable in a payments flow, and where is it never acceptable? |
| CAP and PACELC | How do I reason about CAP trade-offs for a given product requirement? |
| Read-your-writes and session guarantees | Give users read-your-writes when reads are served from replicas. |
| Idempotency | Build idempotency for a write API that clients and your own gateway can both retry.<br>Design a bulk API that creates 10,000 records in one request. What happens when some of them fail? |
| Sagas and compensation | Replace a two-phase commit across three services. |
| Outbox and inbox | How do I design an outbox and inbox pattern for reliable events? |
| Reconciliation | How do I reconcile divergent data across systems?<br>You integrate with dozens of carriers and suppliers via APIs, files and EDI. How do you keep data flowing and correct? |
| Distributed ID generation | Generate unique IDs across regions without a central counter. |
| Consensus, quorums and gossip | Where do Raft, Paxos, quorums and gossip appear in a system you would really build? |
| Distributed locks and fencing | You need a distributed lock so only one worker processes a job. How do you make it actually safe? |
| Clocks and ordering | Can you use timestamps to order events or resolve conflicts across machines?<br>Warehouse scanners and delivery devices go offline, then upload events hours later and out of order. How do you keep shipment state correct? |
| Inventory reservation and holds | A flash sale has 1,000 units and 500,000 people trying to buy at once. How do you never oversell?<br>Design hotel or seat booking so the same room or seat is never sold twice, including while the customer is paying.<br>Show customers accurate stock and delivery promises when inventory sits across many warehouses and stores. |
| Ledgers and double entry | Design a ledger for a payments or lending product. Why double-entry, and what invariants must it enforce? |
| Event sourcing and CQRS | When is event sourcing with CQRS the right call, and when is it a trap? |
| Offline sync and convergence | Learners use the app offline on multiple devices. How do you sync progress and grades without losing or corrupting data?<br>Warehouse scanners and delivery devices go offline, then upload events hours later and out of order. How do you keep shipment state correct? |

## Reliability

| Concept | Cards |
|---|---|
| Failure modes and cascading failure | List the ways a three-tier service fails under real load before drawing any boxes.<br>The original trigger is gone, but the system stays down. What's happening, and how do you get out of it? |
| Graceful degradation | How do I design for graceful degradation instead of hard failure?<br>One request fans out to five services and two fail. What do you return? |
| Retries, backoff and budgets | Retries are amplifying an outage. Design retries that do not. |
| Timeouts, circuit breakers and bulkheads | Choose and size circuit breakers, bulkheads and timeouts. |
| Dependencies with weaker SLAs | Your service promises 99.95%, but a critical third-party provider offers only 99.5%. How do you design around it?<br>Your product depends on an external LLM API. How do you handle rate limits, outages and slow responses? |
| Multi-region failover and split brain | Fail over between two regions without split brain. |
| Zone and region outages | How do I design for data center outage scenarios?<br>Leadership wants active-active multi-region. What does it really cost, and when isn't it worth it? |
| Rollback safety | Plan a rollback for a release that has already migrated data. |
| SLOs and error budgets | Define SLOs for a lending platform and derive alerts from the error budget. |
| Backups and disaster recovery | How do I make rebuild from scratch possible if everything is lost? |
| Health checks | Design health checks for a service. What should liveness and readiness actually check? |
| Graceful shutdown and draining | Every deploy causes a small spike of errors. How do you shut instances down gracefully? |
| Blast radius and cells | How do I design so that mistakes are cheap, not catastrophic?<br>A one-line config change took down every region. How should dynamic configuration be rolled out? |

## Streaming & async

| Concept | Cards |
|---|---|
| Delivery semantics and exactly-once | Exactly-once in practice: what do Kafka and Flink give you, and what do you still own? |
| Poison messages and DLQs | A poison message blocks a partition. Design the handling.<br>How do I design dead-letter queues and retry policies? |
| Ordering with parallelism | Keep ordering when you also need parallelism. |
| Partitions and consumer rebalancing | How many Kafka partitions should a topic have, and why do consumer rebalances keep stalling processing? |
| Delayed job scheduling | Design a scheduler for millions of delayed jobs a day. |
| Long-running job status | How do I track the status of long-running jobs for users? |
| Fan-out and fan-in | How do I design a fan-out and fan-in pipeline for heavy computations?<br>Design a home feed: fan-out on write or on read? What about users with millions of followers? |
| Event schema evolution | Evolve an event schema without breaking consumers. |
| Outgoing webhooks | Design outgoing webhooks to customers' endpoints. What happens when their endpoint is slow or down? |
| Windows, watermarks and late data | Compute per-minute metrics from a stream where events arrive late and out of order. How do windows and watermarks work? |
| Media processing pipelines | Design the pipeline that turns uploaded videos into streamable formats at scale. |

## APIs & boundaries

| Concept | Cards |
|---|---|
| Service boundaries | Draw service boundaries for a lending platform: origination, underwriting, servicing, collections. |
| API gateways and BFFs | Design a gateway that can evolve independently of the services behind it. |
| API versioning | Version a public API when you cannot force clients to upgrade. |
| Deprecation | Deprecate an endpoint safely. |
| Backward compatibility | How do I design for backward compatibility with older clients?<br>How do I design for backward compatibility when schemas change?<br>How do I handle breaking change scenarios with minimal disruption? |
| Rate limiting and quotas | Design per-tenant rate limits that do not punish well-behaved bursty clients. |
| REST vs gRPC vs GraphQL | REST, gRPC or GraphQL: how do you choose for a given API? |
| Real-time delivery (SSE, WebSockets) | Push updates to clients in real time: polling, long polling, server-sent events or WebSockets?<br>Show who's online for millions of users. Why is presence harder than it looks? |
| Bulk APIs and partial success | Design a bulk API that creates 10,000 records in one request. What happens when some of them fail? |

## Security & identity

| Concept | Cards |
|---|---|
| Sessions, JWTs and revocation | Sessions or JWTs for authentication? How do you log a user out everywhere or revoke a stolen token? |
| Authorisation and IDOR | Design authorisation for a multi-tenant API. How do you stop users accessing other people's resources? |
| Service-to-service auth and zero trust | How should internal services authenticate and authorise calls to each other? |
| Secrets management | How do you manage secrets, and rotate a database password or API key without downtime? |
| Encryption and key management | "Is the data encrypted?" What does a real answer about encryption at rest, in transit and key management look like? |
| Tokenisation and compliance scope | How do you handle card numbers and other highly sensitive data without putting your whole platform in compliance scope? |
| Account takeover defence | Attackers are trying millions of leaked passwords against your login. How do you protect accounts without locking out real users? |
| Audit logging | Design an audit log that auditors, security and support can trust.<br>Design access to patient health records with consent, least privilege and a full audit trail. |
| Emergency and privileged access | In an emergency, a clinician needs records they don't normally have access to. How do you design break-glass access? |
| LLM prompt injection | Your LLM feature can call tools and read user content. How do you defend against prompt injection and abuse? |
| Fraud and abuse detection | Fake listings and fake reviews are hurting trust in your marketplace. How do you design fraud detection?<br>Design content moderation for user posts, images and messages at scale. |

## Observability & operations

| Concept | Cards |
|---|---|
| Logging | What should each layer log, and what must never be logged? |
| Distributed tracing and sampling | Trace a request across 50 services without a runaway bill. |
| Alerting on symptoms | Alert on user pain, not on noise. |
| Metrics (RED, USE) | How do I design metrics that actually tell me system health? |
| Incident dashboards | How do I design dashboards that help during incidents? |
| Chaos and game days | Rehearse failure before production does it for you. |
| Runbooks | Write a runbook the on-call engineer can follow at 3 a.m. |
| Incident command | You're incident commander for a major outage. What do you do in the first 15 minutes?<br>Your change caused a production incident. What do you do and say, during and after? |

## Delivery & infrastructure

| Concept | Cards |
|---|---|
| Deployment strategies | Blue-green, canary or rolling deploys: what does each protect you from, and what doesn't it? |
| Configuration safety | A one-line config change took down every region. How should dynamic configuration be rolled out? |
| Serverless trade-offs | You moved an API to serverless functions and the relational database started failing under load. What went wrong? |
| Active-active economics | Leadership wants active-active multi-region. What does it really cost, and when isn't it worth it? |
| Cost visibility | How do I design for cost visibility and optimization from day one? |

## AI & LLM systems

| Concept | Cards |
|---|---|
| RAG design | Design retrieval-augmented generation (RAG) over company documents. Where does it usually go wrong? |
| LLM latency and cost | Your LLM feature is slow and expensive. How do you reduce latency and cost? |
| LLM evaluation and rollouts | How do you safely change a prompt or upgrade the model behind an LLM feature? |
| LLM provider limits and fallback | Your product depends on an external LLM API. How do you handle rate limits, outages and slow responses? |

## Evolution & judgment

| Concept | Cards |
|---|---|
| MVP-first design | How do I design something MVP-first that can still grow? |
| Platform vs one-off | How do I choose between building a platform and a one-off service? |
| Build vs buy | Decide what to buy and what to build. |
| Extensibility for many teams | How do I design systems that multiple teams can safely extend?<br>Enterprise customers each want custom fields, workflows and rules. How do you support customisation without forking the product? |
| Data residency | How do I plan for data residency and regional regulations? |
| Experiments and feature flags | How do I design to support experiments such as A/B tests and flags cleanly? |
| Legacy migration (strangler) | How do I design migration paths when the legacy system cannot just die?<br>You need 15 teams to migrate off a deprecated platform, and you don't manage any of them. How do you drive it? |
| Defending trade-offs | Defend a design trade-off to a skeptical architect in five minutes.<br>A VP wants a launch in six weeks with a design you believe is risky. How do you push back? |
| Design reviews | Review a peer's design deeply and still be easy to work with. |
| Explaining designs | How do I explain my design to a junior developer so they truly get it? |
| Over- and under-engineering | How do you tell when a design is over-engineered?<br>How do you tell when a design is dangerously under-engineered? |
| Simplification | How do I simplify a complex design without losing guarantees?<br>How do I design for boring reliability instead of cleverness? |
| Scope and non-goals | How do I decide what not to build into a system? |
| Design docs and ADRs | Write a design doc that is still useful in three years. |
| Team ownership | How do I design systems that can be owned by teams, not heroes? |
| Tech debt prioritisation | How do you get tech debt prioritised against feature work? |
| Standards vs local choice | One team wants a different database or framework that suits them better. When do you standardise, and when do you allow local choices? |
| Measuring architecture outcomes | You led a major architecture change. How do you prove it worked? |

## Domains

| Concept | Cards |
|---|---|
| Fintech: payments lifecycle | Integrate a card payment provider: authorise, capture, refund, with webhooks. What does your payment state machine look like?<br>Design refunds, reversals and chargebacks. What makes them harder than the original payment? |
| Fintech: money representation | How do you represent money, rounding and multiple currencies correctly? |
| Fintech: interest and end of day | Design daily interest accrual and end-of-day processing for millions of loans. |
| Fintech: KYC and AML | Design KYC onboarding and ongoing AML monitoring for a fintech. |
| Adtech: real-time bidding | Design a real-time bidder that must respond to ad auctions within about 100 ms at very high request rates. |
| Adtech: budgets and frequency caps | Thousands of bidders spend from the same campaign budget. How do you pace spend and avoid overspending?<br>Enforce "show this ad to a user at most 3 times a day" across billions of impressions. |
| Adtech: measurement and attribution | Count impressions and clicks for billing, filter fraud, and attribute conversions that happen days later. |
| E-commerce: checkout and promotions | The cart showed one price, checkout charged another, and a single-use coupon was used twice. How do you design checkout and promotions? |
| E-commerce: catalogue search freshness | Search results show products that are out of stock or have the wrong price. How do you keep catalogue search fresh? |
| Marketplaces: payouts and fraud | A marketplace takes payment from buyers and pays out to many sellers, minus fees. How do you design split payments and payouts?<br>Fake listings and fake reviews are hurting trust in your marketplace. How do you design fraud detection? |
| Ride-hailing: dispatch, location and pricing | Match riders to drivers (or orders to couriers) in real time, including when demand far exceeds supply.<br>Hundreds of thousands of drivers send GPS updates every few seconds. How do you ingest, store and serve them?<br>Design surge pricing and ETA estimates. How do you keep them fast, fair and consistent with what the customer is charged? |
| Supply chain: inventory, edge events, partners, routing | Show customers accurate stock and delivery promises when inventory sits across many warehouses and stores.<br>Warehouse scanners and delivery devices go offline, then upload events hours later and out of order. How do you keep shipment state correct?<br>You integrate with dozens of carriers and suppliers via APIs, files and EDI. How do you keep data flowing and correct?<br>Plan delivery routes for thousands of drivers each day, and adjust when things change during the day. |
| Edtech: deadlines, exams, live classes, offline | Thousands of students submit an exam or assignment in the last minute before the deadline. How do you make sure no submission is lost?<br>Run timed online exams fairly: enforce time limits, randomise questions and resist cheating.<br>Design live online classes with interactive video for small groups and lectures for thousands.<br>Learners use the app offline on multiple devices. How do you sync progress and grades without losing or corrupting data? |
| Media: transcoding, delivery, counting | Design the pipeline that turns uploaded videos into streamable formats at scale.<br>Deliver video to millions of viewers, on-demand and live, with smooth playback. How do adaptive bitrate and CDNs fit together?<br>Count views for billions of videos and compute 'trending now'. How do you keep it accurate, fast and resistant to manipulation? |
| Social: chat, presence, moderation, feeds | Design a chat system with correct message order, delivery and read receipts, across multiple devices per user.<br>Show who's online for millions of users. Why is presence harder than it looks?<br>Design content moderation for user posts, images and messages at scale.<br>Design a home feed: fan-out on write or on read? What about users with millions of followers? |
| Travel: holds, external inventory, overbooking | Design hotel or seat booking so the same room or seat is never sold twice, including while the customer is paying.<br>Prices and availability come from slow, rate-limited external suppliers. How do you show fast search results without selling at wrong prices?<br>Airlines and hotels deliberately overbook. How do you design a system that allows controlled overbooking? |
| SaaS: metering and customisation | Design usage-based billing: meter API calls, compute or storage per customer, and invoice accurately.<br>Enterprise customers each want custom fields, workflows and rules. How do you support customisation without forking the product? |
| Gaming: state sync, leaderboards, matchmaking | Synchronise game state for a fast-paced multiplayer game. How do you keep it responsive and fair?<br>Build global, regional and friends leaderboards for millions of players with real-time rank lookups.<br>Design matchmaking that creates fair games quickly for millions of players. |
| Healthcare: consent, interoperability, break-glass | Design access to patient health records with consent, least privilege and a full audit trail.<br>Exchange patient data with hospitals, labs and other systems. How do you design for interoperability?<br>In an emergency, a clinician needs records they don't normally have access to. How do you design break-glass access? |

## Deliberately out of scope

- Internals of specific technologies (Postgres MVCC and vacuum, Kafka ISR and acks, DynamoDB internals): covered only where a card's trap depends on them
- Low-level networking (TCP tuning, HTTP/2 head-of-line details) beyond the request-path card
- Full end-to-end 'design X' case studies: covered by Educative, ByteByteGo and Hello Interview
- Batch data platform engineering (ETL orchestration, data quality frameworks) beyond OLTP/OLAP, backfills and streaming windows
- ML training infrastructure and feature stores; AI coverage focuses on LLM application traps
