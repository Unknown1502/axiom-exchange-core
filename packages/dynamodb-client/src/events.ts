/**
 * The order-event firehose / audit log.
 *
 * Every meaningful thing that happens to an order is appended here as an
 * immutable event: SUBMITTED on arrival, MATCHED per execution,
 * REJECTED_DUPLICATE when the idempotency_key constraint blocks a retry.
 * DynamoDB is chosen for this (not Aurora DSQL) because it is a high-throughput,
 * append-only burst-write workload that needs no cross-row transaction.
 *
 * Writes are intended to be called fire-and-forget from the hot path so the
 * audit log never adds latency to (or can fail) a trade. Each writer therefore
 * also swallows-and-logs nothing itself — callers decide the failure policy.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Side } from '@axiom/shared-types';
import { getDocumentClient, getTableName } from './client.js';

export type FirehoseEventType = 'SUBMITTED' | 'MATCHED' | 'REJECTED_DUPLICATE' | 'CANCELLED';

/** One item in the `order_events` table. */
export interface OrderEvent {
  /** Partition key. */
  symbol: string;
  /** Sort key: "<ISO8601 created_at>#<order_id>[#<trade_id>]". */
  event_sk: string;
  order_id: string;
  side: Side;
  price: string;
  quantity: string;
  region_origin: string;
  event_type: FirehoseEventType;
  idempotency_key: string;
  raw_payload: string;
  trade_id?: string;
  trade_price?: string;
  created_at: string;
}

async function putEvent(item: OrderEvent): Promise<void> {
  await getDocumentClient().send(new PutCommand({ TableName: getTableName(), Item: item }));
}

export interface SubmittedEventInput {
  symbol: string;
  orderId: string;
  side: Side;
  price: string;
  quantity: string;
  regionOrigin: string;
  idempotencyKey: string;
  rawPayload: string;
}

/** Append a SUBMITTED event when an order arrives at intake. */
export async function writeOrderEvent(input: SubmittedEventInput): Promise<void> {
  const createdAt = new Date().toISOString();
  await putEvent({
    symbol: input.symbol,
    event_sk: `${createdAt}#${input.orderId}`,
    order_id: input.orderId,
    side: input.side,
    price: input.price,
    quantity: input.quantity,
    region_origin: input.regionOrigin,
    event_type: 'SUBMITTED',
    idempotency_key: input.idempotencyKey,
    raw_payload: input.rawPayload,
    created_at: createdAt,
  });
}

export interface MatchedEventInput {
  symbol: string;
  orderId: string;
  side: Side;
  tradeId: string;
  tradePrice: string;
  quantity: string;
  regionOrigin: string;
  idempotencyKey: string;
}

/** Append a MATCHED event when a trade executes (one per fill). */
export async function writeTradeEvent(input: MatchedEventInput): Promise<void> {
  const createdAt = new Date().toISOString();
  await putEvent({
    symbol: input.symbol,
    // Include trade_id so multiple fills of one order get distinct sort keys.
    event_sk: `${createdAt}#${input.orderId}#${input.tradeId}`,
    order_id: input.orderId,
    side: input.side,
    price: input.tradePrice,
    quantity: input.quantity,
    region_origin: input.regionOrigin,
    event_type: 'MATCHED',
    idempotency_key: input.idempotencyKey,
    raw_payload: '',
    trade_id: input.tradeId,
    trade_price: input.tradePrice,
    created_at: createdAt,
  });
}

export interface RejectedDuplicateEventInput {
  symbol: string;
  idempotencyKey: string;
  side?: Side;
  price?: string;
  quantity?: string;
  regionOrigin?: string;
  rawPayload?: string;
}

/** Append a REJECTED_DUPLICATE event when the idempotency_key constraint fires. */
export async function writeRejectedDuplicateEvent(
  input: RejectedDuplicateEventInput,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await putEvent({
    symbol: input.symbol,
    event_sk: `${createdAt}#duplicate#${input.idempotencyKey}`,
    order_id: '',
    side: input.side ?? 'BUY',
    price: input.price ?? '0',
    quantity: input.quantity ?? '0',
    region_origin: input.regionOrigin ?? 'unknown',
    event_type: 'REJECTED_DUPLICATE',
    idempotency_key: input.idempotencyKey,
    raw_payload: input.rawPayload ?? '',
    created_at: createdAt,
  });
}

/** Count all events for a symbol (paginated). Used by the load-test gate. */
export async function countEvents(symbol: string): Promise<number> {
  const doc = getDocumentClient();
  const table = getTableName();
  let total = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: '#sym = :symbol',
        ExpressionAttributeNames: { '#sym': 'symbol' },
        ExpressionAttributeValues: { ':symbol': symbol },
        Select: 'COUNT',
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    total += result.Count ?? 0;
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return total;
}

/** Read the most recent events for a symbol, newest first (UI audit log). */
export async function getRecentEvents(symbol: string, limit = 50): Promise<OrderEvent[]> {
  const result = await getDocumentClient().send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: '#sym = :symbol',
      ExpressionAttributeNames: { '#sym': 'symbol' },
      ExpressionAttributeValues: { ':symbol': symbol },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as OrderEvent[];
}
