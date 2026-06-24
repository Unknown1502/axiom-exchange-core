-- Migration 004 — order_type + account_id (order types & self-trade prevention)
--
-- Adds the two columns that back IOC/FOK/POST_ONLY time-in-force and self-trade
-- prevention. A SEPARATE migration (not an edit to 001) because 001 was already
-- applied to the live Aurora DSQL cluster, and an applied migration is immutable.
--
-- Aurora DSQL constraint (important): ALTER TABLE ADD COLUMN supports ONLY
-- "ADD COLUMN [IF NOT EXISTS] name data_type" — it does NOT accept DEFAULT,
-- NOT NULL, or CHECK on an added column, and CHECK cannot be added via ALTER at
-- all (only UNIQUE USING INDEX is supported). So on an EXISTING table we add
-- bare nullable columns and backfill, then rely on the application layer for
-- validation. (On a FRESH database, 001's CREATE TABLE still carries the full
-- DEFAULT + CHECK, so this migration's ADD COLUMN IF NOT EXISTS no-ops there,
-- and the backfill UPDATEs touch zero rows.)
--
-- Validation is enforced before every write by SubmitOrderInputSchema (Zod):
-- order_type is constrained to the GTC/IOC/FOK/POST_ONLY enum and defaults to
-- GTC. account_id defaults to anonymous. The matching engine always supplies
-- both columns, so no row is ever written without them.
--
-- Runner note: each statement is autocommitted separately, satisfying DSQL's
-- one-DDL-per-transaction rule and keeping the DDL (ALTER) and DML (UPDATE) in
-- separate transactions.

ALTER TABLE order_book ADD COLUMN IF NOT EXISTS order_type TEXT;

ALTER TABLE order_book ADD COLUMN IF NOT EXISTS account_id TEXT;

UPDATE order_book SET order_type = 'GTC' WHERE order_type IS NULL;

UPDATE order_book SET account_id = 'anonymous' WHERE account_id IS NULL;
