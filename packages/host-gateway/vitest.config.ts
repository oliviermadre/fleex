import { defineConfig, configDefaults } from 'vitest/config';

// Only the Node-compatible modules are tested here (main.ts / pty.ts need Bun).
export default defineConfig({
  test: {
    name: '@fleex/host-gateway',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    testTimeout: 15000,
  },
});
