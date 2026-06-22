/**
 * GET /events/:symbol — recent DynamoDB firehose events (the audit log panel).
 *
 * Degrades gracefully: if DynamoDB is not configured/reachable (e.g. local dev
 * without the firehose), it returns an empty list with a flag rather than a
 * 500, so the dashboard still renders.
 */

import type { FastifyInstance } from 'fastify';
import { getRecentEvents } from '@axiom/dynamodb-client';

export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/events/:symbol', async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    try {
      const events = await getRecentEvents(symbol, 50);
      return reply.send({ symbol, events, available: true });
    } catch (err) {
      app.log.error({ err }, 'getRecentEvents failed (firehose unavailable)');
      return reply.send({ symbol, events: [], available: false });
    }
  });
}
