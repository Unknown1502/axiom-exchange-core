/**
 * @axiom/shared-types — the canonical vocabulary of the AXIOM exchange core.
 *
 * Every package speaks these types. Enums are defined once here as `const`
 * tuples so the SQL CHECK constraints, the Zod validators, and the TypeScript
 * unions can never drift apart.
 */

import { z } from 'zod';

export * from './decimal.js';

// ---------------------------------------------------------------------------
// Enumerations (single source of truth, mirrored by SQL CHECK constraints)
// ---------------------------------------------------------------------------

export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type Side = (typeof ORDER_SIDES)[number];

/**
 * Time-in-force / execution instructions, mirrored by the order_book CHECK.
 *   GTC       — good-till-cancelled: fill what crosses now, rest the remainder
 *               (the original, default behavior).
 *   IOC       — immediate-or-cancel: fill what crosses now, cancel the remainder
 *               (never rests on the book).
 *   FOK       — fill-or-kill: fill the ENTIRE quantity immediately or nothing at
 *               all (no partial fills, no resting).
 *   POST_ONLY — must add liquidity: reject outright if it would cross (take) any
 *               resting order, so a maker can never accidentally pay taker terms.
 */
export const ORDER_TYPES = ['GTC', 'IOC', 'FOK', 'POST_ONLY'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ['OPEN', 'PARTIAL', 'FILLED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const REGIONS = ['us', 'eu', 'apac'] as const;
export type Region = (typeof REGIONS)[number];

export const EVENT_TYPES = ['SUBMITTED', 'MATCHED', 'REJECTED_DUPLICATE'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Input validation — the trust boundary. Untyped/untrusted input becomes a
// strongly-typed `SubmitOrderInput` only after passing this schema.
// ---------------------------------------------------------------------------

/** A NUMERIC(18,8)-compatible positive decimal string, e.g. "100.50000000". */
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')
  .refine((s) => Number(s) > 0, 'must be greater than zero')
  .refine((s) => (s.split('.')[1]?.length ?? 0) <= 8, 'max 8 decimal places');

export const SubmitOrderInputSchema = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(ORDER_SIDES),
  price: positiveDecimalString,
  quantity: positiveDecimalString,
  region_origin: z.enum(REGIONS),
  /**
   * Time-in-force. Optional for backward compatibility — omitting it yields a
   * GTC order, the original behavior, so existing callers are unaffected.
   */
  order_type: z.enum(ORDER_TYPES).default('GTC'),
  /**
   * The owning account. Optional; defaults to 'anonymous'. Self-trade prevention
   * only acts when a *non*-anonymous account would match its own resting order,
   * so anonymous order flow (and every existing test) never self-prevents.
   */
  account_id: z.string().min(1).max(128).default('anonymous'),
  /**
   * The client-supplied dedup token. The database UNIQUE constraint on this
   * column is the literal safeguard against the Knight Capital failure mode:
   * a retried/duplicate submission with the same key cannot be inserted twice.
   */
  idempotency_key: z.string().min(1).max(128),
});

/**
 * The *caller-facing* input type. Uses `z.input` so `order_type` and
 * `account_id` are OPTIONAL to supply (they have schema defaults) — existing
 * call sites that omit them still type-check. After `.parse()` the values are
 * always present; use `ParsedSubmitOrderInput` for the post-validation shape.
 */
export type SubmitOrderInput = z.input<typeof SubmitOrderInputSchema>;

/** The post-validation shape, with all defaults applied (no optionals). */
export type ParsedSubmitOrderInput = z.output<typeof SubmitOrderInputSchema>;

// ---------------------------------------------------------------------------
// Persisted entities (shape returned from Aurora DSQL / Postgres)
// ---------------------------------------------------------------------------

export interface OrderRow {
  order_id: string;
  symbol: string;
  side: Side;
  order_type: OrderType;
  account_id: string;
  price: string;
  quantity: string;
  remaining_quantity: string;
  status: OrderStatus;
  region_origin: Region;
  idempotency_key: string;
  created_at: string;
}

export interface TradeRow {
  trade_id: string;
  symbol: string;
  buy_order_id: string;
  sell_order_id: string;
  price: string;
  quantity: string;
  executed_at: string;
}

// ---------------------------------------------------------------------------
// Matching results
// ---------------------------------------------------------------------------

/** One execution produced while matching an incoming order. */
export interface Fill {
  trade_id: string;
  /** The resting order on the other side of this fill. */
  counterparty_order_id: string;
  price: string;
  quantity: string;
}

/**
 * The outcome of `submitOrder`. A discriminated union so callers must handle
 * the duplicate-rejection path explicitly — it can never be confused with a
 * successful match.
 */
export type SubmitOrderResult =
  | {
      outcome: 'ACCEPTED';
      order_id: string;
      order_type: OrderType;
      status: OrderStatus;
      filled_quantity: string;
      fills: Fill[];
      /**
       * Quantity that went unfilled because self-trade prevention skipped the
       * caller's own resting liquidity. 0 unless STP actually fired. Surfaced so
       * callers can distinguish "no liquidity" from "skipped my own orders".
       */
      stp_skipped_quantity: string;
      /** OCC transaction attempts used before commit (1 = no contention). */
      attempts: number;
    }
  | {
      outcome: 'REJECTED_DUPLICATE';
      idempotency_key: string;
      attempts: number;
    }
  | {
      /** A POST_ONLY order that would have crossed (taken) resting liquidity. */
      outcome: 'REJECTED_POST_ONLY';
      order_id: string;
      attempts: number;
    };

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an INSERT violates the UNIQUE(idempotency_key) constraint.
 * This is a terminal, NON-retryable condition: the order already exists, so the
 * correct response is `REJECTED_DUPLICATE`, never a retry.
 */
export class DuplicateOrderError extends Error {
  public readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`Duplicate order rejected for idempotency_key="${idempotencyKey}"`);
    this.name = 'DuplicateOrderError';
    this.idempotencyKey = idempotencyKey;
  }
}

/** Thrown when an OCC conflict could not be resolved within the retry budget. */
export class RetryExhaustedError extends Error {
  public readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(`Transaction failed after ${attempts} OCC attempts`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.cause = cause;
  }
}
