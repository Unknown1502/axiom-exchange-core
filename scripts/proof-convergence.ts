/**
 * MULTI-REGION CONVERGENCE PROOF — the steady-state demo.
 *
 * Thesis: two traders connected to two different AWS Regions trade the SAME order
 * book and settle into the SAME ledger, with strong consistency and no
 * replication lag. This script proves it against a live multi-Region Aurora DSQL
 * cluster by writing through BOTH Regional endpoints and reading the result back
 * from EITHER — they must agree exactly.
 *
 * Scenario:
 *   1. Trader US (us endpoint) posts resting SELL liquidity.
 *   2. Trader EU (eu endpoint) immediately crosses it with a BUY.
 *   3. We read the book + trades from BOTH endpoints and assert they are
 *      identical — one ledger, two doors.
 *
 * The match itself runs through the unchanged OCC matching transaction; the only
 * new thing is that the maker and taker arrive via different Regional endpoints.
 * A cross-Region write-write conflict would surface as SQLSTATE 40001 and retry
 * exactly as a same-Region conflict does.
 *
 * Requires a live multi-Region cluster + .env: DSQL_ENDPOINT_US/REGION_US,
 * DSQL_ENDPOINT_EU/REGION_EU. Run migrations first: `npm run db:migrate:dsql:multiregion`.
 *
 * Usage: `npm run proof:convergence`
 */

import { randomUUID } from 'node:crypto';
import { createMultiRegionPools, type Pool } from '@axiom/database';
import { submitOrder } from '@axiom/matching-engine';

const SYMBOL = process.env.DEMO_SYMBOL ?? 'BTC-USD';
const PRICE = '50000';
const QTY = '2';

interface BookCount {
  open_orders: number;
  trades: number;
  executed_qty: string;
}

/** Read a compact, comparable summary of the ledger from one endpoint. */
async function summarize(pool: Pool, symbol: string): Promise<BookCount> {
  const open = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM order_book
      WHERE symbol = $1 AND status IN ('OPEN','PARTIAL') AND remaining_quantity > 0`,
    [symbol],
  );
  const trades = await pool.query<{ c: string; q: string }>(
    `SELECT COUNT(*)::text AS c, COALESCE(SUM(quantity),0)::text AS q
       FROM trades WHERE symbol = $1`,
    [symbol],
  );
  return {
    open_orders: Number(open.rows[0]?.c ?? '0'),
    trades: Number(trades.rows[0]?.c ?? '0'),
    executed_qty: trades.rows[0]?.q ?? '0',
  };
}

async function main(): Promise<void> {
  const mr = createMultiRegionPools(10);
  const usPool = mr.pools.us;
  const euPool = mr.pools.eu;

  console.log('\n=== AXIOM MULTI-REGION CONVERGENCE PROOF ===');
  console.log(`Symbol: ${SYMBOL}`);
  console.log('Trader US  -> us endpoint');
  console.log('Trader EU  -> eu endpoint');
  console.log('Both endpoints are ONE logical, strongly-consistent ledger.\n');

  // 1. US trader posts resting SELL liquidity via the US endpoint.
  const sell = await submitOrder(usPool, {
    symbol: SYMBOL,
    side: 'SELL',
    price: PRICE,
    quantity: QTY,
    region_origin: 'us',
    idempotency_key: `conv-sell-${randomUUID()}`,
  });
  console.log(`[US endpoint]  SELL ${QTY} @ ${PRICE} -> ${sell.outcome} (${'status' in sell ? sell.status : ''})`);

  // 2. EU trader crosses it via the EU endpoint — different Region, same book.
  const buy = await submitOrder(euPool, {
    symbol: SYMBOL,
    side: 'BUY',
    price: PRICE,
    quantity: QTY,
    region_origin: 'eu',
    idempotency_key: `conv-buy-${randomUUID()}`,
  });
  console.log(
    `[EU endpoint]  BUY  ${QTY} @ ${PRICE} -> ${buy.outcome} (${'status' in buy ? buy.status : ''}, ${'fills' in buy ? buy.fills.length : 0} fill(s))`,
  );

  // 3. Read the ledger from BOTH endpoints and compare.
  const fromUs = await summarize(usPool, SYMBOL);
  const fromEu = await summarize(euPool, SYMBOL);

  console.log('\nLedger as seen from each endpoint (must be identical):');
  console.log(`  via US endpoint: ${JSON.stringify(fromUs)}`);
  console.log(`  via EU endpoint: ${JSON.stringify(fromEu)}`);

  const agree =
    fromUs.open_orders === fromEu.open_orders &&
    fromUs.trades === fromEu.trades &&
    fromUs.executed_qty === fromEu.executed_qty;

  console.log(`\nConvergence: ${agree ? 'PASS ✅ — one ledger, zero divergence' : 'FAIL ❌ — endpoints disagree'}`);
  console.log('============================================\n');

  await mr.closeAll();
  if (!agree) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('convergence proof crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
