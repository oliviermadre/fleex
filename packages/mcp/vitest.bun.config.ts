import { defineConfig } from 'vitest/config';

/**
 * Vitest config for tests that introspect the REAL CLI command tree.
 *
 * `buildProgram()` discovers commands with `Bun.Glob` and `import.meta.dir`,
 * neither of which resolves under Node — so the parity test MUST run under the
 * Bun runtime (`bunx --bun vitest`). It is kept out of the default Node-based
 * workspace run (see `vitest.config.ts`, which excludes `*.bun.test.ts`).
 *
 * Run with: `bun run test:bun` (from the repo root).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.bun.test.ts', 'tests/**/*.bun.test.ts'],
    testTimeout: 20000,
  },
});
