import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = parseInt(process.env['VITE_DEV_PORT'] || '5173', 10);
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://localhost:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');
// Side-panel companion (machine-wide singleton, also used by the mobile assistant)
const companionUrl = `http://localhost:${process.env['FLEEX_SIDEPANEL_PORT'] || '4399'}`;

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
      // Assistant (mobile tab + desktop panel) → companion host (same protocol
      // as the Chrome side panel). Path prefix is stripped:
      // /companion/chat → :4399/chat. NOT /assistant — that's the SPA route.
      '/companion': {
        target: companionUrl,
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/companion/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@fleex/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
