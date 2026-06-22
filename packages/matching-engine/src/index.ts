/**
 * @axiom/matching-engine — the order-matching core.
 *
 * `submitOrder` is the ONLY public entry point and the ONLY code path that
 * writes to the `trades` ledger.
 */

export { submitOrder } from './engine.js';
