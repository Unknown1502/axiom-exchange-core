/**
 * Vitest global setup — provisions a real PostgreSQL for the concurrency proofs.
 *
 * Strategy:
 *   1. If a Postgres is already reachable at DATABASE_URL (e.g. the Docker
 *      container from `npm run db:up`, or a live Aurora DSQL), use it as-is.
 *   2. Otherwise, start an EMBEDDED PostgreSQL bound to localhost:5432 with the
 *      same credentials the tests expect. This makes the entire concurrency
 *      proof runnable with just `npm test` — no Docker, no manual DB — while
 *      still exercising real Postgres MVCC (REPEATABLE READ + SQLSTATE 40001),
 *      which is the exact behavior Aurora DSQL exhibits under OCC.
 *
 * Workers read DATABASE_URL from .env via the @axiom/database pool; this file
 * only guarantees a server is listening there before the suite starts.
 */

import { config as loadEnv } from 'dotenv';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

loadEnv();

// Derive connection params from DATABASE_URL so the embedded fallback uses the
// exact same host/port/credentials the tests will connect with (e.g. 55432,
// chosen to avoid a native Postgres on the default 5432).
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://axiom:axiom_local_pw@localhost:55432/axiom';
const parsed = new URL(DATABASE_URL);
const PORT = Number(parsed.port || '5432');
const USER = decodeURIComponent(parsed.username) || 'axiom';
const PASSWORD = decodeURIComponent(parsed.password) || 'axiom_local_pw';
const DATABASE = parsed.pathname.replace(/^\//, '') || 'axiom';
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '.pgdata');

let embedded: EmbeddedPostgres | undefined;

async function isReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500, max: 1 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function setup(): Promise<void> {
  // DSQL mode: connection is injected by scripts/test-dsql.ts; never start a
  // local/embedded database — the suite targets the real Aurora DSQL cluster.
  if (process.env.USE_DSQL === 'true') {
    console.log('[global-setup] USE_DSQL=true — targeting external Aurora DSQL; embedded Postgres skipped.');
    return;
  }

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.DATABASE_SSL = 'disable';

  if (await isReachable()) {
    console.log(`[global-setup] Using already-running PostgreSQL at ${parsed.host}`);
    return;
  }

  console.log('[global-setup] No external DB found — starting embedded PostgreSQL...');
  await rm(DATA_DIR, { recursive: true, force: true });
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  });
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase(DATABASE);
  console.log('[global-setup] Embedded PostgreSQL ready at localhost:5432');
}

export async function teardown(): Promise<void> {
  if (embedded) {
    await embedded.stop();
    await rm(DATA_DIR, { recursive: true, force: true }).catch(() => undefined);
    console.log('[global-setup] Embedded PostgreSQL stopped');
  }
}
