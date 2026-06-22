import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@axiom/shared-types': resolvePath('./packages/shared-types/src/index.ts'),
      '@axiom/database': resolvePath('./packages/database/src/index.ts'),
      '@axiom/matching-engine': resolvePath('./packages/matching-engine/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Provisions a real Postgres before the suite: uses an already-running one
    // (Docker / Aurora DSQL) if reachable, else starts embedded Postgres.
    globalSetup: ['./tests/global-setup.ts'],
    // The concurrency tests share one database; never run test files in
    // parallel against it, and give them room for OCC retries under load.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
