/**
 * The AXIOM matching engine.
 *
 * THE ONE RULE: every trade-affecting write happens inside a single OCC
 * transaction (see withOccRetry). There is no "fast path". Reintroducing one is
 * the Knight Capital failure mode. The whole project's correctness claim rests
 * on this function being the only producer of rows in `trades`.
 *
 * Algorithm (continuous price-time priority):
 *   1. INSERT the incoming order, reserving its idempotency_key. A UNIQUE
 *      violation here is a duplicate submission → REJECTED_DUPLICATE (terminal).
 *   2. SELECT crossing resting orders on the opposite side, best price first,
 *      then oldest first (price-time priority).
 *   3. Walk them, filling min(incoming_remaining, resting_remaining) at the
 *      resting (maker) price, decrementing both sides and inserting a trade per
 *      fill, until the incoming order is exhausted or no crossing liquidity
 *      remains.
 *   4. UPDATE the incoming order's remaining_quantity/status.
 *
 * Concurrency: if a competing transaction touched any row this attempt read or
 * wrote, COMMIT fails with SQLSTATE 40001 and withOccRetry transparently re-runs
 * the whole body against a fresh snapshot. Because contending matchers always
 * write the SAME resting rows, the conflict is a write-write conflict that OCC
 * always detects — so the book can never be double-filled or driven negative.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withOccRetry, type Pool } from '@axiom/database';
import {
  DuplicateOrderError,
  formatScaled,
  isPositive,
  isZero,
  minScaled,
  parseScaled,
  subScaled,
  addScaled,
  ZERO_SCALED,
  SubmitOrderInputSchema,
  type Fill,
  type OrderStatus,
  type ParsedSubmitOrderInput,
  type Side,
  type SubmitOrderInput,
  type SubmitOrderResult,
} from '@axiom/shared-types';

/** Account id that opts OUT of self-trade prevention (the default identity). */
const ANONYMOUS_ACCOUNT = 'anonymous';

const SQLSTATE_UNIQUE_VIOLATION = '23505';

/**
 * Maximum resting orders walked per match. Caps row modifications per
 * transaction at ~2 * this + 2, staying safely under Aurora DSQL's 3,000
 * rows-per-transaction limit. A partially-filled incoming order beyond this
 * bound remains PARTIAL/OPEN and can continue on a subsequent submission.
 */
const MAX_RESTING_ORDERS_PER_MATCH = 1000;

interface RestingOrderRow {
  order_id: string;
  price: string;
  remaining_quantity: string;
  account_id: string;
}

interface MatchOutcome {
  orderId: string;
  status: OrderStatus;
  orderType: ParsedSubmitOrderInput['order_type'];
  filledQuantity: string;
  fills: Fill[];
  stpSkippedQuantity: string;
  /** True only for a POST_ONLY order that would have crossed → caller rejects. */
  postOnlyRejected: boolean;
}

/** Opposite side that an incoming order matches against. */
function oppositeSide(side: Side): Side {
  return side === 'BUY' ? 'SELL' : 'BUY';
}

/**
 * The matching transaction body. Runs entirely inside one OCC transaction
 * supplied by withOccRetry. Must be safe to re-run on retry (it is: a fresh
 * order_id is generated each call and all state is re-read from the snapshot).
 */
