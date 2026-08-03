import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin } from 'vite';


/** `/…/node_modules/@scope/pkg/dist/x.js` → `@scope/pkg`. Non-npm ids → null. */
function packageNameFromModuleId(id: string): string | null {
  const marker = 'node_modules/';
  const at = id.lastIndexOf(marker);
  if (at === -1) return null;
  const parts = id.slice(at + marker.length).split('/');
  if (parts[0]?.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] || null;
}

/**
 * Emits `dist/.vite/chunk-modules.json` — `{ [chunkFileName]: npmPackageName[] }`.
 *
 * `scripts/bundle-budget.mjs` uses it to assert that heavy packages never creep
 * back into the initial static payload. Deriving that from real module ids makes
 * the check exact, where matching on generated chunk names would not be.
 */
function bundleReportPlugin(): Plugin {
  return {
    name: 'fleex:bundle-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const report: Record<string, string[]> = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const packages = new Set<string>();
        for (const id of chunk.moduleIds) {
          const pkg = packageNameFromModuleId(id);
          if (pkg) packages.add(pkg);
        }
        report[fileName] = [...packages].sort();
      }
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: JSON.stringify(report, null, 2),
      });
    },
  };
}

const webPort = parseInt(process.env['VITE_DEV_PORT'] || '5173', 10);
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://127.0.0.1:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');
// Side-panel companion (machine-wide singleton, also used by the mobile assistant)
const companionUrl = `http://127.0.0.1:${process.env['FLEEX_SIDEPANEL_PORT'] || '4399'}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    bundleReportPlugin(),
    process.env['ANALYZE']
      ? visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'treemap' })
      : null,
  ],
  build: {
    // Consumed by scripts/bundle-budget.mjs to walk the initial static payload.
    manifest: true,
    rollupOptions: {
      output: {
        // Object form only, and deliberately minimal. A catch-all
        // `manualChunks(id)` over node_modules hoists mermaid/cytoscape/katex
        // (889 kB gzip, correctly dynamic today) into a statically imported
        // chunk and makes the initial payload worse. Everything else is split
        // by the lazy boundaries in the app, not here.
        //
        // recharts and @xyflow/react are intentionally NOT separated: they
        // share d3-* modules and Rollup emits circular chunks. Their lazy
        // boundaries already keep them out of the initial payload.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
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
