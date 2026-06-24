/**
 * ORDER-TYPE PROOF — time-in-force semantics, each verified end-to-end through
 * the real matching transaction (never by writing rows behind the engine).
 *
 * Invariants (the pitch for richer order types):
 *   IOC       — fills what crosses NOW, cancels the rest; never rests on the book.
 *   FOK       — fills the ENTIRE quantity or nothing; a partial cross kills it,
 *               and crucially writes ZERO trades (all-or-nothing is atomic).
 *   POST_ONLY — refuses to take liquidity: rejected outright if it would cross,
 *               but rests cleanly as a maker when it crosses nothing.
 *   GTC       — unchanged baseline: rests its unfilled remainder.
 *
 * Every assertion that "nothing rested" / "no trade written" is the load-bearing
 * claim: these instructions change what happens to liquidity, and getting them
 * wrong is a real exchange bug (an IOC that silently rests is a stuck order).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Pool } from '@axiom/database';
import {
  createTestPool,
  orderState,
  placeOrder,
  resetTables,
  restingBookQuantity,
  seedRestingOrders,
  totalTradedQuantity,
  tradeCount,
} from './helpers.js';

const PRICE = '100';

let pool: Pool;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetTables(pool);
});

describe('Order types: IOC / FOK / POST_ONLY semantics', () => {
  it('IOC fills the available liquidity and cancels the remainder (never rests)', async () => {
    // 3 units of resting SELL liquidity; an IOC BUY for 5 crosses only 3.
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '1' }, 3, 'ioc-sell');

    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '5',
      orderType: 'IOC',
      idempotencyKey: 'ioc-buy',
    });

    const executed = await totalTradedQuantity(pool);
    const resting = await restingBookQuantity(pool);

    console.log('\n=== AXIOM IOC PROOF ===');
    console.log(`IOC BUY quantity:        5 (vs 3 available)`);
    console.log(`Executed:                ${executed}  (must be 3.0)`);
    console.log(`Resting after IOC:       ${resting}  (must be 0 — IOC never rests)`);
    console.log(`IOC final status:        ${result.outcome === 'ACCEPTED' ? result.status : result.outcome}`);
    console.log('=======================\n');

    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return; // narrow
    expect(Number(executed)).toBe(3);
    // The 2 unfilled units must NOT rest — book holds zero (the 3 sells are gone).
    expect(Number(resting)).toBe(0);
    // Partially filled then leftover killed → terminal CANCELLED, 0 remaining.
    expect(result.status).toBe('CANCELLED');
    const state = await orderState(pool, result.order_id);
    expect(state?.remaining).toBe('0.00000000');
  });

  it('IOC that fully fills resolves FILLED', async () => {
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '1' }, 5, 'ioc2-sell');
    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '3',
      orderType: 'IOC',
      idempotencyKey: 'ioc2-buy',
    });
    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return;
    expect(result.status).toBe('FILLED');
    expect(Number(await totalTradedQuantity(pool))).toBe(3);
  });

  it('FOK kills the order and writes ZERO trades when it cannot fully fill', async () => {
    // Only 3 available; an FOK BUY for 5 cannot fully fill → all-or-nothing kill.
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '1' }, 3, 'fok-sell');

    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '5',
      orderType: 'FOK',
      idempotencyKey: 'fok-buy',
    });

    const executed = await totalTradedQuantity(pool);
    const trades = await tradeCount(pool);
    const resting = await restingBookQuantity(pool);

    console.log('\n=== AXIOM FOK (KILL) PROOF ===');
    console.log(`FOK BUY quantity:        5 (vs 3 available — cannot fully fill)`);
    console.log(`Executed:                ${executed}  (must be 0 — all-or-nothing)`);
    console.log(`Trades written:          ${trades}  (must be 0)`);
    console.log(`Resting SELL liquidity:  ${resting}  (must still be 3 — untouched)`);
    console.log(`FOK final status:        ${result.outcome === 'ACCEPTED' ? result.status : result.outcome}`);
    console.log('==============================\n');

    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return;
    // Atomic kill: nothing executed, NO trade written, resting liquidity intact.
    expect(Number(executed)).toBe(0);
    expect(trades).toBe(0);
    expect(Number(resting)).toBe(3);
    expect(result.status).toBe('CANCELLED');
  });

  it('FOK fully fills when enough liquidity exists', async () => {
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '1' }, 5, 'fok2-sell');
    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '5',
      orderType: 'FOK',
      idempotencyKey: 'fok2-buy',
    });
    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return;
    expect(result.status).toBe('FILLED');
    expect(Number(await totalTradedQuantity(pool))).toBe(5);
  });

  it('POST_ONLY is rejected when it would cross, and writes no trade', async () => {
    // A resting SELL at 100; a POST_ONLY BUY at 100 would CROSS (take) it.
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '2' }, 1, 'po-sell');

    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '2',
      orderType: 'POST_ONLY',
      idempotencyKey: 'po-buy',
    });

    const executed = await totalTradedQuantity(pool);

    console.log('\n=== AXIOM POST_ONLY (REJECT) PROOF ===');
    console.log(`POST_ONLY BUY @ ${PRICE} vs resting SELL @ ${PRICE} — would cross`);
    console.log(`Outcome:                 ${result.outcome}  (must be REJECTED_POST_ONLY)`);
    console.log(`Executed:                ${executed}  (must be 0 — never took liquidity)`);
    console.log('======================================\n');

    expect(result.outcome).toBe('REJECTED_POST_ONLY');
    expect(Number(executed)).toBe(0);
  });

  it('POST_ONLY rests as a maker when it crosses nothing', async () => {
    // Resting SELL at 101; a POST_ONLY BUY at 100 does NOT cross → it rests.
    await seedRestingOrders(pool, { side: 'SELL', price: '101', quantity: '2' }, 1, 'po2-sell');

    const result = await placeOrder(pool, {
      side: 'BUY',
      price: '100',
      quantity: '2',
      orderType: 'POST_ONLY',
      idempotencyKey: 'po2-buy',
    });

    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return;
    expect(result.status).toBe('OPEN');
    expect(Number(await totalTradedQuantity(pool))).toBe(0);
    // The post-only BUY (2) now rests alongside the resting SELL (2) = 4 on book.
    expect(Number(await restingBookQuantity(pool))).toBe(4);
  });

  it('GTC (default) still rests its unfilled remainder — baseline unchanged', async () => {
    await seedRestingOrders(pool, { side: 'SELL', price: PRICE, quantity: '1' }, 2, 'gtc-sell');
    const result = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '5', // crosses 2, rests 3
      idempotencyKey: 'gtc-buy',
    });
    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome !== 'ACCEPTED') return;
    expect(result.order_type).toBe('GTC');
    expect(result.status).toBe('PARTIAL');
    expect(Number(await totalTradedQuantity(pool))).toBe(2);
    // 3 unfilled BUY units rest on the book.
    const state = await orderState(pool, result.order_id);
    expect(state?.remaining).toBe('3.00000000');
  });
});
