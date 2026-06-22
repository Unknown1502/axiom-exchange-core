/**
 * Demo warm-up: seed a realistic resting order book so live demo BUY orders (and
 * Knight Capital Mode) have liquidity to hit.
 *
 * Places resting SELL orders ascending in price and resting BUY orders below
 * them, all through the real matching engine (never behind its back). By
 * default it resets the book first for a clean, repeatable demo state; pass
 * `--no-reset` to append instead.
 *
 * Usage: `npm run seed`  (or `npm run seed -- --no-reset`)
 */

import { createPool } from '@axiom/database';
import { submitOrder } from '@axiom/matching-engine';
import type { Region } from '@axiom/shared-types';

const SYMBOL = process.env.DEMO_SYMBOL ?? 'BTC-USD';
const VALID_REGIONS: readonly Region[] = ['us', 'eu', 'apac'];
const REGION: Region = VALID_REGIONS.includes(process.env.DEMO_REGION as Region)
  ? (process.env.DEMO_REGION as Region)
  : 'us';

const reset = !process.argv.includes('--no-reset');

interface SeedLevel {
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
}

// Asks above, bids below — a ~2.00 spread around 100.
const SEED_LEVELS: SeedLevel[] = [
  { side: 'SELL', price: '105.00', quantity: '2.5' },
  { side: 'SELL', price: '104.00', quantity: '1.0' },
  { side: 'SELL', price: '103.00', quantity: '3.0' },
  { side: 'SELL', price: '102.00', quantity: '1.5' },
  { side: 'SELL', price: '101.00', quantity: '2.0' },
  { side: 'BUY', price: '99.00', quantity: '2.0' },
  { side: 'BUY', price: '98.00', quantity: '1.5' },
  { side: 'BUY', price: '97.00', quantity: '3.0' },
  { side: 'BUY', price: '96.00', quantity: '1.0' },
  { side: 'BUY', price: '95.00', quantity: '2.5' },
];

async function main(): Promise<void> {
  const pool = createPool();
  try {
    if (reset) {
      // DELETE (not TRUNCATE) — Aurora DSQL does not support TRUNCATE.
      await pool.query('DELETE FROM trades');
      await pool.query('DELETE FROM order_book');
      console.log('Reset: cleared order_book and trades.');
    }

    let placed = 0;
    for (const [i, level] of SEED_LEVELS.entries()) {
      const result = await submitOrder(pool, {
        symbol: SYMBOL,
        side: level.side,
        price: level.price,
        quantity: level.quantity,
        region_origin: REGION,
        idempotency_key: `seed-${SYMBOL}-${level.side}-${level.price}-${i}`,
      });
      if (result.outcome === 'ACCEPTED') {
        placed++;
        console.log(`  ${level.side.padEnd(4)} ${level.quantity.padStart(5)} @ ${level.price}  → ${result.status}`);
      } else {
        console.log(`  ${level.side} @ ${level.price}  → ${result.outcome} (already seeded)`);
      }
    }

    console.log(`\nSeed complete: ${placed}/${SEED_LEVELS.length} resting orders on ${SYMBOL}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
