import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Vitest config for tests that exercise the real `bun:sqlite` connection.
 *
 * These tests MUST run under the Bun runtime (`bunx --bun vitest`) because
 * production runs on Bun and `bun:sqlite` is not resolvable under Node — the
 * module fails to load at transform time. They are kept out of the default
 * Node-based workspace run (see `vitest.config.ts`, which excludes
 * `*.bun.test.ts`) so the rest of the suite stays on Node.
 *
 * Run with: `bun run test:bun` (from the repo root).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.bun.test.ts', 'tests/**/*.bun.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@fleex/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
