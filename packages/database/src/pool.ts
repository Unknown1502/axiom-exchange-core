/**
 * PostgreSQL / Aurora DSQL connection pool.
 *
 * AXIOM connects over the standard Postgres wire protocol, so the same `pg`
 * Pool serves both local Postgres (development + the concurrency proof) and
 * Aurora DSQL (production). The only differences are TLS (DSQL requires it) and
 * authentication (DSQL uses a short-lived IAM token as the password, generated
 * by the provisioning/migration scripts via @aws-sdk/dsql-signer and embedded
 * in DATABASE_URL — see docs/operations/deploy.md).
 */

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const { Pool, types } = pg;

// node-postgres returns NUMERIC as a string by default, which is exactly what
// we want: parsing NUMERIC into a JS float would reintroduce the floating-point
// imprecision the fixed-point decimal module exists to avoid. We assert that
// default here (OID 1700 = numeric) rather than relying on it implicitly.
types.setTypeParser(1700, (value) => value);

let envLoaded = false;
function ensureEnv(): void {
  if (!envLoaded) {
    loadEnv();
    envLoaded = true;
  }
}

export interface PoolOptions {
  /** Overrides DATABASE_URL (used by tests to target an isolated database). */
  connectionString?: string;
  /** Max concurrent connections. Defaults to 20. */
  max?: number;
}

/**
 * Create a connection pool from the environment.
 * @throws if DATABASE_URL is not set and no connectionString is provided.
 */
export function createPool(options: PoolOptions = {}): pg.Pool {
  ensureEnv();

  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env (local dev), or ' +
        'provide options.connectionString.',
    );
  }

  const sslMode = (process.env.DATABASE_SSL ?? 'disable').toLowerCase();
  const ssl = sslMode === 'require' ? { rejectUnauthorized: true } : undefined;

  return new Pool({
    connectionString,
    ...(ssl ? { ssl } : {}),
    max: options.max ?? 20,
    // Fail fast rather than hanging if the database is unreachable.
    connectionTimeoutMillis: 10_000,
    // Aurora DSQL closes idle connections after 1 hour; recycle well before.
    idleTimeoutMillis: 30_000,
  });
}

export type { Pool, PoolClient } from 'pg';
