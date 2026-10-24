import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';
import { die, info, ok, warn, present } from '../../core/colors.ts';
import { resolveInstance } from '../../core/instance.ts';
import { requirePorts } from '../../core/ports.ts';
import { SEED_STATE_FILE, type SeedState } from '../demo/_seed.ts';
import { buildShotUrl, outputFile, parseShotList, resolvePlaceholders, type Shot, type ShotList } from './_shotlist.ts';

const INSTALL_HINT = 'bunx playwright install chromium';
/** Above this, a screenshot weighs on the repo and on Slack: re-encode harder. */
const MAX_BYTES = 300 * 1024;
const WAIT_TIMEOUT_MS = 15_000;

interface ShootOptions { only?: string }

interface ShotResult { shot: string; theme: string; file: string; bytes: number }

/** One shot failed: named so the agent knows exactly what to fix. */
class ShotError extends Error {}

// Minimal structural types: playwright is loaded lazily so the CLI never
// depends on it for any other command.
type Page = any;
type Browser = any;

async function loadChromium(): Promise<{ launch: (o: object) => Promise<Browser> }> {
  let mod: any;
  try {
    mod = await import('playwright');
  } catch {
    throw new ShotError(`Playwright is not installed in this checkout. Run: bun install && ${INSTALL_HINT}`);
  }
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!fs.existsSync(chromium.executablePath())) {
    throw new ShotError(`Chromium is not installed for Playwright. Run: ${INSTALL_HINT}`);
  }
  return chromium;
}

/**
 * Re-encode inside the page: Chromium ships a WebP encoder, so no native
 * dependency (sharp, cwebp) is needed. Lowers the quality until it fits.
 */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  for (const quality of [0.9, 0.82, 0.74, 0.66]) {
    const b64: string = await page.evaluate(async ({ data, q }: { data: string; q: number }) => {
      // Runs in the page: browser globals, not Node's (the CLI has no DOM lib).
      const w = globalThis as any;
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      const bmp = await w.createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new w.OffscreenCanvas(bmp.width, bmp.height);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, { data: png.toString('base64'), q: quality });
    const out = Buffer.from(b64, 'base64');
    if (out.length <= MAX_BYTES || quality === 0.66) return out;
  }
  throw new Error('unreachable');
}

