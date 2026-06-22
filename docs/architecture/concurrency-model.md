# Concurrency Model

This is the most important document in AXIOM. The entire pitch — "exactly one
match, exactly one settlement, no double-execution" — is a claim about behavior
under concurrency. This document explains precisely how that claim is upheld,
and why it is upheld by **Aurora DSQL's real mechanics**, not by SQL keywords
that DSQL does not actually implement.

---

## 1. The spec vs. Aurora DSQL reality

The original AXIOM spec specified the matching transaction as:

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT ... FROM order_book ... FOR UPDATE;   -- pessimistic lock
COMMIT;
```

Verified against AWS's official Aurora DSQL documentation, **three of those
assumptions do not hold on Aurora DSQL**:

| Spec assumption | Aurora DSQL reality |
|---|---|
| `ISOLATION LEVEL SERIALIZABLE` | Isolation is **fixed at `REPEATABLE READ`**. SERIALIZABLE cannot be set. |
| `SELECT ... FOR UPDATE` acquires a lock | DSQL is **lock-free**. `FOR UPDATE` parses, but acquires no lock; intents are invisible to other transactions until commit. |
| `REFERENCES` (foreign keys) | **Foreign keys are not supported.** |
| Two `CREATE TABLE` in one migration | **1 DDL statement per transaction**; DDL and DML cannot mix. |
| Unbounded matching sweep | **Max 3,000 row modifications per transaction.** |

Sources: AWS — *"Concurrency control in Aurora DSQL"* and *"Migrating from
PostgreSQL to Aurora DSQL"* (unsupported features).

Rather than abandon Aurora DSQL (which would destroy the project's entire
reason for existing), AXIOM is built to DSQL's actual concurrency model. The
correctness guarantee is **stronger and more honest** as a result. See
[ADR-001](decision-records/ADR-001-aurora-dsql-occ-model.md).

---

## 2. How correctness is actually guaranteed

Two independent, database-enforced mechanisms — neither of which is application
logic that can have a bug:

### Mechanism A — Optimistic Concurrency Control (prevents double-execution)

Aurora DSQL executes transactions without locks and validates them at commit.
**If two transactions modified the same row, only the earliest committer
succeeds; the other is rejected** with:

```
ERROR: change conflicts with another transaction (OC000) (SQLSTATE 40001)
```

In AXIOM, every order that crosses the book **writes the resting order rows it
fills** (decrementing `remaining_quantity`). Two matchers racing for the same
liquidity therefore always produce a **write-write conflict on the same row** —
the case OCC always detects. The loser is retried against a fresh snapshot,
where it sees the already-reduced (or filled) liquidity and matches correctly.

This is why the book can never be double-filled or driven negative: a second
matcher physically cannot commit a decrement of a row a first matcher already
decremented.

> **Why a local PostgreSQL faithfully proves this:** stock Postgres at
> `REPEATABLE READ` raises the *identical* `SQLSTATE 40001` ("could not
> serialize access due to concurrent update") on write-write conflicts. The
> OCC + retry code path and the concurrency proof behave the same locally as on
> Aurora DSQL. The local proof is real, not a simulation of the logic.

### Mechanism B — `UNIQUE(idempotency_key)` (prevents duplicate submission)

A retried or duplicated submission carries the same `idempotency_key`. The
`UNIQUE` constraint on that column means the second insert fails with
`SQLSTATE 23505`. AXIOM translates this terminal error into a
`REJECTED_DUPLICATE` outcome — never a retry, never a second execution. This is
the literal Knight Capital safeguard, enforced by the database.

---

## 3. The matching transaction, step by step

Implemented in [`packages/matching-engine/src/engine.ts`](../../packages/matching-engine/src/engine.ts),
run inside [`withOccRetry`](../../packages/database/src/occ.ts):

1. **`BEGIN ISOLATION LEVEL REPEATABLE READ`** (the only isolation DSQL offers;
   set explicitly so local Postgres matches DSQL exactly).
2. **INSERT the incoming order**, reserving its `idempotency_key`. A `23505`
   here ⇒ `DuplicateOrderError` ⇒ terminal `REJECTED_DUPLICATE`.
3. **SELECT crossing resting liquidity** on the opposite side in price-time
   priority (`ORDER BY price, created_at`), bounded by `LIMIT` to stay under the
   3,000-row transaction cap.
4. **Walk and fill**: for each resting order, execute `min(incoming_remaining,
   resting_remaining)` at the resting (maker) price; `UPDATE` the resting order;
   `INSERT` a trade. All arithmetic is exact fixed-point (no floats).
5. **UPDATE the incoming order** to its final `remaining_quantity` / status.
6. **COMMIT.** If any row this transaction touched was changed by a concurrent
   committed transaction, COMMIT raises `40001` and `withOccRetry` re-runs the
   whole body against a fresh snapshot (bounded attempts, jittered backoff).

### Retry safety

The transaction body is **idempotent across retries**: each attempt generates
fresh UUIDs and re-reads all state from the new snapshot. A rolled-back attempt
leaves no partial writes (the incoming INSERT is rolled back too), so a retry
re-inserts cleanly with the same `idempotency_key`.

---

## 4. Referential integrity without foreign keys

DSQL has no foreign keys, yet `trades` must never reference a non-existent
order. AXIOM guarantees this **structurally**: every trade row is inserted in
the *same transaction* that reads and decrements the two order rows it
references. There is no window in which a trade can point at a missing order.
The concurrency proof asserts zero orphan trades to verify this directly.

---

## 5. Write skew — why it does not apply here

Snapshot isolation cannot, in general, prevent *write skew* (two transactions
reading an overlapping set and writing *disjoint* rows). AXIOM is not exposed to
this: contending matchers do not write disjoint rows — they write the **same**
resting-order rows. That makes every contention a write-write conflict, which
OCC detects deterministically. The invariant "`remaining_quantity >= 0`" is
additionally enforced by a database `CHECK` constraint as defense in depth.

---

## 6. What is proven, and where

- [`tests/concurrency/conflicting-orders.test.ts`](../../tests/concurrency/conflicting-orders.test.ts)
  — 50 simultaneous orders vs. 10 units of liquidity: asserts total executed
  quantity equals exactly the available liquidity, no negative book, exactly one
  trade per consumed unit, zero orphan trades.
- [`tests/concurrency/duplicate-orders.test.ts`](../../tests/concurrency/duplicate-orders.test.ts)
  — 50 simultaneous submissions of one `idempotency_key`: asserts exactly one
  accepted, 49 rejected as duplicates, one row persisted.
