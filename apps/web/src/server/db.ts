/**
 * Server-side database access for the Next.js route handlers.
 *
 * This is the production replacement for the standalone Fastify intake API:
 * the /api/* route handlers call the matching engine and read projections
 * against this pool directly, so the entire application runs on Vercel with no
 * separate long-running server.
 *
 * Two connection modes from one code path:
 *
 *   1. Aurora DSQL (production on Vercel) — DSQL has no static password. We mint
 *      a short-lived IAM auth token with @aws-sdk/dsql-signer and use it as the
 *      Postgres password over TLS. The token is cached and refreshed before it
 *      expires so warm serverless invocations reuse one pool.
 *
 *   2. Local Postgres (development) — when DATABASE_URL is set and no
 *      DSQL_CLUSTER_ENDPOINT is present, fall back to the standard connection
 *      string so `npm run dev` works against the local Docker database.
 *
 * The pool is cached on globalThis so it survives module re-evaluation between
 * warm invocations of the same serverless function instance.
 */

import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';

const { Pool, types } = pg;

// Match the @axiom/database convention: keep NUMERIC as a string (OID 1700) so
// fixed-point decimals never pass through a lossy JS float.
types.setTypeParser(1700, (value) => value);

// DSQL auth tokens are valid ~15 minutes; refresh comfortably before expiry.
const TOKEN_TTL_MS = 10 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface PoolCache {
  pool?: pg.Pool;
  /** The endpoint the cached pool was built for; rebuild if it changes. */
  endpoint?: string;
  token?: CachedToken;
}

// Persist across module re-evaluation within a warm function instance.
const globalForDb = globalThis as unknown as { __axiomDb?: PoolCache };
const cache: PoolCache = (globalForDb.__axiomDb ??= {});

function dsqlEndpoint(): string | undefined {
  return process.env.DSQL_CLUSTER_ENDPOINT;
}

function awsRegion(): string {
  return process.env.AWS_REGION ?? 'us-east-1';
}

/** Mint (or reuse) a short-lived DSQL admin auth token for the password field. */
async function getDsqlToken(endpoint: string): Promise<string> {
  const now = Date.now();
  if (cache.token && cache.token.expiresAt > now) {
    return cache.token.token;
  }
  const signer = new DsqlSigner({ hostname: endpoint, region: awsRegion() });
  const token = await signer.getDbConnectAdminAuthToken();
  cache.token = { token, expiresAt: now + TOKEN_TTL_MS };
  return token;
}

/**
 * Build a pool against Aurora DSQL. Because the password (token) rotates, the
 * pool is given a `password` async provider so node-postgres requests a fresh
 * token whenever it opens a new physical connection.
 */
function createDsqlPool(endpoint: string): pg.Pool {
  return new Pool({
    host: endpoint,
    port: 5432,
    user: 'admin',
    database: 'postgres',
    // node-postgres accepts a function that returns the password per connection,
    // so every new connection authenticates with a valid (possibly refreshed)
    // token rather than a stale one baked in at pool creation.
    password: () => getDsqlToken(endpoint),
    ssl: { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

/** Build a pool against a local/standard Postgres from DATABASE_URL. */
function createLocalPool(connectionString: string): pg.Pool {
  const sslMode = (process.env.DATABASE_SSL ?? 'disable').toLowerCase();
  const ssl = sslMode === 'require' ? { rejectUnauthorized: true } : undefined;
  return new Pool({
    connectionString,
    ...(ssl ? { ssl } : {}),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Return the shared connection pool, creating it on first use.
 * Prefers Aurora DSQL when DSQL_CLUSTER_ENDPOINT is set; otherwise uses
 * DATABASE_URL for local development.
 *
 * @throws if neither DSQL_CLUSTER_ENDPOINT nor DATABASE_URL is configured.
 */
export function getPool(): pg.Pool {
  const endpoint = dsqlEndpoint();

  // Rebuild if config changed (e.g. endpoint set after a previous local pool).
  if (cache.pool && cache.endpoint === (endpoint ?? '__local__')) {
    return cache.pool;
  }

  if (endpoint) {
    cache.pool = createDsqlPool(endpoint);
    cache.endpoint = endpoint;
  } else {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'No database configured: set DSQL_CLUSTER_ENDPOINT (production) or ' +
          'DATABASE_URL (local development).',
      );
    }
    cache.pool = createLocalPool(connectionString);
    cache.endpoint = '__local__';
  }

  // A pool-level error handler prevents an unhandled 'error' event (e.g. a
  // dropped idle DSQL connection) from crashing the function instance.
  cache.pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
  });

  return cache.pool;
}

export type { Pool } from 'pg';
