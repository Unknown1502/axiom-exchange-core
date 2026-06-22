/** GET /book/:symbol — live order-book depth snapshot (bids/asks/spread). */

import type { FastifyInstance } from 'fastify';
import type { Pool } from '@axiom/database';
import { getBookSnapshot } from '../db.js';

export function registerBookRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/book/:symbol', async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const snapshot = await getBookSnapshot(pool, symbol);
    return reply.send(snapshot);
  });
}
