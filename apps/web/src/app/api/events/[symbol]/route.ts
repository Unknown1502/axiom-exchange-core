/**
 * GET /api/events/:symbol — recent DynamoDB firehose events (the audit log).
 *
 * Reads the order_events table directly. Degrades gracefully: if DynamoDB is
 * unconfigured/unreachable, returns an empty list with available:false (HTTP
 * 200) so the dashboard still renders instead of erroring.
 */

import { getRecentEvents } from '@axiom/dynamodb-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await ctx.params;
  try {
    const events = await getRecentEvents(symbol, 50);
    return Response.json(
      { symbol, events, available: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[events] getRecentEvents failed (firehose unavailable)', err);
    return Response.json({ symbol, events: [], available: false }, { status: 200 });
  }
}
