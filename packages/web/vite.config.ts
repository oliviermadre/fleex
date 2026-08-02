import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const webPort = parseInt(process.env['VITE_DEV_PORT'] || '5173', 10);
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://127.0.0.1:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');
// Side-panel companion (machine-wide singleton, also used by the mobile assistant)
const companionUrl = `http://127.0.0.1:${process.env['FLEEX_SIDEPANEL_PORT'] || '4399'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    // .ts.net: Tailscale MagicDNS hostnames, so the dev server can be reached
    // from a phone via `tailscale serve` (see docs/mobile.md)
    allowedHosts: ['.nip.io', '.ts.net'],
    historyApiFallback: true,
    // No CSP here: HMR needs unsafe-eval + unsafe-inline, which would make one
    // worthless. The production CSP is applied by Fastify on the built app.
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
    // `changeOrigin` is deliberately absent from every entry below: it rewrites
    // the Host header while leaving Origin alone, which would break the
    // `Origin.host === Host` rule the backends use to authorise requests. The
    // targets are local servers that do not route by Host, so it buys nothing.
    proxy: {
      '/api': {
        target: serverUrl,
      },
      '/ws': {
        target: serverWs,
        ws: true,
      },
      '/health': {
        target: serverUrl,
      },
      '/internal': {
        target: serverUrl,
      },
      '/auth': {
        target: serverUrl,
      },
      // Assistant (mobile tab + desktop panel) → companion host (same protocol
      // as the Chrome side panel). Path prefix is stripped:
      // /companion/chat → :4399/chat. NOT /assistant — that's the SPA route.
      '/companion': {
        target: companionUrl,
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