async function runMatch(
  client: PoolClient,
  input: ParsedSubmitOrderInput,
): Promise<MatchOutcome> {
  const orderId = randomUUID();

  // 1. Reserve the order + its idempotency key. UNIQUE violation = duplicate.
  try {
    await client.query(
      `INSERT INTO order_book
         (order_id, symbol, side, order_type, account_id, price, quantity,
          remaining_quantity, status, region_origin, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'OPEN', $8, $9)`,
      [
        orderId,
        input.symbol,
        input.side,
        input.order_type,
        input.account_id,
        input.price,
        input.quantity,
        input.region_origin,
        input.idempotency_key,
      ],
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === SQLSTATE_UNIQUE_VIOLATION
    ) {
      throw new DuplicateOrderError(input.idempotency_key);
    }
    throw error;
  }

  // 2. Read crossing resting liquidity in price-time priority.
  //    BUY  crosses SELLs priced <= bid, cheapest first.
  //    SELL crosses BUYs  priced >= ask, highest first.
  const priceComparator = input.side === 'BUY' ? '<=' : '>=';
  const priceOrder = input.side === 'BUY' ? 'ASC' : 'DESC';

  const { rows: restingOrders } = await client.query<RestingOrderRow>(
    `SELECT order_id, price, remaining_quantity, account_id
       FROM order_book
      WHERE symbol = $1
        AND side = $2
        AND status IN ('OPEN', 'PARTIAL')
        AND price ${priceComparator} $3
      ORDER BY price ${priceOrder}, created_at ASC
      LIMIT $4`,
    [input.symbol, oppositeSide(input.side), input.price, MAX_RESTING_ORDERS_PER_MATCH],
  );

  // Self-trade prevention: a non-anonymous account never matches its own resting
  // liquidity. Anonymous flow (and every existing proof) skips nothing.
  const stpActive = input.account_id !== ANONYMOUS_ACCOUNT;
  const wouldSelfTrade = (resting: RestingOrderRow): boolean =>
    stpActive && resting.account_id === input.account_id;

  // FOK / POST_ONLY both need to know how much would cross BEFORE writing any
  // trade, so they can be all-or-nothing / never-cross. Compute it from the same
  // snapshot, honoring STP skips, capped at the incoming quantity.
  const totalQuantity = parseScaled(input.quantity);
  if (input.order_type === 'FOK' || input.order_type === 'POST_ONLY') {
    let crossable = ZERO_SCALED;
    for (const resting of restingOrders) {
      if (wouldSelfTrade(resting)) {
        continue;
      }
      const restingRemaining = parseScaled(resting.remaining_quantity);
      if (!isPositive(restingRemaining)) {
        continue;
      }
      crossable = addScaled(crossable, restingRemaining);
      if (!(crossable < totalQuantity)) {
        break; // already enough to fully fill; no need to keep summing
      }
    }

    // POST_ONLY must add liquidity — if it would cross at all, reject it.
    if (input.order_type === 'POST_ONLY' && isPositive(crossable)) {
      await client.query(
        `UPDATE order_book SET remaining_quantity = '0', status = 'CANCELLED'
          WHERE order_id = $1`,
        [orderId],
      );
      return {
        orderId,
        status: 'CANCELLED',
        orderType: input.order_type,
        filledQuantity: '0.00000000',
        fills: [],
        stpSkippedQuantity: '0.00000000',
        postOnlyRejected: true,
      };
    }

    // FOK must fill in full or not at all — if not enough crosses, kill it.
    if (input.order_type === 'FOK' && crossable < totalQuantity) {
      await client.query(
        `UPDATE order_book SET remaining_quantity = '0', status = 'CANCELLED'
          WHERE order_id = $1`,
        [orderId],
      );
      return {
        orderId,
        status: 'CANCELLED',
        orderType: input.order_type,
        filledQuantity: '0.00000000',
        fills: [],
        stpSkippedQuantity: '0.00000000',
        postOnlyRejected: false,
      };
    }
  }

  // 3. Walk and fill. (totalQuantity was parsed above for FOK/POST_ONLY.)
  let remaining = totalQuantity;
  let stpSkipped = ZERO_SCALED;
  const fills: Fill[] = [];

  for (const resting of restingOrders) {
    if (!isPositive(remaining)) {
      break;
    }
    const restingRemaining = parseScaled(resting.remaining_quantity);
    if (!isPositive(restingRemaining)) {
      continue;
    }

    // Self-trade prevention: never match the caller's own resting liquidity.
    // Record what we declined to fill so the caller can see STP fired.
    if (wouldSelfTrade(resting)) {
      stpSkipped = addScaled(stpSkipped, minScaled(remaining, restingRemaining));
      continue;
    }

    const fillQuantity = minScaled(remaining, restingRemaining);
    const restingAfter = subScaled(restingRemaining, fillQuantity);
    const restingStatus: OrderStatus = isZero(restingAfter) ? 'FILLED' : 'PARTIAL';

    // Decrement the resting order. The status guard means a concurrently-filled
    // order updates zero rows; the subsequent COMMIT conflict-checks and, on a
    // 40001, the whole match retries against a fresh snapshot.
    await client.query(
      `UPDATE order_book
          SET remaining_quantity = $1, status = $2
        WHERE order_id = $3 AND status IN ('OPEN', 'PARTIAL')`,
      [formatScaled(restingAfter), restingStatus, resting.order_id],
    );

    // Record the execution. Trade price is the resting (maker) order's price.
    const tradeId = randomUUID();
    const buyOrderId = input.side === 'BUY' ? orderId : resting.order_id;
    const sellOrderId = input.side === 'SELL' ? orderId : resting.order_id;

    await client.query(
      `INSERT INTO trades
         (trade_id, symbol, buy_order_id, sell_order_id, price, quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tradeId, input.symbol, buyOrderId, sellOrderId, resting.price, formatScaled(fillQuantity)],
    );

    remaining = subScaled(remaining, fillQuantity);
    fills.push({
      trade_id: tradeId,
      counterparty_order_id: resting.order_id,
      price: resting.price,
      quantity: formatScaled(fillQuantity),
    });
  }

  // 4. Finalize the incoming order's state.
  //    Time-in-force decides what happens to any unfilled remainder:
  //      GTC  → rest it on the book (OPEN / PARTIAL), the original behavior.
  //      IOC  → cancel it; an IOC order never rests. (FOK already returned above
  //             when it couldn't fully fill, so an IOC/FOK reaching here that is
  //             not fully filled cancels its leftover.)
  //      POST_ONLY → only reaches here when it crossed nothing, so it rests like
  //             a maker (GTC semantics for the resting remainder).
  const filled = subScaled(totalQuantity, remaining);
  const restsRemainder = input.order_type === 'GTC' || input.order_type === 'POST_ONLY';

  let status: OrderStatus;
  let persistedRemaining = remaining;
  if (isZero(remaining)) {
    status = 'FILLED';
  } else if (restsRemainder) {
    status = isPositive(filled) ? 'PARTIAL' : 'OPEN';
  } else {
    // IOC / FOK leftover: nothing rests. The order is terminal — FILLED if it
    // happened to clear in full, otherwise CANCELLED (its leftover was killed).
    // What actually executed is the record in `trades`; remaining goes to 0 so
    // the killed quantity can never appear in the book.
    status = 'CANCELLED';
    persistedRemaining = ZERO_SCALED;
  }

  await client.query(
    `UPDATE order_book SET remaining_quantity = $1, status = $2 WHERE order_id = $3`,
    [formatScaled(persistedRemaining), status, orderId],
  );

  return {
    orderId,
    status,
    orderType: input.order_type,
    filledQuantity: formatScaled(filled),
    fills,
    stpSkippedQuantity: formatScaled(stpSkipped),
    postOnlyRejected: false,
  };
}

/**
 * Submit an order to the exchange. Validates input, then runs the matching
 * transaction with OCC retry. Returns a discriminated result; duplicate
 * submissions resolve to `REJECTED_DUPLICATE` rather than throwing.
 *
 * @throws ZodError for malformed input; RetryExhaustedError if OCC conflicts
 *         could not be resolved within the retry budget.
 */
export async function submitOrder(
  pool: Pool,
  rawInput: SubmitOrderInput,
): Promise<SubmitOrderResult> {
  const input = SubmitOrderInputSchema.parse(rawInput);

  try {
    const { value, attempts } = await withOccRetry(pool, (client) => runMatch(client, input));

    // A POST_ONLY order that would have crossed is a rejection, not a fill — it
    // was cancelled without taking liquidity.
    if (value.postOnlyRejected) {
      return {
        outcome: 'REJECTED_POST_ONLY',
        order_id: value.orderId,
        attempts,
      };
    }

    return {
      outcome: 'ACCEPTED',
      order_id: value.orderId,
      order_type: value.orderType,
      status: value.status,
      filled_quantity: value.filledQuantity,
      fills: value.fills,
      stp_skipped_quantity: value.stpSkippedQuantity,
      attempts,
    };
  } catch (error) {
    if (error instanceof DuplicateOrderError) {
      return {
        outcome: 'REJECTED_DUPLICATE',
        idempotency_key: error.idempotencyKey,
        attempts: 1,
      };
    }
    throw error;
  }
}
