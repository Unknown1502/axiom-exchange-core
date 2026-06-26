/**
 * GET /api/stream/:symbol — live market-data stream (Server-Sent Events).
 *
 * A single server-side poller reads the order book + recent trades from Aurora
 * DSQL and PUSHES them to the client, replacing per-client HTTP polling. One
 * server poll fans out to every connected consumer (the dashboard and any
 * external market-data client), instead of N clients each hammering the DB.
 *
 * Events emitted (named SSE events, JSON `data`):
 *   • `book`   — L2 depth snapshot { symbol, bids[], asks[], spread, timestamp }
 *   • `trade`  — last-trade tape   { trades: TradeView[] } (most recent first)
 *   • `:` heartbeat comment        — keeps the connection alive through proxies
 *
 * Snapshots are only re-sent when the underlying data CHANGES (cheap hash
 * compare), so an idle book produces heartbeats but no redundant payloads.
 *
 * Vercel-safety: the stream runs for a bounded window, then closes cleanly. The
 * browser's EventSource transparently reconnects, so the feed is continuous
 * without holding a single serverless invocation open indefinitely.
 */

import { getPool } from '@/server/db';
import { getBookSnapshot, getRecentTrades } from '@/server/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 700;
const HEARTBEAT_MS = 15_000;
// Bounded so a serverless invocation is never held open forever; EventSource
// reconnects automatically when the stream ends.
const MAX_STREAM_MS = 25_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await ctx.params;
  const pool = getPool();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      // Track last-sent payloads so we only push real changes.
      let lastBook = '';
      let lastTrades = '';

      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const tick = async (): Promise<void> => {
        if (closed) return;
        try {
          const [book, trades] = await Promise.all([
            getBookSnapshot(pool, symbol),
            getRecentTrades(pool, symbol, 50),
          ]);

          // The book snapshot's timestamp changes every read, so hash only the
          // price levels + spread to detect a genuine change.
          const bookKey = JSON.stringify({ b: book.bids, a: book.asks, s: book.spread });
          if (bookKey !== lastBook) {
            lastBook = bookKey;
            send(sseFrame('book', book));
          }

          const tradesKey = JSON.stringify(trades.map((t) => t.trade_id));
          if (tradesKey !== lastTrades) {
            lastTrades = tradesKey;
            send(sseFrame('trade', { trades }));
          }
        } catch (err) {
          send(sseFrame('error', { message: 'read failed' }));
          console.error('[stream] read failed', err);
        }
      };

      // Prime the stream immediately so a new client paints without waiting.
      send(`retry: 3000\n\n`); // tell EventSource to reconnect after 3s
      void tick();

      const pollId = setInterval(() => void tick(), POLL_INTERVAL_MS);
      const beatId = setInterval(() => send(`: heartbeat\n\n`), HEARTBEAT_MS);
      const endId = setTimeout(() => cleanup(), MAX_STREAM_MS);

      function cleanup(): void {
        if (closed) return;
        closed = true;
        clearInterval(pollId);
        clearInterval(beatId);
        clearTimeout(endId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      // Stop promptly if the client navigates away / aborts.
      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
