/**
 * Pool resolution for the intake API — bridges single-Region and multi-Region
 * deployments behind one interface so the routes don't care which they run on.
 *
 * - Single-Region (local Postgres / one DSQL cluster): every region resolves to
 *   the same pool. This is the default and what `npm test` / local dev use.
 * - Multi-Region (two peered DSQL clusters): a write tagged X-Region: eu is sent
 *   to the eu endpoint; X-Region: us to the us endpoint. Because the clusters are
 *   one strongly-consistent logical database, reads may use either; we keep a
 *   designated read pool for stable demo behavior.
 *
 * Toggle: set MULTIREGION=1 (and the DSQL_ENDPOINT_* env) to enable multi-Region.
 */

import { createPool, createMultiRegionPools, type Pool } from '@axiom/database';

export interface PoolResolver {
  /** Pool to write to for a given region label ('us' | 'eu' | 'apac'). */
  writePool(region: string | undefined): Pool;
  /** Pool to read from (read models / book / trades). Any endpoint is consistent. */
  readPool(): Pool;
  /** Whether multi-Region routing is active (for /health + logging). */
  multiRegion: boolean;
  closeAll(): Promise<void>;
}

export function createPoolResolver(): PoolResolver {
  const multiRegion = process.env.MULTIREGION === '1' || process.env.MULTIREGION === 'true';

  if (multiRegion) {
    const mr = createMultiRegionPools(15);
    return {
      multiRegion: true,
      writePool: (region) => mr.forRegion(region),
      // Reads default to the us endpoint; strong consistency means it sees writes
      // committed via the eu endpoint with no lag.
      readPool: () => mr.pools.us,
      closeAll: () => mr.closeAll(),
    };
  }

  const pool = createPool({ max: 30 });
  return {
    multiRegion: false,
    writePool: () => pool,
    readPool: () => pool,
    closeAll: () => pool.end(),
  };
}
