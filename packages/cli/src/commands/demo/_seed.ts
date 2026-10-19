import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { expandSqlitePath, isPerInstanceSqlitePath } from '../../core/sqlite-path.ts';

/** Where the seed lives, relative to the repo root. */
export const DEMO_DIR = 'demo';
/** What `demo reset` leaves in the instance run dir for `fleex shoot` (keys → ids). */
export const SEED_STATE_FILE = 'demo-seed.json';

export interface SeedState {
  seededAt: string;
  scenario: string | null;
  ticketsByKey: Record<string, { id: string; displayId: number }>;
  boardsByKey: Record<string, string>;
}

type SeedDoc = Record<string, unknown[]>;

/**
 * Refuse anything that is not the demo workspace: `demo reset` deletes a
 * database file, it must never get near `default`, `sqlite` or `qa`.
 * Returns the resolved SQLite file to recreate.
 */
export function assertDemoTarget(opts: {
  workspace: string | null;
  instanceSlug: string;
  env: NodeJS.ProcessEnv;
  homedir: string;
}): string {
  const hint = 'Run it as: fleex demo reset --workspace demo (see docs/releases.md to add the workspace).';
  if (opts.workspace !== 'demo') {
    throw new Error(`demo reset only runs on the "demo" workspace (current: ${opts.workspace ?? 'none'}). ${hint}`);
  }
  if (opts.env.FLEEX_DEMO_MODE !== '1') {
    throw new Error(`FLEEX_DEMO_MODE=1 is not set for this workspace. ${hint}`);
  }
  if ((opts.env.FLEEX_STORAGE_DRIVER ?? 'sqlite') !== 'sqlite') {
    throw new Error('the demo workspace must use FLEEX_STORAGE_DRIVER=sqlite.');
  }
  const raw = opts.env.FLEEX_SQLITE_PATH;
  if (!isPerInstanceSqlitePath(raw)) {
    throw new Error('the demo workspace needs a per-instance FLEEX_SQLITE_PATH (…/{instance}.db), so a reset only ever deletes its own file.');
  }
  return expandSqlitePath(raw!, opts.instanceSlug, opts.homedir);
}

function readYaml(file: string): SeedDoc {
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message.split('\n')[0]}`);
  }
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${file}: expected a mapping at the top level`);
  for (const [k, v] of Object.entries(doc)) {
    if (!Array.isArray(v)) throw new Error(`${file}: "${k}" must be a list`);
  }
  return doc as SeedDoc;
}

/** Concatenate the lists of every document, key by key, in order. */
export function mergeSeedDocs(docs: SeedDoc[]): SeedDoc {
  const out: SeedDoc = {};
  for (const doc of docs) {
    for (const [k, v] of Object.entries(doc)) out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}

/**
 * `demo/seed/*.yaml` (alphabetical) + `demo/scenarios/<scenario>.yaml`, with
 * every `deliverables[].file` inlined as `content` (path relative to `demo/`).
 */
export function loadSeed(repoDir: string, scenario?: string): SeedDoc {
  const demoDir = path.join(repoDir, DEMO_DIR);
  const seedDir = path.join(demoDir, 'seed');
  if (!fs.existsSync(seedDir)) throw new Error(`no seed found: ${seedDir} does not exist`);
  const files = fs.readdirSync(seedDir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(seedDir, f));
  if (scenario) {
    const s = path.join(demoDir, 'scenarios', `${scenario}.yaml`);
    if (!fs.existsSync(s)) {
      const known = fs.existsSync(path.dirname(s))
        ? fs.readdirSync(path.dirname(s)).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
        : [];
      throw new Error(`unknown scenario "${scenario}" (${s} not found). Known: ${known.join(', ') || 'none'}`);
    }
    files.push(s);
  }
  const merged = mergeSeedDocs(files.map(readYaml));
  for (const t of (merged.tickets ?? []) as Array<Record<string, unknown>>) {
    for (const d of (t.deliverables ?? []) as Array<Record<string, unknown>>) {
      if (typeof d.file !== 'string') continue;
      const p = path.resolve(demoDir, d.file);
      if (!p.startsWith(demoDir + path.sep)) throw new Error(`ticket ${t.key}: deliverable file "${d.file}" is outside demo/`);
      if (!fs.existsSync(p)) throw new Error(`ticket ${t.key}: deliverable file not found: ${p}`);
      d.content = fs.readFileSync(p, 'utf8');
      delete d.file;
    }
  }
  return merged;
}
