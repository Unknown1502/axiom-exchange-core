# Database Design

AXIOM uses two stores with sharply different jobs. This document covers the
Aurora DSQL relational core (the source of truth). The DynamoDB firehose is
covered in [`event-flow.md`](event-flow.md).

## Aurora DSQL — source of truth

Single cluster, single built-in database (`postgres`), accessed over the
standard Postgres wire protocol via the `pg` driver.

### `order_book`

The live state of every order.

| Column | Type | Notes |
|---|---|---|
| `order_id` | `UUID PRIMARY KEY` | Random UUID — DSQL's recommended PK pattern; spreads writes across the key range to reduce hot-key OCC contention. |
| `symbol` | `TEXT NOT NULL` | Trading pair, e.g. `BTC-USD`. |
| `side` | `TEXT CHECK (side IN ('BUY','SELL'))` | Enum mirrored from `@axiom/shared-types`. |
| `order_type` | `TEXT` → `IN (GTC,IOC,FOK,POST_ONLY)` | Time-in-force. Default `GTC`. On a fresh DB the `CREATE TABLE` carries `DEFAULT 'GTC'` + CHECK; on the already-provisioned cluster it's a bare nullable column (see Migrations). |
| `account_id` | `TEXT` | Owning account for self-trade prevention. Default `anonymous`; a non-anonymous account never matches its own resting liquidity. |
| `price` | `NUMERIC(18,8) CHECK (price > 0)` | Exact decimal; never a float. |
| `quantity` | `NUMERIC(18,8) CHECK (quantity > 0)` | Original size. |
| `remaining_quantity` | `NUMERIC(18,8) CHECK (remaining_quantity >= 0)` | **The `>= 0` CHECK makes "the book can never go negative" a DB-enforced invariant.** |
| `status` | `TEXT CHECK (... IN OPEN/PARTIAL/FILLED/CANCELLED)` | Lifecycle. |
| `region_origin` | `TEXT CHECK (... IN us/eu/apac)` | Intake region. |
| `idempotency_key` | `TEXT NOT NULL UNIQUE` | **The Knight Capital safeguard.** Must never be weakened. |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Time priority tiebreak. |

> **`order_type` / `account_id` validation.** Because these were retrofitted onto
> the live cluster, their CHECK/DEFAULT/NOT-NULL guards exist only on a fresh
> `CREATE TABLE` — Aurora DSQL cannot add them via `ALTER` (see Migrations below).
> The authoritative validation is therefore the `SubmitOrderInputSchema` (Zod)
> trust boundary, which constrains `order_type` to the enum and defaults both
> columns before any write. The matching engine always supplies both.

### `trades`

The immutable, append-only settlement ledger. One row per execution.

| Column | Type | Notes |
|---|---|---|
| `trade_id` | `UUID PRIMARY KEY` | |
| `symbol` | `TEXT NOT NULL` | |
| `buy_order_id` | `UUID NOT NULL` | No FK (DSQL unsupported); integrity guaranteed in-transaction. |
| `sell_order_id` | `UUID NOT NULL` | Same. |
| `price` | `NUMERIC(18,8) CHECK (price > 0)` | Execution (maker) price. |
| `quantity` | `NUMERIC(18,8) CHECK (quantity > 0)` | Fill size. |
| `executed_at` | `TIMESTAMPTZ DEFAULT now()` | |

### Indexes

- `idx_order_book_match (symbol, side, status, price, created_at)` — backs the
  price-time-priority scan in the matching transaction.
- `idx_trades_symbol_time (symbol, executed_at)` — backs the trade-tape reads.
- The `UNIQUE(idempotency_key)` constraint creates its own index implicitly.

On Aurora DSQL these are created with `CREATE INDEX ASYNC` (the migration runner
rewrites `CREATE INDEX` → `CREATE INDEX ASYNC` when targeting DSQL).

## Constraints carried by Aurora DSQL (and how AXIOM honors them)

| DSQL constraint | How AXIOM complies |
|---|---|
| Isolation fixed at `REPEATABLE READ` | All transactions `BEGIN ISOLATION LEVEL REPEATABLE READ`; correctness via OCC + retry. |
| No foreign keys | Referential integrity enforced inside the single matching transaction. |
| No `SELECT ... FOR UPDATE` locking | Not relied upon; write-write conflict detection used instead. |
| 1 DDL per transaction; DDL/DML separate | Migration runner executes each statement in its own autocommit. |
| `ALTER TABLE ADD COLUMN` takes no `DEFAULT`/`NOT NULL`/`CHECK` | Retrofit migrations add bare nullable columns + backfill; validation enforced in the Zod trust boundary. |
| ≤ 3,000 row modifications / transaction | Matching sweep bounded by `MAX_RESTING_ORDERS_PER_MATCH = 1000` (≤ ~2,002 row mods/tx). |
| Connections time out after 1 hour | Pool `idleTimeoutMillis` recycles connections well under the limit. |
| `C` collation, `UTC` timezone | Acceptable; ordering is by `price`/`created_at`, both collation-independent. |

## Migrations

Plain `.sql` files in `packages/database/migrations/`, applied in lexical order
and tracked in `schema_migrations`. The runner is idempotent and re-runnable.
Each statement is autocommitted individually to satisfy DSQL's DDL rules. See
[`migrate.ts`](../../packages/database/src/migrate.ts).

- `001_order_book.sql`, `002_trades.sql`, `003_indexes.sql` — the base schema.
- `004_order_type_account_id.sql` — adds `order_type` + `account_id`.

> **Why 004 is a separate ALTER, not an edit to 001.** Once a migration is
> recorded in `schema_migrations` it is **immutable** — the runner skips it, and
> `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already exists. Since
> 001 was already applied to the live cluster, evolving the table requires a new
> `ALTER` migration.
>
> **Aurora DSQL `ALTER` limitation (load-bearing).** DSQL's `ALTER TABLE ADD
> COLUMN` supports only `ADD COLUMN [IF NOT EXISTS] name data_type` — **no
> `DEFAULT`, `NOT NULL`, or `CHECK`**, and a `CHECK` cannot be added by `ALTER` at
> all (only `UNIQUE USING INDEX`). So 004 adds **bare nullable `TEXT` columns**
> and **backfills** existing rows (`UPDATE ... SET ... WHERE col IS NULL`) to
> `GTC` / `anonymous`. The DDL `ALTER`s and the DML `UPDATE`s run as separate
> autocommitted statements, satisfying DSQL's one-DDL-per-transaction rule.
> Column-level validation lives in the Zod trust boundary (see `order_book`
> above), not in the DSQL column definition.

## Money representation

Prices and quantities are **never** JavaScript `number`. `node-postgres` returns
`NUMERIC` as a string (we assert this type parser explicitly), and
`@axiom/shared-types`'s fixed-point module parses those strings into `bigint`
scaled by 10^8 for exact compare/min/subtract. Floats never enter money math.
