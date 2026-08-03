/**
 * Playwright contrast sweep for one theme (ticket #395).
 *
 * Walks every visible text node on each app screen, computes the effective
 * background by alpha compositing, and reports WCAG contrast violations
 * (< 4.5:1 normal text, < 3:1 large text). The theme is forced by
 * intercepting GET /api/config — PUT is blocked, so nothing is written to
 * the target database.
 *
 * Usage (standalone):
 *   AUDIT_BASE=http://localhost:PORT node scripts/theme-audit/audit.mjs <themeId> [outDir]
 * Preferred entry point: `bun run audit:theme` (scripts/theme-audit/run.mjs).
 */
import fs from 'node:fs';

import { loadPlaywright } from './playwright-dep.mjs';

export const ROUTES = [
  ['dashboard', '/dashboard'],
  ['tickets-board', '/tickets'],
  ['sessions', '/sessions'],
  ['agents', '/agents'],
  ['execution-log', '/execution-log'],
  ['documents', '/documents'],
  ['analytics', '/analytics'],
  ['settings', '/settings'],
  ['assistant', '/assistant'],
  ['repositories', '/repositories'],
  ['claude-config', '/claude-config'],
  ['cluster', '/cluster'],
  ['scratchpads', '/scratchpads'],
];

// ---- in-page contrast audit (serialized into the browser) -------------------
const auditFn = () => {
  function parseColor(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function composite(top, bottom) {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [
      (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a,
      (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a,
      (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a,
      a,
    ];
  }
  function effBg(el) {
    const stack = [];
    let node = el;
    while (node && node instanceof Element) {
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      if (c && c[3] > 0) {
        stack.push(c);
        if (c[3] >= 1) break;
      }
      node = node.parentElement;
    }
    let bg = [255, 255, 255, 1];
    const rootBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if (rootBg && rootBg[3] > 0) bg = [rootBg[0], rootBg[1], rootBg[2], 1];
    for (let i = stack.length - 1; i >= 0; i--) bg = composite(stack[i], bg);
    return bg;
  }
  function lum([r, g, b]) {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(fg, bg) {
    const l1 = lum(fg),
      l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const results = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = (t.textContent || '').trim();
    if (!text || text.length < 2) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.15) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth)
      continue;
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effBg(el);
    const fgC = fg[3] < 1 ? composite(fg, bg) : fg;
    const r = ratio(fgC, bg);
    const fontSize = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    if (r < (large ? 3 : 4.5)) {
      results.push({
        text: text.slice(0, 45),
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 140) : '',
        color: cs.color,
        bg: `rgb(${Math.round(bg[0])},${Math.round(bg[1])},${Math.round(bg[2])})`,
        ratio: Math.round(r * 100) / 100,
        fontSize,
        weight,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
      });
    }
  }
  return results;
};
// -----------------------------------------------------------------------------

/**
 * Sweep every route under `base` with theme `theme` forced, writing
 * screenshots + findings.json + aggregated.json into `out`.
 * Returns { total, pairs } where pairs is the deduped aggregated list.
 */
export async function sweep({ base, theme, out }) {
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

  // Force theme via /api/config interception — zero writes to the target DB.
  await context.route('**/api/config', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    const json = await resp.json();
    json.activeThemeId = theme;
    await route.fulfill({ response: resp, json });
  });
  await context.route('**/api/config', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 200, json: {} })
      : route.fallback(),
  );

  const page = await context.newPage();
  const all = {};

  async function auditRoute(name, path) {
    try {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${out}/${name}.png` });
      const findings = await page.evaluate(auditFn);
      all[name] = { path, url: page.url(), findings };
      console.log(`  ${name.padEnd(18)} ${String(findings.length).padStart(3)} violations`);
    } catch (e) {
      all[name] = { path, error: String(e).slice(0, 200) };
      console.log(`  ${name.padEnd(18)} ERROR ${String(e).slice(0, 120)}`);
    }
  }

  for (const [name, path] of ROUTES) await auditRoute(name, path);

  // Ticket detail view — grab a real ticket id from the API (prefer tagged tickets).
  try {
    const tickets = await (await fetch(`${base}/api/tickets`)).json();
    const withTags = tickets.find((t) => (t.tags || []).length > 0) || tickets[0];
    if (withTags) {
      await page.goto(`${base}/tickets`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const boardUrl = new URL(page.url());
      const slugMatch = boardUrl.pathname.match(/\/tickets\/board\/([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : 'personal';
      await auditRoute('ticket-detail', `/tickets/board/${slug}/ticket/${withTags.id}`);
    }
  } catch (e) {
    console.log('  ticket-detail skipped:', String(e).slice(0, 120));
  }

  fs.writeFileSync(`${out}/findings.json`, JSON.stringify(all, null, 2));

  // Aggregate: dedupe by color-pair signature, keep the worst ratio per pair.
  const agg = new Map();
  for (const [screen, data] of Object.entries(all)) {
    for (const f of data.findings || []) {
      const key = `${f.color}|${f.bg}`;
      if (!agg.has(key)) agg.set(key, { ...f, screens: new Set(), count: 0 });
      const a = agg.get(key);
      a.count++;
      a.screens.add(screen);
      if (f.ratio < a.ratio) Object.assign(a, { ratio: f.ratio, text: f.text, cls: f.cls });
    }
  }
  const pairs = [...agg.values()]
    .sort((a, b) => a.ratio - b.ratio)
    .map((a) => ({ ...a, screens: [...a.screens].join(', ') }));
  fs.writeFileSync(`${out}/aggregated.json`, JSON.stringify(pairs, null, 2));

  const total = Object.values(all).reduce((s, d) => s + (d.findings?.length || 0), 0);
  console.log(`  → ${total} violations, ${pairs.length} unique color pairs (${out}/)`);
  await browser.close();
  return { total, pairs };
}

// CLI compatibility: node scripts/theme-audit/audit.mjs <themeId> [outDir]
if (import.meta.url === `file://${process.argv[1]}`) {
  const theme = process.argv[2] || 'light';
  const base = process.env.AUDIT_BASE;
  if (!base) {
    console.error('AUDIT_BASE is required, e.g. AUDIT_BASE=http://localhost:3000');
    process.exit(2);
  }
  await sweep({
    base,
    theme,
    out: process.argv[3] || process.env.AUDIT_OUT || `./theme-audit-out/${theme}`,
  });
}
