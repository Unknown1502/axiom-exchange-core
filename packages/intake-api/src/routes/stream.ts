/**
 * GET /stream/:symbol — live market-data feed over Server-Sent Events.
 *
 * The standalone-server counterpart to the Next.js /api/stream route: a single
 * server-side poller reads the book + trades from Aurora DSQL and pushes them to
 * every connected consumer. This is the public market-data endpoint an EXTERNAL
 * client (another venue, a trading bot, a market-data screen) subscribes to —
 * one subscription instead of repeatedly polling /book and /trades.
 *
 * Events: `book` (L2 depth), `trade` (last-trade tape), plus heartbeat comments.
 * Snapshots are only re-sent when the data changes.
 */

import type { FastifyInstance } from 'fastify';
import type { Pool } from '@axiom/database';
import { getBookSnapshot, getRecentTrades } from '../db.js';

const POLL_INTERVAL_MS = 700;
const HEARTBEAT_MS = 15_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerStreamRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/stream/:symbol', (request, reply) => {
    const { symbol } = request.params as { symbol: string };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // External consumers connect cross-origin; SSE is read-only and public.
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('retry: 3000\n\n');

    let closed = false;
    let lastBook = '';
    let lastTrades = '';

    const write = (chunk: string): void => {
      if (closed) return;
      reply.raw.write(chunk);
    };

    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        const [book, trades] = await Promise.all([
          getBookSnapshot(pool, symbol),
          getRecentTrades(pool, symbol, 50),
        ]);

        const bookKey = JSON.stringify({ b: book.bids, a: book.asks, s: book.spread });
        if (bookKey !== lastBook) {
          lastBook = bookKey;
          write(sseFrame('book', book));
        }

        const tradesKey = JSON.stringify(trades.map((t) => t.trade_id));
        if (tradesKey !== lastTrades) {
          lastTrades = tradesKey;
          write(sseFrame('trade', { trades }));
        }
      } catch (err) {
        request.log.error({ err }, 'stream read failed');
        write(sseFrame('error', { message: 'read failed' }));
      }
    };

    void tick();
    const pollId = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const beatId = setInterval(() => write(': heartbeat\n\n'), HEARTBEAT_MS);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(pollId);
      clearInterval(beatId);
      reply.raw.end();
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
