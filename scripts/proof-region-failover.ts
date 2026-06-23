/**
 * MULTI-REGION FAILOVER PROOF — the finale ("kill a Region, keep the truth").
 *
 * Thesis: a trade committed through one Region is immediately, durably readable
 * from the other Region — so if a Region becomes unreachable, the surviving
 * Region serves the SAME committed ledger with strong consistency, no
 * reconciliation, and zero data loss (RPO = 0).
 *
 * HONEST SCOPE — read this before demoing it.
 *   This script does NOT delete or disable an AWS Region (that would be slow,
 *   billable, and irreversible). It simulates a Region becoming unreachable FROM
 *   THE CLIENT by closing this process's connection pool to the US endpoint and
 *   refusing to use it thereafter. The durability/availability guarantee being
 *   demonstrated is real and is a property of DSQL's witness-quorum design: the
 *   commit reached quorum across Regions before it was acknowledged, so the EU
 *   endpoint already has it. What is simulated is only the *client's loss of the
 *   US endpoint*, which is exactly what an application experiences during a
 *   Regional outage.
 *
 * Scenario:
 *   1. Trader US commits a trade through the US endpoint. We capture the trade_id.
 *   2. "Region outage": close the US pool; any further US use must throw.
 *   3. Trader EU reads the SAME trade_id from the EU endpoint (proving it was
 *      already durable there) and successfully places a NEW order through EU
 *      (proving the surviving Region is still writable, not read-only).
 *
 * Requires a live multi-Region cluster + .env (DSQL_ENDPOINT_US/REGION_US,
 * DSQL_ENDPOINT_EU/REGION_EU). Usage: `npm run proof:failover`
 */

import { randomUUID } from 'node:crypto';
import { createMultiRegionPools, type Pool } from '@axiom/database';
import { submitOrder } from '@axiom/matching-engine';

const SYMBOL = process.env.DEMO_SYMBOL ?? 'BTC-USD';
const PRICE = '42000';
const QTY = '1';

async function tradeExists(pool: Pool, tradeId: string): Promise<boolean> {
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM trades WHERE trade_id = $1`,
    [tradeId],
  );
  return Number(rows[0]?.c ?? '0') === 1;
}

async function main(): Promise<void> {
  const mr = createMultiRegionPools(10);
  const usPool = mr.pools.us;
  const euPool = mr.pools.eu;

  console.log('\n=== AXIOM MULTI-REGION FAILOVER PROOF ===');
  console.log('Simulates: US Region becomes unreachable from the client.');
  console.log('Proves:    the EU Region already holds the committed trade and stays writable.\n');

  // 1. Commit a trade via US: seed a resting SELL, then cross it with a BUY,
  //    both through the US endpoint, so a real trade row exists.
  const sellKey = `fo-sell-${randomUUID()}`;
  const buyKey = `fo-buy-${randomUUID()}`;
  await submitOrder(usPool, {
    symbol: SYMBOL, side: 'SELL', price: PRICE, quantity: QTY,
    region_origin: 'us', idempotency_key: sellKey,
  });
  const buy = await submitOrder(usPool, {
    symbol: SYMBOL, side: 'BUY', price: PRICE, quantity: QTY,
    region_origin: 'us', idempotency_key: buyKey,
  });
  if (buy.outcome !== 'ACCEPTED' || buy.fills.length === 0) {
    throw new Error('Setup failed: BUY did not match the seeded SELL via US endpoint.');
  }
  const tradeId = buy.fills[0]!.trade_id;
  console.log(`[US endpoint]  committed trade ${tradeId}`);

  // Warm up the EU pool BEFORE the outage so its connection is established
  // independently of US — otherwise EU's first lazy connect can race the US
  // teardown. This does not weaken the proof: the trade was committed via US and
  // we have not yet read it from EU.
  await euPool.query('SELECT 1');
  console.log('[EU endpoint]  connection established (independent of US).');

  // 2. "Region outage" — drop the US pool. From here, US is gone for this client.
  await usPool.end();
  console.log('[OUTAGE]       US endpoint connection closed — US is now unreachable.\n');

  // Sanity: confirm US really is unusable now (best-effort; should throw).
  let usDown = false;
  try {
    await usPool.query('SELECT 1');
  } catch {
    usDown = true;
  }
  console.log(`US endpoint reachable after outage: ${usDown ? 'NO ✅ (as expected)' : 'YES ❌'}`);

  // 3. EU must already have the committed trade (RPO = 0) and stay writable.
  const survives = await tradeExists(euPool, tradeId);
  console.log(`Committed trade readable from EU:   ${survives ? 'YES ✅ (zero data loss)' : 'NO ❌'}`);

  const newOrder = await submitOrder(euPool, {
    symbol: SYMBOL, side: 'BUY', price: PRICE, quantity: QTY,
    region_origin: 'eu', idempotency_key: `fo-eu-${randomUUID()}`,
  });
  const euWritable = newOrder.outcome === 'ACCEPTED';
  console.log(`EU endpoint still accepts writes:   ${euWritable ? 'YES ✅ (not read-only)' : 'NO ❌'}`);

  const pass = usDown && survives && euWritable;
  console.log(`\nFailover: ${pass ? 'PASS ✅ — surviving Region serves the same truth, no reconciliation' : 'FAIL ❌'}`);
  console.log('==========================================\n');

  await euPool.end();
  if (!pass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('failover proof crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
