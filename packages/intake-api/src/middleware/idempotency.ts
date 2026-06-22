/**
 * Idempotency-Key handling.
 *
 * The client supplies an `Idempotency-Key` header. This key becomes the order's
 * `idempotency_key`, which the database UNIQUE constraint uses to reject
 * duplicate/retried submissions. If a client omits the header we generate one,
 * so a single accidental double-submit without a key is still two distinct
 * orders (the client opts into dedup by sending a stable key — exactly what
 * Knight Capital Mode does).
 */

import { randomUUID } from 'node:crypto';

export function resolveIdempotencyKey(headerValue: string | string[] | undefined): string {
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue) && headerValue[0] && headerValue[0].trim().length > 0) {
    return headerValue[0].trim();
  }
  return randomUUID();
}
