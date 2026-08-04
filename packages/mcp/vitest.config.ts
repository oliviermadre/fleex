import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // `*.bun.test.ts` introspects the real CLI tree and needs the Bun runtime
    // (see vitest.bun.config.ts); keep it out of the Node workspace run.
    exclude: ['**/node_modules/**', '**/*.bun.test.ts'],
    testTimeout: 10000,
  },
});
