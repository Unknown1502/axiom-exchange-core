import type {
  BookSnapshot,
  FirehoseEvent,
  OrderType,
  RegionCode,
  Side,
  TradeView,
} from './types';

/**
 * Client API helpers. All calls go to same-origin Next.js route handlers under
 * /api/*, which proxy to the Fastify intake API server-side. This keeps the
 * browser on one origin and lets deployment point INTAKE_API_URL anywhere.
 */

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  price: string;
  quantity: string;
  region: RegionCode;
  idempotencyKey: string;
  /** Time-in-force; omitted/GTC keeps the original resting behavior. */
  orderType?: OrderType;
  /** Owning account; blank/omitted means anonymous (no self-trade prevention). */
  accountId?: string;
}

export interface PlaceOrderResult {
  status: number;
  ok: boolean;
  body: unknown;
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
      'X-Region': input.region,
    },
    body: JSON.stringify({
      symbol: input.symbol,
      side: input.side,
      price: input.price,
      quantity: input.quantity,
      // Only send when set so the server applies its defaults (GTC / anonymous).
      ...(input.orderType && input.orderType !== 'GTC' ? { order_type: input.orderType } : {}),
      ...(input.accountId && input.accountId.trim() ? { account_id: input.accountId.trim() } : {}),
    }),
  });
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

export async function fetchBook(symbol: string): Promise<BookSnapshot> {
  const res = await fetch(`/api/book/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`book ${res.status}`);
  return (await res.json()) as BookSnapshot;
}

export async function fetchTrades(symbol: string): Promise<TradeView[]> {
  const res = await fetch(`/api/trades/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`trades ${res.status}`);
  const data = (await res.json()) as { trades: TradeView[] };
  return data.trades ?? [];
}

export async function fetchEvents(
  symbol: string,
): Promise<{ events: FirehoseEvent[]; available: boolean }> {
  const res = await fetch(`/api/events/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
  if (!res.ok) return { events: [], available: false };
  const data = (await res.json()) as { events: FirehoseEvent[]; available: boolean };
  return { events: data.events ?? [], available: data.available ?? false };
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
