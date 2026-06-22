/**
 * GET /api/book/:symbol — aggregated live order book (bids/asks/spread).
 * Reads directly from Aurora DSQL in-process.
 */

import { getPool } from '@/server/db';
import { getBookSnapshot } from '@/server/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await ctx.params;
  try {
    const snapshot = await getBookSnapshot(getPool(), symbol);
    return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[book] read failed', err);
    return Response.json({ error: 'BOOK_UNAVAILABLE' }, { status: 502 });
  }
}
