/**
 * Apply the AXIOM schema to a real Aurora DSQL cluster.
 *
 * Generates a short-lived admin auth token with @aws-sdk/dsql-signer, connects
 * with node-postgres over TLS, and runs the same migrations used locally — with
 * DATABASE_TARGET=dsql so `CREATE INDEX` becomes `CREATE INDEX ASYNC`.
 *
 * Requires in .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * DSQL_CLUSTER_ENDPOINT (printed by `npm run provision:aws`).
 *
 * Usage: `npm run db:migrate:dsql`
 */

import { config as loadEnv } from 'dotenv';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';
import { migrate } from '@axiom/database';

loadEnv();

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DSQL_CLUSTER_ENDPOINT;

async function main(): Promise<void> {
  if (!endpoint) {
    throw new Error('DSQL_CLUSTER_ENDPOINT is not set in .env (run `npm run provision:aws` first).');
  }

  // Ensure the migration runner emits DSQL-flavored DDL (CREATE INDEX ASYNC).
  process.env.DATABASE_TARGET = 'dsql';

  console.log(`Generating admin auth token for ${endpoint}...`);
  const signer = new DsqlSigner({ hostname: endpoint, region });
  const token = await signer.getDbConnectAdminAuthToken();

  const pool = new pg.Pool({
    host: endpoint,
    port: 5432,
    user: 'admin',
    database: 'postgres',
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 5,
  });

  try {
    console.log('Applying migrations to Aurora DSQL...');
    const applied = await migrate(pool);
    console.log(
      applied.length > 0
        ? `\nDone — applied ${applied.length} migration(s) to Aurora DSQL.`
        : '\nDone — Aurora DSQL already up to date.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('DSQL migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
