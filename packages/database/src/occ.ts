/**
 * Optimistic Concurrency Control (OCC) transaction runner — the mechanism that
 * makes AXIOM correct under concurrency on Aurora DSQL.
 *
 * Aurora DSQL runs every transaction at REPEATABLE READ and is lock-free: it
 * never blocks on row locks, and instead validates at COMMIT time. If two
 * transactions modified the same row, the later committer is rejected with
 * `ERROR: change conflicts with another transaction (OC000) (SQLSTATE 40001)`.
 * Stock Postgres at REPEATABLE READ raises the identical SQLSTATE 40001
 * ("could not serialize access due to concurrent update"), which is why the
 * local concurrency proof faithfully exercises this code path.
 *
 * The contract: the caller's transaction body MUST be idempotent with respect
 * to retries (AXIOM's is — every attempt re-derives order ids and re-reads the
 * book from a fresh snapshot). On a 40001 we ROLLBACK and re-run the whole body
 * against a new snapshot, with bounded, jittered backoff.
 *
 * Reference: AWS Aurora DSQL — "Concurrency control in Aurora DSQL".
 */

import type { Pool, PoolClient } from 'pg';
import { RetryExhaustedError } from '@axiom/shared-types';

/** SQLSTATE 40001 — serialization failure. Aurora DSQL OCC conflict (OC000/OC001). */
const SQLSTATE_SERIALIZATION_FAILURE = '40001';
/** SQLSTATE 40P01 — deadlock (stock Postgres pessimistic path; treated as retryable). */
const SQLSTATE_DEADLOCK = '40P01';

export interface OccOptions {
  /** Maximum attempts before giving up with RetryExhaustedError. Default 50. */
  maxAttempts?: number;
  /** Base backoff in milliseconds between retries. Default 5. */
  baseBackoffMs?: number;
  /** Upper bound on a single backoff sleep. Default 250ms. */
  maxBackoffMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 100;
const DEFAULT_BASE_BACKOFF_MS = 5;
const DEFAULT_MAX_BACKOFF_MS = 250;

export interface OccResult<T> {
  value: T;
  /** Number of attempts taken (1 means committed with no contention). */
  attempts: number;
}

/** Narrow an unknown error to its Postgres SQLSTATE, if present. */
function sqlState(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** True for OCC serialization failures / deadlocks that warrant a retry. */
export function isRetryableConflict(error: unknown): boolean {
  const code = sqlState(error);
  return code === SQLSTATE_SERIALIZATION_FAILURE || code === SQLSTATE_DEADLOCK;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` inside a REPEATABLE READ transaction, retrying on OCC conflicts.
 *
 * Non-conflict errors (e.g. DuplicateOrderError from a UNIQUE violation) are
 * NOT retried — they propagate immediately so the caller can handle them.
 */
export async function withOccRetry<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options: OccOptions = {},
): Promise<OccResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoff = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoff = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const value = await fn(client);
      await client.query('COMMIT');
      return { value, attempts: attempt };
    } catch (error) {
      // Best-effort rollback; ignore secondary failures on an already-broken tx.
      await client.query('ROLLBACK').catch(() => undefined);

      if (!isRetryableConflict(error)) {
        throw error; // terminal (e.g. duplicate) — surface immediately
      }

      lastError = error;
      if (attempt < maxAttempts) {
        // Exponential backoff with full jitter to de-synchronize contenders.
        const ceiling = Math.min(maxBackoff, baseBackoff * 2 ** (attempt - 1));
        await sleep(Math.random() * ceiling);
      }
    } finally {
      client.release();
    }
  }

  throw new RetryExhaustedError(maxAttempts, lastError);
}
