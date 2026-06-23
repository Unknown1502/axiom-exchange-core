/**
 * Apply the AXIOM schema to a multi-Region Aurora DSQL cluster.
 *
 * A multi-Region cluster is ONE logical database, so the schema only needs to be
 * applied ONCE. We migrate via the US endpoint, then VERIFY the tables are
 * visible from the EU endpoint — which is itself a small proof of the
 * single-logical-database, strong-consistency property.
 *
 * Requires .env: DSQL_ENDPOINT_US/REGION_US, DSQL_ENDPOINT_EU/REGION_EU
 * (printed by `npm run provision:aws:multiregion`).
 *
 * Usage: `npm run db:migrate:dsql:multiregion`
 */

import { config as loadEnv } from 'dotenv';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';
import { migrate } from '@axiom/database';

loadEnv();

async function poolFor(endpoint: string, region: string): Promise<pg.Pool> {
  const signer = new DsqlSigner({ hostname: endpoint, region });
  return new pg.Pool({
    host: endpoint,
    port: 5432,
    user: 'admin',
    database: 'postgres',
    password: async () => signer.getDbConnectAdminAuthToken(),
    ssl: { rejectUnauthorized: true },
    max: 5,
  });
}

async function main(): Promise<void> {
  const usEndpoint = process.env.DSQL_ENDPOINT_US;
  const usRegion = process.env.DSQL_REGION_US ?? 'us-east-1';
  const euEndpoint = process.env.DSQL_ENDPOINT_EU;
  const euRegion = process.env.DSQL_REGION_EU ?? 'us-east-2';

  if (!usEndpoint || !euEndpoint) {
    throw new Error(
      'Set DSQL_ENDPOINT_US and DSQL_ENDPOINT_EU in .env ' +
        '(run `npm run provision:aws:multiregion` first).',
    );
  }

  // Emit DSQL-flavored DDL (CREATE INDEX ASYNC, one DDL per transaction).
  process.env.DATABASE_TARGET = 'dsql';

  const usPool = await poolFor(usEndpoint, usRegion);
  const euPool = await poolFor(euEndpoint, euRegion);

  try {
    console.log(`Applying migrations via US endpoint (${usRegion})...`);
    const applied = await migrate(usPool);
    console.log(
      applied.length > 0
        ? `  applied ${applied.length} migration(s).`
        : '  already up to date.',
    );

    console.log(`Verifying schema is visible from EU endpoint (${euRegion})...`);
    const { rows } = await euPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_name IN ('order_book', 'trades')
          GROUP BY 1 HAVING COUNT(DISTINCT table_name) = 2
       ) AS exists`,
    );
    const visible = rows[0]?.exists === true;
    console.log(`  order_book + trades visible from EU: ${visible ? 'YES ✅' : 'NO ❌'}`);
    if (!visible) {
      throw new Error('Schema not visible from EU endpoint — clusters may not be peered/ACTIVE.');
    }

    console.log('\nDone — multi-Region schema applied and verified across both endpoints.');
  } finally {
    await usPool.end();
    await euPool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Multi-Region DSQL migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
