/**
 * Run the concurrency proofs against REAL Aurora DSQL (not local Postgres).
 *
 * Generates a fresh admin auth token, builds a DSQL connection string, and runs
 * the existing Vitest concurrency suite with that connection injected via the
 * environment (so the test workers connect to Aurora DSQL). The suite's
 * global-setup skips the embedded-Postgres path when USE_DSQL=true.
 *
 * Requires in .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * DSQL_CLUSTER_ENDPOINT.
 *
 * Usage: `npm run test:dsql`
 */

import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { DsqlSigner } from '@aws-sdk/dsql-signer';

loadEnv();

const region = process.env.AWS_REGION ?? process.env.DSQL_REGION ?? 'us-east-1';
const endpoint = process.env.DSQL_CLUSTER_ENDPOINT ?? process.env.DSQL_ENDPOINT;

async function main(): Promise<void> {
  if (!endpoint) {
    throw new Error('DSQL_CLUSTER_ENDPOINT is not set in .env (run `npm run provision:aws` first).');
  }

  const signer = new DsqlSigner({ hostname: endpoint, region });
  const token = await signer.getDbConnectAdminAuthToken();
  const databaseUrl = `postgresql://admin:${encodeURIComponent(token)}@${endpoint}:5432/postgres?sslmode=require`;

  console.log(`Running concurrency proofs against Aurora DSQL (${endpoint})...\n`);

  const child = spawn('npx', ['vitest', 'run', 'tests/concurrency'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: 'require',
      DATABASE_TARGET: 'dsql',
      USE_DSQL: 'true',
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((err: unknown) => {
  console.error('Failed to launch DSQL tests:', err instanceof Error ? err.message : err);
  process.exit(1);
});
