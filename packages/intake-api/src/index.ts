/**
 * AXIOM intake API — Fastify server (default port 3001).
 *
 * Fronts the matching engine over HTTP, projects read models for the dashboard
 * (book depth, trade tape, audit log), and tags every order with its region
 * before routing it through the single OCC matching transaction.
 */

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createPool } from '@axiom/database';
import { registerBookRoutes } from './routes/book.js';
import { registerEventRoutes } from './routes/events.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerTradeRoutes } from './routes/trades.js';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const pool = createPool({ max: 30 });

  await app.register(cors, { origin: true, exposedHeaders: ['Content-Type'] });

  app.get('/health', async () => ({ status: 'ok', service: 'axiom-intake-api' }));

  registerOrderRoutes(app, pool);
  registerBookRoutes(app, pool);
  registerTradeRoutes(app, pool);
  registerEventRoutes(app);

  const port = Number(process.env.INTAKE_PORT ?? process.env.PORT ?? 3001);
  const host = process.env.INTAKE_HOST ?? '0.0.0.0';

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host });
}

main().catch((err: unknown) => {
  console.error('intake-api failed to start:', err);
  process.exit(1);
});
