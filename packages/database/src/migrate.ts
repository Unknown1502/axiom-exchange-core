/**
 * Migration runner.
 *
 * Applies the SQL files in ../migrations in lexical order, tracking applied
 * versions in a `schema_migrations` table so it is safe to re-run (idempotent).
 *
 * Aurora DSQL constraints are respected by construction:
 *   * Each SQL statement runs in its OWN implicit transaction (autocommit), so
 *     DDL and DML never mix and no transaction contains more than one DDL
 *     statement (DSQL limits: 1 DDL/tx; DDL and DML in separate transactions).
 *   * When targeting DSQL, `CREATE INDEX` is rewritten to `CREATE INDEX ASYNC`.
 *
 * Usage: `npm run db:migrate`
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createPool } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * True only when this migration run explicitly targets Aurora DSQL.
 *
 * Gated on the explicit DATABASE_TARGET=dsql opt-in, NOT on the mere presence
 * of DSQL_CLUSTER_ENDPOINT: that variable is set whenever the app needs to
 * *connect* to DSQL, but local development and the concurrency test suite still
 * run their migrations against stock Postgres (which rejects CREATE INDEX
 * ASYNC). The DSQL migration scripts (scripts/migrate-dsql.ts) set
 * DATABASE_TARGET=dsql to switch on the ASYNC rewrite.
 */
function isDsqlTarget(): boolean {
  return process.env.DATABASE_TARGET === 'dsql';
}

/** Split a migration file into individual executable statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);
}

/** Apply DSQL-specific dialect adjustments to a statement. */
function adaptForTarget(statement: string): string {
  if (isDsqlTarget()) {
    return statement.replace(/\bCREATE INDEX\b/gi, 'CREATE INDEX ASYNC');
  }
  return statement;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version     TEXT PRIMARY KEY,
       applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedVersions(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.version));
}

export async function migrate(pool: Pool): Promise<string[]> {
  await ensureMigrationsTable(pool);
  const applied = await appliedVersions(pool);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`• ${file} — already applied, skipping`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(sql).map(adaptForTarget);

    // Each statement is autocommitted on its own to satisfy DSQL's DDL rules.
    for (const statement of statements) {
      await pool.query(statement);
    }
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);

    console.log(`✓ ${file} — applied (${statements.length} statement(s))`);
    newlyApplied.push(file);
  }

  return newlyApplied;
}

// Execute when run directly (npm run db:migrate), not when imported.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const pool = createPool();
  migrate(pool)
    .then((applied) => {
      console.log(
        applied.length > 0
          ? `\nMigration complete — applied ${applied.length} migration(s).`
          : '\nMigration complete — database already up to date.',
      );
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error);
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
