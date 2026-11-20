#!/usr/bin/env node
/**
 * Pictures of the Factory floor, to check that a change to the renderer shows nothing it should not.
 *
 *   node scripts/factory-shots/run.mjs shoot <dir>             paint the made-up floor (src/factory/shots) into <dir>/*.png
 *   node scripts/factory-shots/run.mjs compare <a> <b> [diff]  compare two such folders pixel by pixel; differences in red in [diff]
 *   node scripts/factory-shots/run.mjs looks <dir>             each skin on a dark and a light theme, as WebP, for a mock-up
 *   node scripts/factory-shots/run.mjs playground <file.js>    the made-up floor, live (src/factory/shots/playground.ts), as one script a mock-up embeds
 *
 * Run from packages/web. The usual check: shoot on main into one folder, shoot on the branch into another, compare.
 * Needs Playwright's Chromium (pre-installed in cloud sessions; else `npx playwright install chromium`).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../..');
const require = createRequire(path.join(web, 'package.json'));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const [cmd, ...args] = process.argv.slice(2);

async function shoot(dir, which = 'checks') {
  const { createServer } = await import(require.resolve('vite'));
  const server = await createServer({ root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error', server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(new URL('scripts/factory-shots/index.html', url).href);
    await page.waitForFunction(() => window.shotsReady === true, null, { timeout: 60000 });
    const webp = which === 'looks', shots = await page.evaluate(([w, t]) => window.shoot(w, t), [which, webp ? 'image/webp' : 'image/png']);
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(shots)) writeFileSync(path.join(dir, `${name}.${webp ? 'webp' : 'png'}`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`${Object.keys(shots).length} pictures in ${dir}`);
  } finally { await browser.close(); await server.close(); }
}

async function compare(a, b, diffDir) {
  const names = readdirSync(a).filter((f) => f.endsWith('.png')).sort(), theirs = new Set(readdirSync(b));
  const browser = await chromium.launch();
  let bad = 0;
  try {
    const page = await browser.newPage();
    for (const name of names) {
      if (!theirs.has(name)) { console.log(`${name}: missing in ${b}`); bad++; continue; }
      const url = (d) => `data:image/png;base64,${readFileSync(path.join(d, name)).toString('base64')}`;
      const r = await page.evaluate(async ([ua, ub]) => {
        const load = (u) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = u; });
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
        const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
        const da = px(ia), db = px(ib), out = new ImageData(da.width, da.height);
        let n = 0, max = 0;
        for (let k = 0; k < da.data.length; k += 4) {
          const d = Math.max(Math.abs(da.data[k] - db.data[k]), Math.abs(da.data[k + 1] - db.data[k + 1]), Math.abs(da.data[k + 2] - db.data[k + 2]), Math.abs(da.data[k + 3] - db.data[k + 3]));
          const g = (da.data[k] + da.data[k + 1] + da.data[k + 2]) / 12;
          if (d) { n++; max = Math.max(max, d); out.data.set([255, 0, 0, 255], k); } else out.data.set([g, g, g, 255], k);
        }
        const c = document.createElement('canvas'); c.width = da.width; c.height = da.height; c.getContext('2d').putImageData(out, 0, 0);
        return { n, max, total: da.width * da.height, diff: n ? c.toDataURL('image/png') : null };
      }, [url(a), url(b)]);
      if (r.size) { console.log(`${name}: sizes differ`); bad++; continue; }
      console.log(`${name}: ${r.n ? `${r.n} pixels differ (${((r.n / r.total) * 100).toFixed(3)} %, by up to ${r.max})` : 'identical'}`);
      if (r.n) { bad++; if (diffDir) { mkdirSync(diffDir, { recursive: true }); writeFileSync(path.join(diffDir, name), Buffer.from(r.diff.split(',')[1], 'base64')); } }
    }
  } finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
}

async function playground(file) {
  const { build } = await import(require.resolve('vite'));
  const outDir = path.dirname(file);
  await build({
    configFile: false, root: web, logLevel: 'warn', publicDir: false,
    resolve: { alias: { '@fleex/shared': path.resolve(web, '../shared/src/index.ts') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir, emptyOutDir: false, minify: true, lib: { entry: path.join(web, 'src/factory/shots/playground.ts'), formats: ['iife'], name: 'FactoryPlayground', fileName: () => path.basename(file) } },
  });
  console.log(`playground in ${file}`);
}

if (cmd === 'playground' && args[0]) await playground(path.resolve(args[0]));
else if (cmd === 'shoot' && args[0]) await shoot(path.resolve(args[0]));
else if (cmd === 'looks' && args[0]) await shoot(path.resolve(args[0]), 'looks');
else if (cmd === 'compare' && args[0] && args[1]) await compare(path.resolve(args[0]), path.resolve(args[1]), args[2] && path.resolve(args[2]));
else { console.error('usage: run.mjs shoot <dir> | compare <a> <b> [diff] | looks <dir> | playground <file.js>'); process.exitCode = 2; }
