// Navigate to a Fleex route and save a PNG into /screenshots.
//
// Usage (inside the screenshot container):
//   node screenshot.mjs [url-or-path] [output.png] [--full]
//
// `url-or-path` may be a full URL or a path (e.g. "/board"), in which case it
// is resolved against FLEEX_URL (default http://web:5173).
import { chromium } from 'playwright';

const base = process.env.FLEEX_URL || 'http://web:5173';
const arg = process.argv[2] || '/';
const url = /^https?:\/\//.test(arg) ? arg : base.replace(/\/$/, '') + (arg.startsWith('/') ? arg : `/${arg}`);
const out = process.argv[3] || `screenshot-${Date.now()}.png`;
const fullPage = process.argv.includes('--full');
const waitMs = Number(process.env.WAIT_MS || 1500);
const width = Number(process.env.VIEWPORT_WIDTH || 1440);
const height = Number(process.env.VIEWPORT_HEIGHT || 900);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  console.log(`→ navigating to ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch((e) => {
    console.error(`! navigation warning: ${e.message}`);
  });
  await page.waitForTimeout(waitMs);

  const path = `/screenshots/${out}`;
  await page.screenshot({ path, fullPage });
  console.log(`✓ saved ${path}`);
  if (errors.length) {
    console.error(`! ${errors.length} console/page error(s):`);
    for (const e of errors.slice(0, 10)) console.error(`    ${e}`);
  }
} finally {
  await browser.close();
}
