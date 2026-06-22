/**
 * POST /orders  — submit an order (the only write path; runs the matching tx).
 * GET  /orders/:id — fetch a single order's current state.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '@axiom/database';
import { submitOrder } from '@axiom/matching-engine';
import {
  writeOrderEvent,
  writeTradeEvent,
  writeRejectedDuplicateEvent,
} from '@axiom/dynamodb-client';
import { ORDER_SIDES } from '@axiom/shared-types';
import { resolveIdempotencyKey } from '../middleware/idempotency.js';
import { resolveRegion } from '../middleware/region.js';
import { awsRegionFor } from '../regions.js';
import { getOrderById } from '../db.js';

const OrderBodySchema = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(ORDER_SIDES),
  price: z.string().min(1),
  quantity: z.string().min(1),
  region_origin: z.string().optional(),
});

/** Run a firehose write without blocking the trade path; log on failure. */
function fireAndForget(app: FastifyInstance, work: Promise<unknown>): void {
  void work.catch((err: unknown) => app.log.error({ err }, 'firehose write failed'));
}

export function registerOrderRoutes(app: FastifyInstance, pool: Pool): void {
  app.post('/orders', async (request, reply) => {
    const parsed = OrderBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ORDER', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const region = resolveRegion(request, body.region_origin);
    const awsRegion = awsRegionFor(region);
    const idempotencyKey = resolveIdempotencyKey(request.headers['idempotency-key']);
    const rawPayload = JSON.stringify(body);

    let result;
    try {
      result = await submitOrder(pool, {
        symbol: body.symbol,
        side: body.side,
        price: body.price,
        quantity: body.quantity,
        region_origin: region,
        idempotency_key: idempotencyKey,
      });
    } catch (err) {
      request.log.error({ err }, 'submitOrder failed');
      return reply.code(400).send({ error: 'ORDER_FAILED', message: (err as Error).message });
    }

    if (result.outcome === 'REJECTED_DUPLICATE') {
      fireAndForget(
        app,
        writeRejectedDuplicateEvent({
          symbol: body.symbol,
          idempotencyKey,
          side: body.side,
          price: body.price,
          quantity: body.quantity,
          regionOrigin: awsRegion,
          rawPayload,
        }),
      );
      return reply.code(409).send({ error: 'DUPLICATE_ORDER', idempotencyKey });
    }

    // ACCEPTED — record SUBMITTED then one MATCHED event per fill.
    fireAndForget(
      app,
      writeOrderEvent({
        symbol: body.symbol,
        orderId: result.order_id,
        side: body.side,
        price: body.price,
        quantity: body.quantity,
        regionOrigin: awsRegion,
        idempotencyKey,
        rawPayload,
      }),
    );
    for (const fill of result.fills) {
      fireAndForget(
        app,
        writeTradeEvent({
          symbol: body.symbol,
          orderId: result.order_id,
          side: body.side,
          tradeId: fill.trade_id,
          tradePrice: fill.price,
          quantity: fill.quantity,
          regionOrigin: awsRegion,
          idempotencyKey,
        }),
      );
    }

    return reply.code(201).send({
      order: {
        order_id: result.order_id,
        symbol: body.symbol,
        side: body.side,
        status: result.status,
        filled_quantity: result.filled_quantity,
        region_origin: region,
        idempotency_key: idempotencyKey,
      },
      trades: result.fills,
      attempts: result.attempts,
    });
  });

  app.get('/orders/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
    }
    const order = await getOrderById(pool, params.data.id);
    if (!order) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    return reply.send(order);
  });

  // Generate-a-key helper for clients that want a server-issued idempotency key.
  app.get('/idempotency-key', async () => ({ idempotencyKey: randomUUID() }));
}
