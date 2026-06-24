/**
 * Shared helpers for the concurrency proofs.
 *
 * Order liquidity is seeded by calling the real `submitOrder` engine path (never
 * by writing rows behind its back), so even test fixtures honor the rule that
 * every order goes through the matching transaction.
 */

import { createPool, type Pool } from '@axiom/database';
import { submitOrder } from '@axiom/matching-engine';
import type { OrderType, Region, Side, SubmitOrderResult } from '@axiom/shared-types';

export const TEST_SYMBOL = 'BTC-USD';

/** A pool sized to drive heavy concurrent load against the local database. */
export function createTestPool(): Pool {
  return createPool({ max: 50 });
}

/** Remove all orders and trades between tests for an isolated starting state. */
export async function resetTables(pool: Pool): Promise<void> {
  // DELETE rather than TRUNCATE — Aurora DSQL does not support TRUNCATE, and
  // DELETE works identically on local Postgres.
  await pool.query('DELETE FROM trades');
  await pool.query('DELETE FROM order_book');
}

interface OrderSpec {
  side: Side;
  price: string;
  quantity: string;
  idempotencyKey: string;
  region?: Region;
  /** Time-in-force; omitted = GTC (the original behavior). */
  orderType?: OrderType;
  /** Owning account; omitted = anonymous (no self-trade prevention). */
  accountId?: string;
}

/** Submit a single order through the engine. */
export function placeOrder(pool: Pool, spec: OrderSpec): Promise<SubmitOrderResult> {
  return submitOrder(pool, {
    symbol: TEST_SYMBOL,
    side: spec.side,
    price: spec.price,
    quantity: spec.quantity,
    region_origin: spec.region ?? 'us',
    order_type: spec.orderType,
    account_id: spec.accountId,
    idempotency_key: spec.idempotencyKey,
  });
}

/** Seed resting (maker) liquidity sequentially so created_at ordering is stable. */
export async function seedRestingOrders(
  pool: Pool,
  spec: Omit<OrderSpec, 'idempotencyKey'>,
  count: number,
  keyPrefix: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const result = await placeOrder(pool, { ...spec, idempotencyKey: `${keyPrefix}-${i}` });
    if (result.outcome !== 'ACCEPTED') {
      throw new Error(`Seed order ${keyPrefix}-${i} was unexpectedly ${result.outcome}`);
    }
  }
}

/** Total quantity recorded in the trades ledger. */
export async function totalTradedQuantity(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS total FROM trades`,
  );
  return rows[0]?.total ?? '0';
}

/** Number of trades in the ledger. */
export async function tradeCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM trades`);
  return Number(rows[0]?.count ?? '0');
}

/** The most-negative remaining_quantity in the book (must never be < 0). */
export async function minRemainingQuantity(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ min: string }>(
    `SELECT COALESCE(MIN(remaining_quantity), 0)::text AS min FROM order_book`,
  );
  return rows[0]?.min ?? '0';
}

/** Count of trades whose buy/sell order id does not exist in order_book. */
export async function orphanTradeCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM trades t
      WHERE NOT EXISTS (SELECT 1 FROM order_book b WHERE b.order_id = t.buy_order_id)
         OR NOT EXISTS (SELECT 1 FROM order_book s WHERE s.order_id = t.sell_order_id)`,
  );
  return Number(rows[0]?.count ?? '0');
}

interface StatusBreakdown {
  status: string;
  count: number;
}

/** Order counts grouped by status for a given side. */
export async function statusBreakdown(pool: Pool, side: Side): Promise<StatusBreakdown[]> {
  const { rows } = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM order_book WHERE side = $1 GROUP BY status ORDER BY status`,
    [side],
  );
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

/** Total quantity actually resting on the book (OPEN/PARTIAL with remainder). */
export async function restingBookQuantity(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(remaining_quantity), 0)::text AS total
       FROM order_book
      WHERE status IN ('OPEN', 'PARTIAL') AND remaining_quantity > 0`,
  );
  return rows[0]?.total ?? '0';
}

/** Fetch a single order's status + remaining for assertions. */
export async function orderState(
  pool: Pool,
  orderId: string,
): Promise<{ status: string; remaining: string } | null> {
  const { rows } = await pool.query<{ status: string; remaining: string }>(
    `SELECT status, remaining_quantity::text AS remaining
       FROM order_book WHERE order_id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}
