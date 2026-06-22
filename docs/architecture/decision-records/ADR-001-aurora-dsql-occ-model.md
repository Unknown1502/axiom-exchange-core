# ADR-001: Build to Aurora DSQL's OCC model, not literal SERIALIZABLE/FOR UPDATE

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** AXIOM engineering

## Context

The AXIOM spec fixed the matching transaction as `BEGIN TRANSACTION ISOLATION
LEVEL SERIALIZABLE; SELECT ... FOR UPDATE; COMMIT;` with `trades` carrying
foreign keys to `order_book`, and marked this section "DO NOT REDESIGN."

Before writing any engine code, we verified these primitives against AWS's
official Aurora DSQL documentation. Three of them do not exist on Aurora DSQL:

1. **Isolation is fixed at `REPEATABLE READ`.** `SERIALIZABLE` cannot be set.
2. **`SELECT ... FOR UPDATE` acquires no lock.** DSQL is lock-free; it uses
   optimistic concurrency control (OCC) and detects conflicts at commit,
   returning `SQLSTATE 40001` (`OC000`).
3. **Foreign keys are unsupported.**

Additional DSQL constraints: 1 DDL statement per transaction, DDL/DML in
separate transactions, max 3,000 row modifications per transaction.

The spec's own rules also state: *"No invented APIs or syntax… verify before
relying on it"* and *"No silent scope reduction."* The "DO NOT REDESIGN"
instruction and the "verify, don't invent" instruction are in direct conflict
here, because the fixed design relies on primitives the chosen database lacks.

## Decision

**Adapt the matching transaction to Aurora DSQL's real concurrency model and
keep Aurora DSQL as the database.** Concretely:

- Run transactions at `REPEATABLE READ` (explicitly, so local Postgres matches
  DSQL) and wrap them in an OCC retry runner keyed on `SQLSTATE 40001`.
- Do not rely on `FOR UPDATE` for correctness. Correctness comes from
  write-write conflict detection at commit + the `UNIQUE(idempotency_key)`
  constraint.
- Drop foreign keys; enforce referential integrity structurally by writing each
  trade in the same transaction that decrements the orders it references.
- Split migrations to one DDL statement per transaction; bound the matching
  sweep under the 3,000-row limit.

## Why not the alternatives

- **Keep literal SERIALIZABLE/FOR UPDATE on stock PostgreSQL (RDS).** This would
  satisfy the letter of the spec but destroy its thesis. The entire submission's
  originality and database-fit argument is *"Aurora DSQL makes a previously
  enterprise-expensive consistency guarantee accessible."* Swapping to generic
  Postgres throws that away. Rejected.
- **Dual-target adapter (DSQL OCC + Postgres SERIALIZABLE).** Maximum
  engineering cost for a 9-day hackathon, with no judging benefit over a single
  honest DSQL implementation. Rejected for scope.

## Consequences

**Positive**

- The correctness guarantee is *stronger and more defensible* in front of AWS
  database judges: it is grounded in DSQL's documented OCC semantics, not a
  keyword. "Two matchers cannot both commit a decrement of the same row" is a
  crisp, true statement.
- Local PostgreSQL at `REPEATABLE READ` raises the identical `SQLSTATE 40001`,
  so the concurrency proof is real and runs anywhere, while still exercising the
  exact code path used on Aurora DSQL.

**Negative / watch-items**

- Application code must implement retry logic (done: `withOccRetry`). Under
  extreme single-key contention, retries increase latency — mitigated by bounded
  attempts with jittered backoff and acknowledged as a known characteristic.
- Referential integrity is an application/transaction guarantee, not a DB
  constraint; the concurrency proof asserts zero orphan trades to keep it honest.

## Spec checklist reconciliation

The Phase 1 checklist item *"the matching transaction explicitly sets
SERIALIZABLE isolation — quote the exact line"* cannot be satisfied literally on
Aurora DSQL. It is replaced by: *"the matching transaction explicitly sets the
strongest isolation Aurora DSQL offers (`REPEATABLE READ`) and is wrapped in an
OCC conflict-retry on `SQLSTATE 40001`."* This deviation is logged here rather
than made silently, per the spec's escalation protocol.
