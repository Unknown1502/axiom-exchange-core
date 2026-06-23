/**
 * Multi-Region connection registry for Aurora DSQL.
 *
 * AXIOM's multi-Region thesis: ONE logical database, TWO Regional endpoints, both
 * writable with synchronous strong consistency. This module owns one connection
 * pool per Regional endpoint and resolves the right pool for a given region code.
 *
 * Two things make DSQL connections different from a vanilla Postgres pool, and
 * both are handled here:
 *
 *  1. AUTH IS A SHORT-LIVED IAM TOKEN, NOT A STATIC PASSWORD. A DSQL auth token
 *     expires (~15 min), so a long-running server cannot mint one at startup and
 *     hold it. node-postgres lets `password` be an async function invoked per new
 *     connection — we use that to generate a fresh token each time the pool opens
 *     a backend connection, so tokens never go stale.
 *
 *  2. TOKENS ARE PER-REGION. The us-east-1 endpoint needs a token signed for
 *     us-east-1; the us-east-2 endpoint needs one for us-east-2. Each pool is
 *     therefore bound to its own DsqlSigner.
 *
 * The OCC matching transaction does not change at all: a write that contends
 * across Regions surfaces the same SQLSTATE 40001 and retries through
 * withOccRetry exactly as a same-Region conflict does. Active-active correctness
 * is a property of the database; this module just opens the doors to both.
 */

import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

const { Pool, types } = pg;

// Keep NUMERIC as string (see pool.ts for the rationale — avoid float drift).
types.setTypeParser(1700, (value) => value);

let envLoaded = false;
function ensureEnv(): void {
  if (!envLoaded) {
    loadEnv();
    envLoaded = true;
  }
}

/** Demo region labels. "eu" maps to a real but US-located peer Region (honest: a label). */
export type RegionEndpoint = 'us' | 'eu';

export interface RegionalClusterConfig {
  /** Region label used by the app + X-Region header. */
  label: RegionEndpoint;
  /** DSQL endpoint host, e.g. abc123.dsql.us-east-1.on.aws */
  endpoint: string;
  /** AWS region the endpoint lives in, e.g. us-east-1 (used to sign the token). */
  awsRegion: string;
}

export interface MultiRegionPools {
  pools: Record<RegionEndpoint, pg.Pool>;
  /** Resolve the pool for a region label; falls back to "us". */
  forRegion(region: string | undefined): pg.Pool;
  /** Close every pool (graceful shutdown). */
  closeAll(): Promise<void>;
}

/**
 * Build a single DSQL pool whose password is a freshly-signed IAM token per
 * connection. Uses the admin token (admin/postgres) to match the migration path;
 * swap to getDbConnectAuthToken + a non-admin role for least-privilege in prod.
 */
function createDsqlPool(config: RegionalClusterConfig, max: number): pg.Pool {
  const signer = new DsqlSigner({ hostname: config.endpoint, region: config.awsRegion });

  return new Pool({
    host: config.endpoint,
    port: 5432,
    user: 'admin',
    database: 'postgres',
    // node-postgres calls this for every new backend connection, so every
    // connection authenticates with a fresh, unexpired token.
    password: async () => signer.getDbConnectAdminAuthToken(),
    ssl: { rejectUnauthorized: true },
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Read the two regional endpoints from the environment (printed by
 * provision-aws-multiregion.ts) and build a pool for each.
 *
 * Required env: DSQL_ENDPOINT_US, DSQL_REGION_US, DSQL_ENDPOINT_EU, DSQL_REGION_EU
 */
export function createMultiRegionPools(maxPerRegion = 15): MultiRegionPools {
  ensureEnv();

  const usEndpoint = process.env.DSQL_ENDPOINT_US;
  const usRegion = process.env.DSQL_REGION_US ?? 'us-east-1';
  const euEndpoint = process.env.DSQL_ENDPOINT_EU;
  const euRegion = process.env.DSQL_REGION_EU ?? 'us-east-2';

  if (!usEndpoint || !euEndpoint) {
    throw new Error(
      'Multi-Region endpoints not set. Run `npm run provision:aws:multiregion` and add ' +
        'DSQL_ENDPOINT_US / DSQL_REGION_US / DSQL_ENDPOINT_EU / DSQL_REGION_EU to .env.',
    );
  }

  const configs: Record<RegionEndpoint, RegionalClusterConfig> = {
    us: { label: 'us', endpoint: usEndpoint, awsRegion: usRegion },
    eu: { label: 'eu', endpoint: euEndpoint, awsRegion: euRegion },
  };

  const pools: Record<RegionEndpoint, pg.Pool> = {
    us: createDsqlPool(configs.us, maxPerRegion),
    eu: createDsqlPool(configs.eu, maxPerRegion),
  };

  function forRegion(region: string | undefined): pg.Pool {
    // "apac" (and anything unknown) is routed to the EU peer for the 2-region
    // demo; with a 3rd peered cluster it would get its own pool.
    if (region === 'eu' || region === 'apac') return pools.eu;
    return pools.us;
  }

  async function closeAll(): Promise<void> {
    await Promise.all([pools.us.end(), pools.eu.end()]);
  }

  return { pools, forRegion, closeAll };
}
