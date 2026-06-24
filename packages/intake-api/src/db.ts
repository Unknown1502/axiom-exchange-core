/**
 * Read queries for the intake API. All writes go through the matching engine;
 * this module is read-only projections of order_book / trades for the UI.
 */

import type { Pool } from '@axiom/database';
import { formatScaled, parseScaled, subScaled, type OrderRow } from '@axiom/shared-types';

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
export async function getRecentTrades(pool: Pool, symbol: string, limit = 50): Promise<TradeView[]> {
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
