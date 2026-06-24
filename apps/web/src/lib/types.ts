export type Side = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'IOC' | 'FOK' | 'POST_ONLY';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
export type RegionCode = 'us' | 'eu' | 'apac';

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

export interface Fill {
  trade_id: string;
  counterparty_order_id: string;
  price: string;
  quantity: string;
}

export interface PlacedOrder {
  order_id: string;
  symbol: string;
  side: Side;
  order_type: OrderType;
  status: OrderStatus;
  filled_quantity: string;
  /** Quantity skipped because self-trade prevention declined the caller's own resting orders. */
  stp_skipped_quantity: string;
  region_origin: string;
  idempotency_key: string;
}

export interface PlaceOrderResponse {
  order: PlacedOrder;
  trades: Fill[];
  attempts: number;
}

export interface FirehoseEvent {
  symbol: string;
  event_sk: string;
  order_id: string;
  side: Side;
  price: string;
  quantity: string;
  region_origin: string;
  event_type: 'SUBMITTED' | 'MATCHED' | 'REJECTED_DUPLICATE' | 'CANCELLED';
  idempotency_key: string;
  created_at: string;
  trade_id?: string;
  trade_price?: string;
}
