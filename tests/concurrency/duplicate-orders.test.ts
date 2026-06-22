/**
 * DUPLICATE-SUBMISSION PROOF — the literal Knight Capital safeguard.
 *
 * Knight Capital's loss came from the same order being submitted/executed
 * repeatedly with nothing stopping the duplication. Here we fire 50 submissions
 * carrying the SAME idempotency_key simultaneously and prove the database's
 * UNIQUE(idempotency_key) constraint admits exactly one — the other 49 are
 * cleanly rejected as REJECTED_DUPLICATE, never double-processed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, type Pool } from '@axiom/database';
import { createTestPool, placeOrder, resetTables, TEST_SYMBOL } from './helpers.js';

const DUPLICATE_BURST = 50;
const SHARED_KEY = 'knight-capital-retry-storm';

let pool: Pool;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('Idempotency: 50 simultaneous submissions of the same idempotency_key', () => {
  it('accepts exactly one and rejects the other 49 as duplicates', async () => {
    await resetTables(pool);

    const results = await Promise.all(
      Array.from({ length: DUPLICATE_BURST }, () =>
        placeOrder(pool, {
          side: 'BUY',
          price: '100',
          quantity: '1',
          idempotencyKey: SHARED_KEY,
        }),
      ),
    );

    const accepted = results.filter((r) => r.outcome === 'ACCEPTED');
    const rejected = results.filter((r) => r.outcome === 'REJECTED_DUPLICATE');

    const { rows: bookRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM order_book WHERE idempotency_key = $1`,
      [SHARED_KEY],
    );
    const persistedCount = Number(bookRows[0]?.count ?? '0');

    const { rows: tradeRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM trades WHERE symbol = $1`,
      [TEST_SYMBOL],
    );
    const trades = Number(tradeRows[0]?.count ?? '0');

    console.log('\n=== AXIOM DUPLICATE-SUBMISSION PROOF ===');
    console.log(`Simultaneous submissions (same key): ${DUPLICATE_BURST}`);
    console.log(`Accepted:                            ${accepted.length}  (must be 1)`);
    console.log(`Rejected as duplicate:               ${rejected.length}  (must be ${DUPLICATE_BURST - 1})`);
    console.log(`Rows persisted for the key:          ${persistedCount}  (must be 1)`);
    console.log(`Trades executed:                     ${trades}  (must be 0 — no liquidity)`);
    console.log('========================================\n');

    expect(accepted.length).toBe(1);
    expect(rejected.length).toBe(DUPLICATE_BURST - 1);
    expect(persistedCount).toBe(1);
    expect(trades).toBe(0);
  });
});
