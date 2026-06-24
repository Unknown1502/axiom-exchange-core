/**
 * SELF-TRADE-PREVENTION (STP) PROOF.
 *
 * An account must never trade with itself — a wash trade is, at best, a
 * fee-burning accident and, at worst, market manipulation. AXIOM enforces this
 * inside the SAME matching transaction that guarantees exactly-once execution:
 * a non-anonymous account's incoming order skips its OWN resting liquidity.
 *
 * Invariants:
 *   1. account A taking against account A's resting order → NO fill (skipped).
 *   2. account A taking against account B's resting order → fills normally.
 *   3. anonymous flow self-prevents NOTHING — so the existing concurrency proofs
 *      (all anonymous) keep their exact behavior. This test pins that guarantee.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Pool } from '@axiom/database';
import {
  createTestPool,
  placeOrder,
  resetTables,
  restingBookQuantity,
  totalTradedQuantity,
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

describe('Self-trade prevention', () => {
  it('does NOT match an account against its own resting order', async () => {
    // Account "alice" rests a SELL, then alice sends a crossing BUY.
    const sell = await placeOrder(pool, {
      side: 'SELL',
      price: PRICE,
      quantity: '2',
      accountId: 'alice',
      idempotencyKey: 'stp-alice-sell',
    });
    expect(sell.outcome).toBe('ACCEPTED');

    const buy = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '2',
      accountId: 'alice',
      idempotencyKey: 'stp-alice-buy',
    });

    const executed = await totalTradedQuantity(pool);

    console.log('\n=== AXIOM SELF-TRADE-PREVENTION PROOF ===');
    console.log(`alice rests SELL 2 @ ${PRICE}, then alice BUYs 2 @ ${PRICE}`);
    console.log(`Executed:                ${executed}  (must be 0 — no self-trade)`);
    console.log(`STP skipped quantity:    ${buy.outcome === 'ACCEPTED' ? buy.stp_skipped_quantity : 'n/a'}  (must be 2.0)`);
    console.log('=========================================\n');

    expect(buy.outcome).toBe('ACCEPTED');
    if (buy.outcome !== 'ACCEPTED') return;
    // Zero executed: alice's BUY refused to take alice's own SELL.
    expect(Number(executed)).toBe(0);
    // The engine reports it skipped 2.0 of its own liquidity.
    expect(Number(buy.stp_skipped_quantity)).toBe(2);
    // alice's BUY rests instead (GTC default), so the book holds both her orders.
    expect(Number(await restingBookQuantity(pool))).toBe(4);
  });

  it('DOES match an account against a DIFFERENT account', async () => {
    // bob rests a SELL; alice (different account) crosses it → normal fill.
    await placeOrder(pool, {
      side: 'SELL',
      price: PRICE,
      quantity: '2',
      accountId: 'bob',
      idempotencyKey: 'stp-bob-sell',
    });

    const buy = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '2',
      accountId: 'alice',
      idempotencyKey: 'stp-alice-vs-bob',
    });

    expect(buy.outcome).toBe('ACCEPTED');
    if (buy.outcome !== 'ACCEPTED') return;
    expect(buy.status).toBe('FILLED');
    expect(Number(buy.stp_skipped_quantity)).toBe(0);
    expect(Number(await totalTradedQuantity(pool))).toBe(2);
  });

  it('skips only OWN liquidity and fills the rest from other accounts', async () => {
    // bob rests 1, alice rests 1 (same price). alice BUYs 2: must skip her own
    // resting SELL but still take bob's → exactly 1 unit executes.
    await placeOrder(pool, {
      side: 'SELL',
      price: PRICE,
      quantity: '1',
      accountId: 'bob',
      idempotencyKey: 'mix-bob-sell',
    });
    await placeOrder(pool, {
      side: 'SELL',
      price: PRICE,
      quantity: '1',
      accountId: 'alice',
      idempotencyKey: 'mix-alice-sell',
    });

    const buy = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '2',
      accountId: 'alice',
      idempotencyKey: 'mix-alice-buy',
    });

    expect(buy.outcome).toBe('ACCEPTED');
    if (buy.outcome !== 'ACCEPTED') return;
    // Took bob's 1 unit, skipped alice's own 1 unit.
    expect(Number(await totalTradedQuantity(pool))).toBe(1);
    expect(Number(buy.stp_skipped_quantity)).toBe(1);
  });

  it('anonymous orders self-prevent NOTHING (existing proofs unaffected)', async () => {
    // Two anonymous orders at the same price MUST trade — this is exactly the
    // behavior the 50-conflicting-order proof relies on.
    await placeOrder(pool, {
      side: 'SELL',
      price: PRICE,
      quantity: '2',
      idempotencyKey: 'anon-sell', // no accountId → 'anonymous'
    });
    const buy = await placeOrder(pool, {
      side: 'BUY',
      price: PRICE,
      quantity: '2',
      idempotencyKey: 'anon-buy',
    });

    expect(buy.outcome).toBe('ACCEPTED');
    if (buy.outcome !== 'ACCEPTED') return;
    expect(buy.status).toBe('FILLED');
    expect(Number(buy.stp_skipped_quantity)).toBe(0);
    expect(Number(await totalTradedQuantity(pool))).toBe(2);
  });
});
