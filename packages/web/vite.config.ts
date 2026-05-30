import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const webPort = parseInt(process.env['VITE_DEV_PORT'] || '5173', 10);
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://localhost:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');
// Extra Host headers to accept (comma-separated), e.g. the docker service name
// in the test stack so the Playwright container can reach http://web:5173.
const extraHosts = (process.env['VITE_ALLOWED_HOSTS'] || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    allowedHosts: ['.nip.io', ...extraHosts],
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: serverUrl,
        changeOrigin: true,
      },
      '/ws': {
        target: serverWs,
        ws: true,
      },
      '/health': {
        target: serverUrl,
        changeOrigin: true,
      },
      '/internal': {
        target: serverUrl,
        changeOrigin: true,
      },
      '/auth': {
        target: serverUrl,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@fleex/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