async function runShot(page: Page, list: ShotList, shot: Shot, url: string): Promise<Buffer> {
  const where = `shot "${shot.id}" (${url})`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (e) {
    throw new ShotError(`${where}: page did not load: ${(e as Error).message.split('\n')[0]}`);
  }
  const waitFor = async (selector: string, step: string) => {
    try {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: WAIT_TIMEOUT_MS });
    } catch {
      throw new ShotError(`${where}: ${step} selector not found after ${WAIT_TIMEOUT_MS / 1000}s: ${selector}`);
    }
  };
  if (shot.waitFor) await waitFor(shot.waitFor, 'waitFor');

  for (const a of shot.actions) {
    if ('hover' in a) { await waitFor(a.hover, 'hover'); await page.locator(a.hover).first().hover(); }
    else if ('click' in a) { await waitFor(a.click, 'click'); await page.locator(a.click).first().click(); }
    else if ('type' in a) { await waitFor(a.type.selector, 'type'); await page.locator(a.type.selector).first().fill(a.type.text); }
    else if ('press' in a) await page.keyboard.press(a.press);
    else if ('wait' in a) await page.waitForTimeout(a.wait);
  }
  await page.evaluate(() => (globalThis as any).document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});

  let png: Buffer;
  if (shot.clip === 'fullPage') {
    png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  } else if (shot.clip) {
    await waitFor(shot.clip, 'clip');
    const box = await page.locator(shot.clip).first().boundingBox();
    if (!box || box.width < 2 || box.height < 2) throw new ShotError(`${where}: clip selector has an empty box: ${shot.clip}`);
    const vp = page.viewportSize() ?? { width: list.viewport.width, height: list.viewport.height };
    const x = Math.max(0, box.x - shot.padding);
    const y = Math.max(0, box.y - shot.padding);
    const clip = {
      x, y,
      width: Math.min(vp.width - x, box.width + shot.padding * 2),
      height: Math.min(vp.height - y, box.height + shot.padding * 2),
    };
    png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  } else {
    png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  }
  if (png.length < 1000) throw new ShotError(`${where}: the screenshot is empty (${png.length} bytes)`);
  return list.format === 'webp' ? toWebp(page, png) : png;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'shoot',
  description: 'Take the screenshots of a shot list (headless Chromium → WebP @2x, dark + light)',
  setup(cmd) {
    cmd.argument('<shotlist>', 'Shot list YAML (e.g. demo/shots/timeline-annotations.yaml)');
    cmd.option('--only <ids>', 'Comma-separated shot ids to (re)take');
  },
  extraHelp: `\n${chalk.bold.yellow('Examples:')}
  ${chalk.dim('$')} fleex demo reset --scenario timeline-annotations --workspace demo
  ${chalk.dim('$')} fleex shoot demo/shots/timeline-annotations.yaml --workspace demo
  ${chalk.dim('$')} fleex shoot demo/shots/timeline-annotations.yaml --only hero --workspace demo

${chalk.bold.yellow('Notes:')}
  Shoots the web UI of the current instance with ?demo=1 (no banner, no toasts, no animation)
  and ?theme=<theme>. Writes <out>/<shot>-<theme>.webp (default out: releases/unreleased/assets/<feature>).
  Placeholders in goto: {{ticket:<key>}}, {{ticketNumber:<key>}}, {{board:<key>}} (keys from demo/seed).
  Chromium missing: ${INSTALL_HINT}. Format: docs/releases.md.
`,
  action: async (shotlistPath: string, opts: ShootOptions) => {
    const ctx = resolveInstance();
    const file = path.resolve(shotlistPath);
    if (!fs.existsSync(file)) return die(`Shot list not found: ${file}`);

    let list: ShotList;
    let state: SeedState | null = null;
    try {
      list = parseShotList(fs.readFileSync(file, 'utf8'), ctx.repoDir);
      const statePath = path.join(ctx.instanceRun, SEED_STATE_FILE);
      if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as SeedState;
      if (list.scenario && state?.scenario !== list.scenario) {
        throw new Error(`this shot list needs the "${list.scenario}" scenario, but the demo was seeded with ${state?.scenario ? `"${state.scenario}"` : 'no scenario'}. Run: fleex demo reset --scenario ${list.scenario} --workspace demo`);
      }
    } catch (e) {
      return die((e as Error).message);
    }
    if (ctx.workspace !== 'demo') warn(`Shooting the "${ctx.workspace}" workspace, not "demo": the data may not be presentable.`);

    const only = opts.only ? new Set(opts.only.split(',').map((s) => s.trim())) : null;
    const shots = only ? list.shots.filter((s) => only.has(s.id)) : list.shots;
    if (only && shots.length !== only.size) {
      return die(`Unknown shot id in --only (${opts.only}). Known: ${list.shots.map((s) => s.id).join(', ')}`);
    }

    const ports = requirePorts(ctx);
    const webBase = `http://localhost:${ports.web}`;
    const clock = new Date(list.clock ?? Date.now());
    const results: ShotResult[] = [];
    let browser: Browser | null = null;
    let failure: string | null = null;
    try {
      const chromium = await loadChromium();
      browser = await chromium.launch({ headless: true });
      for (const theme of list.themes) {
        for (const shot of shots) {
          // A fresh context per shot: the web app keeps drafts, open drawers and panels in
          // localStorage, so a shared context would leak one shot's UI state into the next.
          const context = await browser.newContext({
            viewport: { width: list.viewport.width, height: list.viewport.height },
            deviceScaleFactor: list.viewport.scale,
            colorScheme: theme === 'light' ? 'light' : 'dark',
            reducedMotion: 'reduce',
            locale: 'fr-FR',
          });
          try {
            const page = await context.newPage();
            // Frozen clock: relative dates ("il y a 2 h") and the timeline are identical run after run.
            await page.clock.setFixedTime(clock);
            const url = buildShotUrl(webBase, resolvePlaceholders(shot.goto, state), theme);
            info(`${shot.id} · ${theme} · ${url}`);
            const img = await runShot(page, list, shot, url);
            const out = outputFile(list, shot.id, theme);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, img);
            results.push({ shot: shot.id, theme, file: path.relative(ctx.repoDir, out), bytes: img.length });
          } finally {
            await context.close();
          }
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      failure = e instanceof ShotError
        ? msg
        : /Executable doesn't exist|browserType\.launch/.test(msg)
          ? `Chromium could not start. Run: ${INSTALL_HINT}\n${msg.split('\n')[0]}`
          : `shoot failed: ${msg.split('\n')[0]}`;
    } finally {
      // Close before exiting: die() ends the process and would orphan Chromium.
      await browser?.close().catch(() => {});
    }
    if (failure) return die(failure);

    present(results, () => {
      for (const r of results) {
        const kb = Math.round(r.bytes / 1024);
        const size = r.bytes > MAX_BYTES ? chalk.yellow(`${kb} KB (> 300 KB)`) : `${kb} KB`;
        ok(`${r.file}  ${chalk.dim(size)}`);
      }
      info('Now look at every image (Read tool) before using it: cropped, empty or off-topic → fix the shot list and use --only.');
    });
  },
};

export default def;
