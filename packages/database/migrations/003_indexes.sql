-- Migration 003 — secondary indexes
--
-- idx_order_book_match backs the price-time-priority scan in the matching
-- transaction: WHERE symbol, side, status, ORDER BY price, created_at.
--
-- idx_trades_symbol_time backs the trade-tape / ledger reads.
--
-- Aurora DSQL note: on DSQL use `CREATE INDEX ASYNC` for non-blocking,
-- zero-downtime index creation on large tables. Stock Postgres (local dev)
-- uses plain `CREATE INDEX`. The migration runner rewrites `CREATE INDEX` to
-- `CREATE INDEX ASYNC` automatically when the target is Aurora DSQL.

CREATE INDEX IF NOT EXISTS idx_order_book_match
  ON order_book (symbol, side, status, price, created_at);

CREATE INDEX IF NOT EXISTS idx_trades_symbol_time
  ON trades (symbol, executed_at);
