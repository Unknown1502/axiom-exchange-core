/**
 * GET /trades/:symbol         — recent trades (newest first).
 * GET /trades/:symbol/stream  — Server-Sent Events feed of trades as they print.
 *
 * The SSE stream primes itself with the current trades (marking them seen
 * without emitting), then every 500ms emits only newly-printed trades. A
 * heartbeat comment keeps proxies from closing an idle connection. The interval
 * is cleared when the client disconnects.
 */

import type { FastifyInstance } from 'fastify';
import type { Pool } from '@axiom/database';
import { getRecentTrades } from '../db.js';

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SEEN_CAP = 2_000;

export function registerTradeRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/trades/:symbol', async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const trades = await getRecentTrades(pool, symbol, 50);
    return reply.send({ symbol, trades });
  });

  app.get('/trades/:symbol/stream', async (request, reply) => {
    const { symbol } = request.params as { symbol: string };

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    raw.write(': connected\n\n');

    const seen = new Set<string>();
    let primed = false;

    const tick = async (): Promise<void> => {
      try {
        const trades = await getRecentTrades(pool, symbol, 100);
        // Emit oldest-first so the client renders them in execution order.
        const fresh = trades.filter((t) => !seen.has(t.trade_id)).reverse();
        for (const trade of fresh) {
          seen.add(trade.trade_id);
          if (primed) {
            raw.write(`event: trade\ndata: ${JSON.stringify(trade)}\n\n`);
          }
        }
        primed = true;
        if (seen.size > SEEN_CAP) {
          seen.clear();
          primed = false; // re-prime to avoid replaying the whole history
        }
      } catch (err) {
        app.log.error({ err }, 'sse tick failed');
      }
    };

    await tick();
    const pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const heartbeatTimer = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_INTERVAL_MS);

    request.raw.on('close', () => {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      raw.end();
    });
  });
}
