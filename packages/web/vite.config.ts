import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'node:path';

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
const serverUrl = process.env['VITE_PROXY_TARGET'] || 'http://localhost:3000';
const serverWs = serverUrl.replace(/^http/, 'ws');
// Side-panel companion (machine-wide singleton, also used by the mobile assistant)
const companionUrl = `http://localhost:${process.env['FLEEX_SIDEPANEL_PORT'] || '4399'}`;

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
    // Dev-only, no effect on the build. The lazy boundaries that keep these
    // trees out of the production entry chunk also keep them out of the dev
    // server's initial crawl, so their transforms would otherwise happen
    // on demand, after React has already mounted the shell — a second
    // request waterfall where there used to be one. Pre-transforming the two
    // platform shells collapses it back; the rest stays on demand, which is
    // what we want for panels a given session may never open.
    warmup: {
      clientFiles: ['./src/components/layout/DesktopShell.tsx', './src/mobile/MobileApp.tsx'],
    },
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
