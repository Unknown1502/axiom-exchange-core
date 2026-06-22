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
  SubmitOrderInputSchema,
  type Fill,
  type OrderStatus,
  type Side,
  type SubmitOrderInput,
  type SubmitOrderResult,
} from '@axiom/shared-types';

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
}

interface MatchOutcome {
  orderId: string;
  status: OrderStatus;
  filledQuantity: string;
  fills: Fill[];
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
async function runMatch(client: PoolClient, input: SubmitOrderInput): Promise<MatchOutcome> {
  const orderId = randomUUID();

  // 1. Reserve the order + its idempotency key. UNIQUE violation = duplicate.
  try {
    await client.query(
      `INSERT INTO order_book
         (order_id, symbol, side, price, quantity, remaining_quantity,
          status, region_origin, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $5, 'OPEN', $6, $7)`,
      [
        orderId,
        input.symbol,
        input.side,
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
    `SELECT order_id, price, remaining_quantity
       FROM order_book
      WHERE symbol = $1
        AND side = $2
        AND status IN ('OPEN', 'PARTIAL')
        AND price ${priceComparator} $3
      ORDER BY price ${priceOrder}, created_at ASC
      LIMIT $4`,
    [input.symbol, oppositeSide(input.side), input.price, MAX_RESTING_ORDERS_PER_MATCH],
  );

  // 3. Walk and fill.
  const totalQuantity = parseScaled(input.quantity);
  let remaining = totalQuantity;
  const fills: Fill[] = [];

  for (const resting of restingOrders) {
    if (!isPositive(remaining)) {
      break;
    }
    const restingRemaining = parseScaled(resting.remaining_quantity);
    if (!isPositive(restingRemaining)) {
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
  const filled = subScaled(totalQuantity, remaining);
  const status: OrderStatus = isZero(remaining)
    ? 'FILLED'
    : isPositive(filled)
      ? 'PARTIAL'
      : 'OPEN';

  await client.query(
    `UPDATE order_book SET remaining_quantity = $1, status = $2 WHERE order_id = $3`,
    [formatScaled(remaining), status, orderId],
  );

  return { orderId, status, filledQuantity: formatScaled(filled), fills };
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
    return {
      outcome: 'ACCEPTED',
      order_id: value.orderId,
      status: value.status,
      filled_quantity: value.filledQuantity,
      fills: value.fills,
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
