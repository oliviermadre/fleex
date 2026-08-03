import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@fleex/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
