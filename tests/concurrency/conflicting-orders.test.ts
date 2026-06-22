/**
 * CONCURRENCY PROOF — the load-bearing test of the whole AXIOM thesis.
 *
 * Setup: seed exactly 10 units of resting SELL liquidity (10 orders x 1.0).
 * Attack: fire 50 BUY orders SIMULTANEOUSLY, all crossing that same liquidity.
 *         Demand (50.0) hugely exceeds supply (10.0), so all 50 transactions
 *         contend on the same 10 order-book rows — the exact race condition that
 *         lets a naive engine double-fill.
 *
 * Invariants that MUST hold (these are the pitch):
 *   1. Total executed quantity == 10.0 exactly — not one unit more. No
 *      double-execution. (Knight Capital's failure was executing more than
 *      reality allowed.)
 *   2. No order_book.remaining_quantity is ever negative.
 *   3. Exactly 10 trades, each referencing real orders (referential integrity
 *      with no foreign keys, guaranteed by the single transaction).
 *   4. Exactly 10 BUY orders FILLED, 40 left OPEN with nothing executed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, type Pool } from '@axiom/database';
import {
  createTestPool,
  minRemainingQuantity,
  orphanTradeCount,
  placeOrder,
  resetTables,
  seedRestingOrders,
  statusBreakdown,
  totalTradedQuantity,
  tradeCount,
} from './helpers.js';

const RESTING_LIQUIDITY = 10; // 10 SELL orders x 1.0 = 10.0 available
const INCOMING_ORDERS = 50; // 50 simultaneous BUY orders x 1.0 = 50.0 demanded
const PRICE = '100';
const UNIT = '1';

let pool: Pool;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool); // idempotent — ensures schema exists
});

afterAll(async () => {
  await pool.end();
});

describe('OCC concurrency: 50 conflicting orders against 10 units of liquidity', () => {
  it('executes exactly the available liquidity with no double-fill and no negative book', async () => {
    await resetTables(pool);
    await seedRestingOrders(
      pool,
      { side: 'SELL', price: PRICE, quantity: UNIT },
      RESTING_LIQUIDITY,
      'seed-sell',
    );

    // Fire all 50 buys at once.
    const results = await Promise.all(
      Array.from({ length: INCOMING_ORDERS }, (_unused, i) =>
        placeOrder(pool, {
          side: 'BUY',
          price: PRICE,
          quantity: UNIT,
          idempotencyKey: `buy-${i}`,
        }),
      ),
    );

    const accepted = results.filter((r) => r.outcome === 'ACCEPTED');
    const filledOrders = accepted.filter((r) => r.outcome === 'ACCEPTED' && r.status === 'FILLED');
    const totalAttempts = accepted.reduce(
      (sum, r) => sum + (r.outcome === 'ACCEPTED' ? r.attempts : 0),
      0,
    );
    const executedQty = await totalTradedQuantity(pool);
    const trades = await tradeCount(pool);
    const minRemaining = await minRemainingQuantity(pool);
    const orphans = await orphanTradeCount(pool);
    const sellStatuses = await statusBreakdown(pool, 'SELL');
    const buyStatuses = await statusBreakdown(pool, 'BUY');

    // ---- Evidence (printed to the test log) ------------------------------
    console.log('\n=== AXIOM CONCURRENCY PROOF ===');
    console.log(`Seeded liquidity (SELL):     ${RESTING_LIQUIDITY}.0 units`);
    console.log(`Simultaneous BUY orders:     ${INCOMING_ORDERS} (x ${UNIT} = ${INCOMING_ORDERS}.0 demanded)`);
    console.log(`Orders accepted:             ${accepted.length}/${INCOMING_ORDERS}`);
    console.log(`Buy orders fully FILLED:     ${filledOrders.length}`);
    console.log(`OCC attempts (sum):          ${totalAttempts} (=> ${totalAttempts - INCOMING_ORDERS} retries forced by contention)`);
    console.log(`Total quantity EXECUTED:     ${executedQty}  (must equal ${RESTING_LIQUIDITY}.0)`);
    console.log(`Trades written:              ${trades}  (must equal ${RESTING_LIQUIDITY})`);
    console.log(`Min remaining_quantity:      ${minRemaining}  (must be >= 0)`);
    console.log(`Orphan trades (bad refs):    ${orphans}  (must be 0)`);
    console.log(`SELL order statuses:         ${JSON.stringify(sellStatuses)}`);
    console.log(`BUY order statuses:          ${JSON.stringify(buyStatuses)}`);
    console.log('================================\n');

    // ---- Assertions ------------------------------------------------------
    // Every distinct-key order is accepted (no false duplicate rejections).
    expect(accepted.length).toBe(INCOMING_ORDERS);

    // INVARIANT 1: no double-execution — executed exactly the available supply.
    expect(Number(executedQty)).toBe(RESTING_LIQUIDITY);

    // INVARIANT 2: the book never went negative.
    expect(Number(minRemaining)).toBeGreaterThanOrEqual(0);

    // INVARIANT 3: exactly one trade per unit of consumed liquidity, all valid.
    expect(trades).toBe(RESTING_LIQUIDITY);
    expect(orphans).toBe(0);

    // INVARIANT 4: precisely 10 buys filled, the rest resting and untouched.
    expect(filledOrders.length).toBe(RESTING_LIQUIDITY);
    expect(buyStatuses).toEqual([
      { status: 'FILLED', count: RESTING_LIQUIDITY },
      { status: 'OPEN', count: INCOMING_ORDERS - RESTING_LIQUIDITY },
    ]);
    // All seeded sells fully consumed.
    expect(sellStatuses).toEqual([{ status: 'FILLED', count: RESTING_LIQUIDITY }]);
  });
});
