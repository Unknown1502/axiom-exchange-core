/**
 * Smoke test: connect to the real Aurora DSQL cluster and run a trivial query.
 * This is the gate — nothing downstream matters until this prints ✅.
 *
 * Requires in .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * DSQL_CLUSTER_ENDPOINT (printed by `npm run provision:aws`).
 *
 * Usage: `npm run test:dsql:connect`
 */

import { config as loadEnv } from 'dotenv';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';

loadEnv();

const region = process.env.AWS_REGION ?? process.env.DSQL_REGION ?? 'us-east-1';
const endpoint = process.env.DSQL_CLUSTER_ENDPOINT ?? process.env.DSQL_ENDPOINT;

async function main(): Promise<void> {
  if (!endpoint) {
    throw new Error('DSQL_CLUSTER_ENDPOINT is not set in .env (run `npm run provision:aws` first).');
  }

  console.log(`Generating admin auth token for ${endpoint}...`);
  const signer = new DsqlSigner({ hostname: endpoint, region });
  const token = await signer.getDbConnectAdminAuthToken();

  const client = new pg.Client({
    host: endpoint,
    port: 5432,
    database: 'postgres',
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
  });

  await client.connect();
  const result = await client.query<{ version: string }>('SELECT version()');
  console.log('✅ Connected to Aurora DSQL');
  console.log(`   ${result.rows[0]?.version ?? '(no version returned)'}`);
  await client.end();
}

main().catch((err: unknown) => {
  console.error('❌ Connection failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
