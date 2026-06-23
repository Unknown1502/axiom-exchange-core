/**
 * @axiom/database — connection pooling, the OCC transaction runner, and the
 * migration system. Everything that touches Aurora DSQL / Postgres lives here.
 */

export { createPool } from './pool.js';
export type { Pool, PoolClient, PoolOptions } from './pool.js';
export { createMultiRegionPools } from './multiregion.js';
export type {
  MultiRegionPools,
  RegionEndpoint,
  RegionalClusterConfig,
} from './multiregion.js';
export {
  withOccRetry,
  isRetryableConflict,
  type OccOptions,
  type OccResult,
} from './occ.js';
export { migrate } from './migrate.js';
