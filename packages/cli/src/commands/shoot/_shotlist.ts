import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SeedState } from '../demo/_seed.ts';

export type ShotAction =
  | { hover: string }
  | { click: string }
  | { type: { selector: string; text: string } }
  | { press: string }
  | { wait: number };

export interface Shot {
  id: string;
  goto: string;
  waitFor?: string;
  actions: ShotAction[];
  /** CSS selector, `fullPage`, or undefined = the viewport. */
  clip?: string;
  padding: number;
}

export interface ShotList {
  feature: string;
  scenario?: string;
  out: string;
  viewport: { width: number; height: number; scale: number };
  themes: string[];
  format: 'webp' | 'png';
  clock?: string;
  shots: Shot[];
}

const ACTION_KEYS = ['hover', 'click', 'type', 'press', 'wait'] as const;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse and validate a shot list (docs/releases.md). Collects every problem so
 * the agent fixes the file in one pass. `out` is resolved against `repoDir`.
 */
export function parseShotList(text: string, repoDir: string): ShotList {
  const doc = parseYaml(text) as unknown;
  if (!isObj(doc)) throw new Error('shot list: expected a YAML mapping');
  const errors: string[] = [];

  const feature = typeof doc.feature === 'string' ? doc.feature : '';
  if (!SLUG_RE.test(feature)) errors.push('"feature" is required (lowercase-dashes, e.g. timeline-annotations)');

  const vp = isObj(doc.viewport) ? doc.viewport : {};
  const viewport = {
    width: Number(vp.width ?? 1440),
    height: Number(vp.height ?? 900),
    scale: Number(vp.scale ?? 2),
  };
  if (![viewport.width, viewport.height, viewport.scale].every((n) => Number.isFinite(n) && n > 0)) {
    errors.push('"viewport" needs positive width, height and scale');
  }

  const themes = doc.themes === undefined ? ['dark', 'light'] : doc.themes;
  if (!Array.isArray(themes) || themes.length === 0 || themes.some((t) => typeof t !== 'string' || !SLUG_RE.test(t))) {
    errors.push('"themes" must be a non-empty list of theme ids (e.g. [dark, light])');
  }

  const format = doc.format ?? 'webp';
  if (format !== 'webp' && format !== 'png') errors.push('"format" must be webp or png');

  const clock = doc.clock === undefined ? undefined : doc.clock instanceof Date ? doc.clock.toISOString() : String(doc.clock);
  if (clock !== undefined && Number.isNaN(new Date(clock).getTime())) errors.push(`"clock" is not a date: ${clock}`);

  const shots: Shot[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(doc.shots) || doc.shots.length === 0) errors.push('"shots" must be a non-empty list');
  for (const [i, raw] of (Array.isArray(doc.shots) ? doc.shots : []).entries()) {
    const where = `shots[${i}]`;
    if (!isObj(raw)) { errors.push(`${where} must be a mapping`); continue; }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!SLUG_RE.test(id)) errors.push(`${where}: "id" is required (lowercase-dashes)`);
    else if (ids.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    ids.add(id);
    const goto = typeof raw.goto === 'string' ? raw.goto : '';
    if (!goto.startsWith('/')) errors.push(`${where} (${id}): "goto" must be a path starting with / (e.g. /tickets)`);
    const actions: ShotAction[] = [];
    for (const [j, a] of (Array.isArray(raw.actions) ? raw.actions : raw.actions === undefined ? [] : [null]).entries()) {
      const keys = isObj(a) ? Object.keys(a) : [];
      const key = keys[0] as (typeof ACTION_KEYS)[number] | undefined;
      if (keys.length !== 1 || !key || !ACTION_KEYS.includes(key)) {
        errors.push(`${where} (${id}) actions[${j}]: one of ${ACTION_KEYS.join(', ')}`);
        continue;
      }
      const v = (a as Record<string, unknown>)[key];
      if (key === 'wait' ? typeof v !== 'number' : key === 'type' ? !(isObj(v) && typeof v.selector === 'string' && typeof v.text === 'string') : typeof v !== 'string') {
        errors.push(`${where} (${id}) actions[${j}]: bad value for "${key}"`);
        continue;
      }
      actions.push({ [key]: v } as ShotAction);
    }
    const padding = raw.padding === undefined ? 16 : Number(raw.padding);
    if (!Number.isFinite(padding) || padding < 0) errors.push(`${where} (${id}): "padding" must be ≥ 0`);
    shots.push({
      id, goto, actions, padding,
      ...(typeof raw.waitFor === 'string' ? { waitFor: raw.waitFor } : {}),
      ...(typeof raw.clip === 'string' ? { clip: raw.clip } : {}),
    });
  }
  if (errors.length) throw new Error(`invalid shot list:\n  - ${errors.join('\n  - ')}`);

  const out = typeof doc.out === 'string' && doc.out ? doc.out : `releases/unreleased/assets/${feature}`;
  const outAbs = path.resolve(repoDir, out);
  if (!outAbs.startsWith(path.resolve(repoDir) + path.sep)) throw new Error(`invalid shot list: "out" must stay inside the repo (${out})`);

  return {
    feature,
    ...(typeof doc.scenario === 'string' ? { scenario: doc.scenario } : {}),
    out: outAbs,
    viewport,
    themes: themes as string[],
    format: format as 'webp' | 'png',
    ...(clock !== undefined ? { clock } : {}),
    shots,
  };
}

/**
 * `{{ticket:nova-12}}` → ticket UUID, `{{ticketNumber:nova-12}}` → display id,
 * `{{board:nova}}` → board UUID — from the state `fleex demo reset` left behind.
 */
export function resolvePlaceholders(goto: string, state: SeedState | null): string {
  return goto.replace(/\{\{\s*(ticket|ticketNumber|board)\s*:\s*([^}\s]+)\s*\}\}/g, (_m, kind: string, key: string) => {
    if (!state) throw new Error(`"${goto}" uses {{${kind}:${key}}} but no demo seed was found: run fleex demo reset --workspace demo first`);
    if (kind === 'board') {
      const id = state.boardsByKey[key];
      if (!id) throw new Error(`unknown board key "${key}" in "${goto}" (known: ${Object.keys(state.boardsByKey).join(', ')})`);
      return id;
    }
    const t = state.ticketsByKey[key];
    if (!t) throw new Error(`unknown ticket key "${key}" in "${goto}" (known: ${Object.keys(state.ticketsByKey).join(', ')})`);
    return kind === 'ticket' ? t.id : String(t.displayId);
  });
}

/** The web URL with the demo flags: no banner, no toasts, no animation, forced theme. */
export function buildShotUrl(webBase: string, gotoPath: string, theme: string): string {
  const u = new URL(gotoPath, webBase);
  u.searchParams.set('demo', '1');
  u.searchParams.set('theme', theme);
  return u.toString();
}

export function outputFile(list: ShotList, shotId: string, theme: string): string {
  return path.join(list.out, `${shotId}-${theme}.${list.format}`);
}
