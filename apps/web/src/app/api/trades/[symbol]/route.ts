/**
 * GET /api/trades/:symbol — most recent trades (the trade tape / settlement
 * ledger). Reads directly from Aurora DSQL in-process.
 */

import { getPool } from '@/server/db';
import { getRecentTrades } from '@/server/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await ctx.params;
  try {
    const trades = await getRecentTrades(getPool(), symbol, 50);
    return Response.json({ symbol, trades }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[trades] read failed', err);
    return Response.json({ error: 'TRADES_UNAVAILABLE' }, { status: 502 });
  }
}
