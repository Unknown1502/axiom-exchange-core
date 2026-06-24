-- Migration 001 — order_book
--
-- The single source of truth for live orders. Matches the AXIOM spec schema,
-- adapted for Aurora DSQL compatibility and hardened with CHECK constraints.
--
-- Aurora DSQL notes:
--   * One DDL statement per transaction — this file contains exactly one.
--   * No foreign keys are used anywhere in AXIOM (DSQL does not support them);
--     referential integrity is enforced inside the matching transaction.
--   * order_id is a random UUID (DSQL's recommended primary-key pattern, which
--     spreads writes across the key range and minimizes hot-key contention).
--
-- Hardening beyond the base spec (all STRENGTHEN the correctness thesis):
--   * CHECK (remaining_quantity >= 0) makes "the book can never go negative" a
--     database-enforced invariant, not merely an application promise.
--   * CHECK constraints on price/quantity reject malformed orders at the DB.
--
-- The UNIQUE(idempotency_key) constraint is the literal Knight Capital
-- safeguard and MUST NOT be removed or weakened.

-- order_type / account_id (added for the order-type + self-trade-prevention
-- features) both carry DEFAULTs so pre-existing callers, seeds, and the
-- concurrency proofs keep working unchanged:
--   * order_type defaults to 'GTC' (good-till-cancelled), the original behavior.
--   * account_id defaults to 'anonymous'. STP only acts on a *non*-anonymous
--     account matching itself, so anonymous order flow never self-prevents and
--     the existing proofs (all anonymous) are unaffected.

CREATE TABLE IF NOT EXISTS order_book (
  order_id            UUID PRIMARY KEY,
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type          TEXT NOT NULL DEFAULT 'GTC'
                        CHECK (order_type IN ('GTC', 'IOC', 'FOK', 'POST_ONLY')),
  account_id          TEXT NOT NULL DEFAULT 'anonymous',
  price               NUMERIC(18, 8) NOT NULL CHECK (price > 0),
  quantity            NUMERIC(18, 8) NOT NULL CHECK (quantity > 0),
  remaining_quantity  NUMERIC(18, 8) NOT NULL CHECK (remaining_quantity >= 0),
  status              TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'PARTIAL', 'FILLED', 'CANCELLED')),
  region_origin       TEXT NOT NULL CHECK (region_origin IN ('us', 'eu', 'apac')),
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
