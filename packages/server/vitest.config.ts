import path from 'node:path';

import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // `*.bun.test.ts` tests import `bun:sqlite` and only load under the Bun
    // runtime. They run via the dedicated `test:bun` script (vitest.bun.config.ts);
    // exclude them here so the default Node-based run doesn't fail to load them.
    exclude: [...configDefaults.exclude, '**/*.bun.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@fleex/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
