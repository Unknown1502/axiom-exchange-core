/**
 * Region tagging, idempotency-key resolution, and read projections for the
 * Next.js route handlers — the in-process equivalent of the Fastify intake
 * API's middleware and db modules, rewritten against the Web Headers API
 * instead of Fastify request objects.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from '@axiom/database';
import {
  formatScaled,
  parseScaled,
  subScaled,
  type OrderRow,
  type Region,
} from '@axiom/shared-types';

/* ---------------------------------------------------------------- regions -- */

export interface RegionMeta {
  code: Region;
  aws: string;
}

const REGION_META: Record<Region, RegionMeta> = {
  us: { code: 'us', aws: 'us-east-1' },
  eu: { code: 'eu', aws: 'eu-west-1' },
  apac: { code: 'apac', aws: 'ap-southeast-1' },
};

const AWS_TO_CODE: Record<string, Region> = {
  'us-east-1': 'us',
  'eu-west-1': 'eu',
  'ap-southeast-1': 'apac',
};

/** Accept either a region code (`us`) or an AWS region (`us-east-1`); default `us`. */
export function normalizeRegion(input: string | undefined | null): Region {
  if (!input) {
    return 'us';
  }
  const lower = input.toLowerCase();
  if (lower === 'us' || lower === 'eu' || lower === 'apac') {
    return lower;
  }
  return AWS_TO_CODE[lower] ?? 'us';
}

export function awsRegionFor(code: Region): string {
  return REGION_META[code].aws;
}

/** Resolve region from (priority) body value, X-Region header, then env default. */
export function resolveRegion(
  headers: Headers,
  bodyRegion: string | undefined,
): Region {
  return normalizeRegion(bodyRegion ?? headers.get('x-region') ?? process.env.DEMO_REGION);
}

/* ----------------------------------------------------------- idempotency -- */

/**
 * The Idempotency-Key header becomes the order's idempotency_key, which the
 * database UNIQUE constraint uses to reject duplicate/retried submissions. If
 * the client omits it, generate one so an un-keyed double-submit is two distinct
 * orders (clients opt into dedup by sending a stable key — what Knight Capital
 * Mode does).
 */
export function resolveIdempotencyKey(headerValue: string | null): string {
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  return randomUUID();
}

/* ----------------------------------------------------- read projections -- */

export interface BookLevel {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface BookSnapshot {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: string | null;
  timestamp: string;
}

export interface TradeView {
  trade_id: string;
  symbol: string;
  price: string;
  quantity: string;
  buy_order_id: string;
  sell_order_id: string;
  executed_at: string;
}

interface BookRow {
  side: string;
  price: string;
  quantity: string;
  order_count: number;
}

function compareScaledDesc(a: BookLevel, b: BookLevel): number {
  const av = parseScaled(a.price);
  const bv = parseScaled(b.price);
  return av < bv ? 1 : av > bv ? -1 : 0;
}

function compareScaledAsc(a: BookLevel, b: BookLevel): number {
  const av = parseScaled(a.price);
  const bv = parseScaled(b.price);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/** Aggregate the live book into price levels per side, with spread. */
export async function getBookSnapshot(pool: Pool, symbol: string): Promise<BookSnapshot> {
  const { rows } = await pool.query<BookRow>(
    `SELECT side,
            price::text AS price,
            SUM(remaining_quantity)::text AS quantity,
            COUNT(*)::int AS order_count
       FROM order_book
      WHERE symbol = $1
        AND status IN ('OPEN', 'PARTIAL')
        AND remaining_quantity > 0
      GROUP BY side, price`,
    [symbol],
  );

  const toLevel = (r: BookRow): BookLevel => ({
    price: r.price,
    quantity: r.quantity,
    orderCount: r.order_count,
  });

  const bids = rows.filter((r) => r.side === 'BUY').map(toLevel).sort(compareScaledDesc);
  const asks = rows.filter((r) => r.side === 'SELL').map(toLevel).sort(compareScaledAsc);

  let spread: string | null = null;
  const bestBid = bids[0];
  const bestAsk = asks[0];
  if (bestBid && bestAsk) {
    spread = formatScaled(subScaled(parseScaled(bestAsk.price), parseScaled(bestBid.price)));
  }

  return { symbol, bids, asks, spread, timestamp: new Date().toISOString() };
}

/** Most recent trades for a symbol, newest first. */
export async function getRecentTrades(
  pool: Pool,
  symbol: string,
  limit = 50,
): Promise<TradeView[]> {
  const { rows } = await pool.query<TradeView>(
    `SELECT trade_id,
            symbol,
            price::text AS price,
            quantity::text AS quantity,
            buy_order_id,
            sell_order_id,
            executed_at::text AS executed_at
       FROM trades
      WHERE symbol = $1
      ORDER BY executed_at DESC, trade_id DESC
      LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

/** Look up a single order by id. */
export async function getOrderById(pool: Pool, orderId: string): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT order_id,
            symbol,
            side,
            order_type,
            account_id,
            price::text AS price,
            quantity::text AS quantity,
            remaining_quantity::text AS remaining_quantity,
            status,
            region_origin,
            idempotency_key,
            created_at::text AS created_at
       FROM order_book
      WHERE order_id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}
