import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const webPort = parseInt(process.env['VITE_DEV_PORT'] || '5173', 10);
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://localhost:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    // .ts.net: Tailscale MagicDNS hostnames, so the dev server can be reached
    // from a phone via `tailscale serve` (see docs/mobile.md)
    allowedHosts: ['.nip.io', '.ts.net'],
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
