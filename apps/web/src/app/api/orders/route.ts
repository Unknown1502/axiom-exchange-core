/**
 * POST /api/orders — submit an order (the only write path; runs the matching tx).
 *
 * Runs the matching engine in-process against Aurora DSQL, then mirrors the
 * outcome to the DynamoDB firehose fire-and-forget. This is the production
 * replacement for proxying to the standalone Fastify intake API.
 */

import { z } from 'zod';
import { submitOrder } from '@axiom/matching-engine';
import {
  writeOrderEvent,
  writeTradeEvent,
  writeRejectedDuplicateEvent,
} from '@axiom/dynamodb-client';
import { ORDER_SIDES } from '@axiom/shared-types';
import { getPool } from '@/server/db';
import { awsRegionFor, resolveIdempotencyKey, resolveRegion } from '@/server/intake';

// Always run on the Node.js runtime (pg + AWS SDK are not Edge-compatible) and
// never cache: every submission must hit the matching transaction.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OrderBodySchema = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(ORDER_SIDES),
  price: z.string().min(1),
  quantity: z.string().min(1),
  region_origin: z.string().optional(),
});

/** Run a firehose write without blocking or failing the trade path. */
function fireAndForget(work: Promise<unknown>): void {
  void work.catch((err: unknown) => {
    console.error('[firehose] write failed', err instanceof Error ? err.message : err);
  });
}

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = OrderBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: 'INVALID_ORDER', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const region = resolveRegion(req.headers, body.region_origin);
  const awsRegion = awsRegionFor(region);
  const idempotencyKey = resolveIdempotencyKey(req.headers.get('idempotency-key'));
  const rawPayload = JSON.stringify(body);

  let result;
  try {
    result = await submitOrder(getPool(), {
      symbol: body.symbol,
      side: body.side,
      price: body.price,
      quantity: body.quantity,
      region_origin: region,
      idempotency_key: idempotencyKey,
    });
  } catch (err) {
    console.error('[orders] submitOrder failed', err);
    return Response.json(
      { error: 'ORDER_FAILED', message: (err as Error).message },
      { status: 400 },
    );
  }

  if (result.outcome === 'REJECTED_DUPLICATE') {
    fireAndForget(
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
    return Response.json({ error: 'DUPLICATE_ORDER', idempotencyKey }, { status: 409 });
  }

  // ACCEPTED — record SUBMITTED, then one MATCHED event per fill.
  fireAndForget(
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

  return Response.json(
    {
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
    },
    { status: 201 },
  );
}
