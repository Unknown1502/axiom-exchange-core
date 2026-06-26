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

/* ─────────────────────────── market-data stream ─────────────────────────── */

export interface MarketStreamHandlers {
  onBook: (book: BookSnapshot) => void;
  onTrades: (trades: TradeView[]) => void;
  /** Called on transport up/down so the UI can show live vs reconnecting. */
  onStatus?: (live: boolean) => void;
}

/**
 * Subscribe to the live market-data feed (SSE) for a symbol. Returns an
 * unsubscribe function. The browser's EventSource reconnects automatically when
 * the bounded server stream ends or the network blips, so the feed is continuous
 * without the caller managing reconnection.
 *
 * Returns `null` when EventSource is unavailable (e.g. SSR), letting the caller
 * fall back to polling.
 */
export function openMarketDataStream(
  symbol: string,
  handlers: MarketStreamHandlers,
): (() => void) | null {
  if (typeof EventSource === 'undefined') return null;

  const es = new EventSource(`/api/stream/${encodeURIComponent(symbol)}`);

  // The server CLOSES the stream every ~25s (Vercel-safety) and EventSource then
  // auto-reconnects — which fires a benign `error`. We must NOT treat that
  // routine reconnect as "stream down", or the live indicator flickers off on
  // every cycle. Instead, only declare the stream dead after a real silence
  // window with no events AND no successful reconnect.
  let lastActivity = Date.now();
  const markLive = (): void => {
    lastActivity = Date.now();
    handlers.onStatus?.(true);
  };

  // Watchdog: if nothing has arrived for a while, the feed is genuinely down.
  const SILENCE_MS = 8000;
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > SILENCE_MS) handlers.onStatus?.(false);
  }, 2000);

  es.addEventListener('open', markLive);

  es.addEventListener('book', (e) => {
    try {
      handlers.onBook(JSON.parse((e as MessageEvent).data) as BookSnapshot);
      markLive();
    } catch {
      /* ignore malformed frame */
    }
  });

  es.addEventListener('trade', (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as { trades: TradeView[] };
      handlers.onTrades(payload.trades ?? []);
      markLive();
    } catch {
      /* ignore malformed frame */
    }
  });

  // 'error' fires both on the routine bounded-stream reconnect AND on a real
  // outage. Don't flip the indicator here — the watchdog above downgrades to
  // "not streaming" only after a genuine silence window, so a normal reconnect
  // never causes a flicker.
  es.addEventListener('error', () => {
    /* auto-reconnect handled by EventSource; watchdog tracks real silence */
  });

  return () => {
    clearInterval(watchdog);
    es.close();
  };
}
