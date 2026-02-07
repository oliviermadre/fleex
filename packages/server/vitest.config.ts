import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@asm/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
