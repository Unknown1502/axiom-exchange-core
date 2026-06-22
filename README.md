# AXIOM

**A distributed exchange core that guarantees exactly-once trade execution and one strongly consistent ledger of truth — built on Amazon Aurora DSQL.**

AXIOM is an order-matching and settlement engine for emerging trading venues
(crypto exchanges, prediction markets, alternative trading systems) that need
the correctness guarantees of legacy proprietary matching engines without the
enterprise price tag. Its entire thesis is **correctness under concurrency**:
one match, one settlement, no double-execution — even under a burst of duplicate
or retried orders, the exact failure that cost Knight Capital ~$440M in 2012.

---

## Why Aurora DSQL

A matching engine has two needs that historically forced a trade-off:

1. **Serializable correctness** for order-book state changes (a match must be
   atomic and conflict-free), and
2. **Low-latency, strongly-consistent access** across regions.

Aurora DSQL is the rare database that provides both. AXIOM relies on two of its
properties directly:

- **Optimistic concurrency control (OCC).** DSQL is lock-free and validates
  transactions at commit. Two transactions that touch the same order row cannot
  both win — the later committer is rejected with `SQLSTATE 40001` and retried.
  This is what makes double-execution structurally impossible.
- **A database-enforced `UNIQUE(idempotency_key)` constraint.** A retried or
  duplicated order submission cannot be inserted twice. This is the literal
  Knight Capital safeguard — enforced by the database, not by fallible app code.

> **Important engineering note.** Aurora DSQL does **not** support
> `SERIALIZABLE` isolation, `SELECT ... FOR UPDATE` locking, or foreign keys.
> AXIOM is built to DSQL's real concurrency model (REPEATABLE READ + OCC), not
> to a textbook Postgres assumption. See
> [docs/architecture/concurrency-model.md](docs/architecture/concurrency-model.md)
> and [ADR-001](docs/architecture/decision-records/ADR-001-aurora-dsql-occ-model.md).

---

## Architecture

```
[Order Entry UI]  →  [Next.js route handlers]  →  [Intake API (Fastify)]
 Next.js dashboard      same-origin proxy          region tag · idempotency
                                                          │            │
                                                          ▼            ▼
                                          [Aurora DSQL]      [DynamoDB: order_events]
                                          matching tx in     (firehose / audit log,
                                          ONE OCC retry      fire-and-forget)
                                                 │
                                                 ▼
                                    [Aurora DSQL: order_book + trades]
                                                 │
                                                 ▼
                        [Live dashboard: order book · trade tape · ledger]
```

| Store / layer | Role |
|---------------|------|
| **Aurora DSQL** | Order book + settlement ledger. The single source of truth, strongly consistent. |
| **DynamoDB** | High-throughput order-event firehose / audit log. |
| **Next.js on Vercel** | Dashboard + same-origin API proxy (`/api/orders`, `/api/book`, `/api/trades`, `/api/events`). |
| **Fastify intake API** | Region tagging, idempotency handling, matching, and read projections for the dashboard. |

Regions (`us` / `eu` / `apac`) are simulated via a labeled `X-Region` request
header, not a live multi-region deployment. The full data-flow diagram is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); rendered images live at
[docs/architecture-diagram.svg](docs/architecture-diagram.svg) /
[`.png`](docs/architecture-diagram.png).

---

## Repository layout

```
packages/
  shared-types/      Domain vocabulary: enums, Zod validators, fixed-point decimal, typed errors
  database/          Connection pool, OCC retry runner, migration system (DSQL-aware)
  matching-engine/   The matching transaction — the ONLY writer of the trades ledger
  dynamodb-client/   order_events firehose: table setup + fire-and-forget event writers
  intake-api/        Fastify server: region tagging, idempotency, matching, read projections
apps/
  web/               Next.js 15 dashboard + same-origin API proxy (order book, trade tape, ledger, Knight Capital Mode)
tests/
  concurrency/       The correctness proofs (50 conflicting orders; 50 duplicate submissions)
  global-setup.ts    Reuses a reachable Postgres or auto-starts an embedded one (no Docker required)
scripts/
  provision-aws.ts   Provision the Aurora DSQL cluster + DynamoDB table via the AWS SDK
  migrate-dsql.ts    Apply migrations to the live DSQL cluster (CREATE INDEX ASYNC)
  aws-proof.ts       Print live AWS resource details for submission evidence
  seed-demo-data.ts  Seed a clean resting book for the demo
  load-test-intake.ts / verify-knight-capital.ts   Load + Knight Capital proofs
docs/
  ARCHITECTURE.md · DEMO.md · SUBMISSION.md         Top-level system, demo, submission docs
  architecture/      Concurrency model, database design, event flow, ADRs
  operations/        Deployment & operations runbook
```

Each package's responsibilities are justified in
[docs/architecture/database-design.md](docs/architecture/database-design.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quickstart (local proof)

Requires **Node 22+**. Docker is optional — if no Postgres is reachable at
`DATABASE_URL`, the test suite auto-starts an embedded PostgreSQL, so `npm test`
runs the correctness proofs with zero infrastructure.

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env        # defaults already target the local database

# 3. Run the concurrency proofs (starts an embedded Postgres if none is running)
npm test
```

The concurrency suite fires 50 simultaneous conflicting orders at the matching
transaction and asserts the book never goes negative and nothing is
double-filled, then fires 50 duplicate submissions and asserts exactly one is
accepted. See [tests/concurrency/](tests/concurrency/).

### Run the full stack (dashboard + API)

```bash
npm run db:up               # PostgreSQL 16 (55432) + DynamoDB Local (8000)
npm run db:migrate          # apply schema
npm run dynamo:setup        # create the order_events table locally
npm run api:start &         # Fastify intake API on :3001
npm run dev -w @axiom/web   # dashboard on :3000
npm run seed                # optional: resting liquidity for the demo
```

Then open `http://localhost:3000`. Reproduce the headline numbers with
`npm run loadtest` (200-order burst) and `npm run verify:knight` (Knight Capital
Mode, 5/5 runs). The full demo walkthrough is in [docs/DEMO.md](docs/DEMO.md).

Deploying to real Aurora DSQL / DynamoDB / Vercel — including the AWS-SDK
provisioning scripts — is documented in
[docs/operations/deploy.md](docs/operations/deploy.md).

---

## Project status

All layers are built and verified end-to-end: the matching engine + concurrency
proof (the load-bearing deliverable), the Fastify intake API, the DynamoDB
firehose, and the Next.js dashboard with Knight Capital Mode. A live Aurora DSQL
cluster and `order_events` DynamoDB table are provisioned in `us-east-1`
(`npm run aws:proof` prints their live status).

See [docs/architecture/](docs/architecture/) for the design rationale and
[docs/SUBMISSION.md](docs/SUBMISSION.md) for the submission summary.
