import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'scripts',
    globals: true,
    environment: 'node',
    include: ['**/*.test.mjs'],
  },
});
