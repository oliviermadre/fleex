import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/server/vitest.config.ts',
      'packages/web/vitest.config.ts',
      'packages/cli/vitest.config.ts',
      'packages/mcp/vitest.config.ts',
      'packages/sidepanel-host/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      // Ratchet, not ambition: each floor sits ~2 points under the measured
      // value so a real regression trips it while normal churn does not.
      // Raising coverage is a separate concern from installing the ratchet.
      //
      // No floor for `shared`: it has no vitest project of its own, its
      // coverage is attributed to consumers through the resolve aliases.
      // No `branches` floor: V8 reports 0 branches for uncovered files, which
      // inflates the aggregate well above what `lines` shows.
      thresholds: {
        'packages/server/src/**': { lines: 18, functions: 65 },
        'packages/web/src/**': { lines: 14, functions: 25 },
        'packages/cli/src/**': { lines: 14, functions: 55 },
        'packages/mcp/src/**': { lines: 78, functions: 90 },
        'packages/sidepanel-host/src/**': { lines: 37, functions: 78 },
      },
    },
  },
});
