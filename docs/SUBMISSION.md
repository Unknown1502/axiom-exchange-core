# AXIOM — Submission

> H0: Hack the Zero Stack · Track 2 (Monetizable B2B — Finance)
> Fill the bracketed `[…]` placeholders before submitting.

## What AXIOM is

AXIOM is a distributed exchange core — an order-matching and settlement engine
that guarantees **exactly-once trade execution** and one strongly-consistent
ledger of truth, even across regions and even under a burst of duplicate or
retried order submissions. It is the load-bearing piece of an exchange:
"one match, one settlement, no matter what failed mid-flight."

## The problem (real, not hypothetical)

In August 2012, a deployment error at Knight Capital caused repeated duplicate
order submission with no database-level safeguard against double execution. The
firm lost ~$440 million in 45 minutes. As trading infrastructure goes
multi-region — for latency, disaster recovery, or data residency — "exactly one
match, exactly one settlement" gets *harder*, not easier.

## Why Aurora DSQL (this is the core of the submission)

A matching engine cannot accept either side of the classic distributed
trade-off: it needs serializable-grade correctness for order-book mutations
**and** low-latency, strongly-consistent access across regions. Aurora DSQL
delivers both through optimistic concurrency control: lock-free transactions
validated at commit, where two transactions touching the same order row cannot
both succeed (the loser gets `SQLSTATE 40001` and retries). Paired with a
database-enforced `UNIQUE(idempotency_key)` constraint, **duplicate execution
becomes structurally impossible — enforced by the database, not by application
logic that can have bugs.** That is precisely the safeguard Knight Capital
lacked.

The insight: Aurora DSQL makes a consistency guarantee that used to require
expensive, proprietary matching-engine infrastructure **accessible** to
emerging venues — strong consistency *and* low latency, serverless, multi-region.

## Why DynamoDB

Every incoming order/event is mirrored to a DynamoDB `order_events` firehose
(partition `symbol`, sort `timestamp#order_id`) as an append-only audit log.
This is a high-throughput burst-write workload with no need for cross-row
transactions — the wrong job for the relational core, the right job for
DynamoDB. Audit writes are fire-and-forget, so they never delay or fail a trade.

## Target customer

Smaller and emerging trading venues — crypto exchanges, prediction markets,
alternative trading systems, regional brokerages — that need correctness
guarantees without legacy enterprise matching-engine licensing costs.

## Architecture (bullets)

- Next.js 15 dashboard on Vercel → same-origin API proxy → Fastify intake API.
- Every trade-affecting write goes through ONE OCC-retried transaction in the
  matching engine (price-time priority). No fast path, no exceptions.
- Aurora DSQL holds `order_book` + `trades` (source of truth).
- DynamoDB holds `order_events` (firehose / audit log).
- "Knight Capital Mode" fires 20 same-key duplicate orders and shows, live, the
  database rejecting 19 of them (real HTTP 409s), beside a clearly-labeled
  simulation of the naive double-execution failure.

## Evidence it actually works

- 50 simultaneous conflicting orders → exactly the available liquidity executed,
  zero double-fills, zero negative quantities (hundreds of real OCC retries
  observed; the exact count varies per run).
- 50 same-key submissions → exactly 1 accepted, 49 rejected as duplicates.
- 200-order burst → 200/200 accepted, 200/200 firehose writes, p99 ~1.1s.
- Knight Capital Mode → 5/5 runs with exactly 1 execution + 19 DB rejections.

(Reproduce with `npm test`, `npm run loadtest`, `npm run verify:knight`.)

## Links & assets

Fill the bracketed `[…]` items (only you have these); the rest are ready.

- Live demo (Vercel): `[https://…vercel.app]`
- Vercel Team ID: `[team_…]`
- Demo video (≤3 min, YouTube): `[https://youtu.be/…]`
- Repository: `[https://github.com/…]`
- Architecture diagram: `docs/architecture-diagram.png` (ready to upload) —
  source in `docs/architecture-diagram.svg`; regenerate with `npm run diagram`.
- AWS proof: a live Aurora DSQL cluster + `order_events` DynamoDB table are
  provisioned in `us-east-1`. Generate fresh proof with `npm run aws:proof`
  (prints cluster ARN/status + table details), or screenshot the Aurora DSQL
  console (cluster `ACTIVE`) and the DynamoDB console (`order_events` table).

## One-paragraph description (paste into Devpost)

AXIOM is a distributed exchange core that makes the Knight Capital failure —
duplicate order execution — physically impossible. Every trade is matched inside
a single optimistic-concurrency transaction on Amazon Aurora DSQL, whose
commit-time conflict detection plus a database-enforced `UNIQUE(idempotency_key)`
constraint guarantee exactly-once execution with strong consistency across
regions; a DynamoDB firehose captures every event as an audit log. The result is
enterprise-grade matching-engine correctness — proven with a concurrency test
firing 50 simultaneous conflicting orders and a live "Knight Capital Mode" that
shows the database rejecting 19 of 20 duplicates in real time — packaged for the
emerging crypto exchanges, prediction markets, and ATSs that legacy matching
technology prices out.
