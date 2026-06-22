-- Migration 002 — trades
--
-- The immutable settlement ledger: one row per execution. Append-only.
--
-- Aurora DSQL notes:
--   * The spec's `REFERENCES order_book(order_id)` foreign keys are intentionally
--     omitted because Aurora DSQL does not support foreign keys. Referential
--     integrity is guaranteed structurally instead: every trade is INSERTed in
--     the SAME serializable (OCC) transaction that reads and decrements the two
--     order rows it references, so a trade can never reference a non-existent
--     order. See docs/architecture/concurrency-model.md.
--   * buy_order_id / sell_order_id are plain UUID columns (validated in-app).

CREATE TABLE IF NOT EXISTS trades (
  trade_id       UUID PRIMARY KEY,
  symbol         TEXT NOT NULL,
  buy_order_id   UUID NOT NULL,
  sell_order_id  UUID NOT NULL,
  price          NUMERIC(18, 8) NOT NULL CHECK (price > 0),
  quantity       NUMERIC(18, 8) NOT NULL CHECK (quantity > 0),
  executed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
