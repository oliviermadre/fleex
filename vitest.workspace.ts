import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/server/vitest.config.ts',
  'packages/web/vitest.config.ts',
  'packages/cli/vitest.config.ts',
  'packages/mcp/vitest.config.ts',
  'packages/sidepanel-host/vitest.config.ts',
  'extension/vitest.config.ts',
]);
