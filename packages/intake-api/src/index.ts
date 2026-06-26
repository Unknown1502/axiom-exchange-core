/**
 * AXIOM intake API — Fastify server (default port 3001).
 *
 * Fronts the matching engine over HTTP, projects read models for the dashboard
 * (book depth, trade tape, audit log), and tags every order with its region
 * before routing it through the single OCC matching transaction.
 */

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerBookRoutes } from './routes/book.js';
import { registerEventRoutes } from './routes/events.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerTradeRoutes } from './routes/trades.js';
import { createPoolResolver } from './pools.js';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const pools = createPoolResolver();
  app.log.info(
    { multiRegion: pools.multiRegion },
    pools.multiRegion ? 'multi-Region routing ENABLED' : 'single-Region pool',
  );

  await app.register(cors, { origin: true, exposedHeaders: ['Content-Type'] });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'axiom-intake-api',
    multiRegion: pools.multiRegion,
  }));

  registerOrderRoutes(app, pools);
  registerBookRoutes(app, pools.readPool());
  registerTradeRoutes(app, pools.readPool());
  registerStreamRoutes(app, pools.readPool());
  registerEventRoutes(app);

  const port = Number(process.env.INTAKE_PORT ?? process.env.PORT ?? 3001);
  const host = process.env.INTAKE_HOST ?? '0.0.0.0';

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pools.closeAll();
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
