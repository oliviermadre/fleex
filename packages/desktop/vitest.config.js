// Vitest config for the desktop bundle helpers (env parser, port finder,
// health check). Kept as .js because the rest of the desktop package is .js.
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
  },
});
