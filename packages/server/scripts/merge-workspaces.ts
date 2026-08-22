#!/usr/bin/env bun
/**
 * One-shot merge of one Fleex workspace's database into another (Supabase → Supabase).
 *
 * A Fleex "workspace" has no existence in the database: it is an env block in
 * `~/.fleex/workspaces.json` pointing at a driver plus credentials. Merging two
 * workspaces therefore means merging two whole PostgreSQL databases, then copying
 * the `files` Storage bucket.
 *
 * Contract: READ-ONLY on the source (enforced by Postgres itself), INSERT-ONLY on
 * the target, dry-run by default. Every insert is `ON CONFLICT DO NOTHING`, so a
 * failed run is resumed by re-running the same command.
 *
 * Collision policy: the TARGET wins on every unique natural key
 * (agent_personas.name, skills.command_name, panels.name, workflow_templates.slug,
 * routines.slug). The source row is skipped and everything that referenced it by id
 * is remapped onto the target's equivalent.
 *
 * Usage:
 *   bun run packages/server/scripts/merge-workspaces.ts --from tada --into default
 *   bun run packages/server/scripts/merge-workspaces.ts --from tada --into default \
 *     --apply --backup ~/.fleex/backups/default-premerge.dump
 *
 * Flags:
 *   --from <ws>              source workspace name (never written to)
 *   --into <ws>              target workspace name
 *   --apply                  actually write; without it the script only audits
 *   --backup <file>          existing pg_dump of the target; required with --apply
 *   --report <file>          write the audit as JSON
 *   --kv-policy skip|suffix  colliding user_kv keys (default: suffix — lossless)
 *   --skip-tokens            do not import api_tokens
 *   --skip-event-log         do not import domain_event_log
 *   --skip-files             do not copy the Storage bucket
 *   --merge-config           union app_config deliverableTypes/repositories into the target
 *   --enable-routines        import routines enabled (default: imported disabled)
 *   --batch <n>              rows per INSERT statement (default 500)
 *   --allow-running          skip the "all instances stopped" guard (dangerous)
 */
import { readFileSync, existsSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d; };

const FROM = val('--from');
const INTO = val('--into');
const APPLY = has('--apply');
const BACKUP = val('--backup');
const REPORT = val('--report');
const KV_POLICY = (val('--kv-policy', 'suffix') ?? 'suffix') as 'skip' | 'suffix';
const SKIP_TOKENS = has('--skip-tokens');
const SKIP_EVENT_LOG = has('--skip-event-log');
const SKIP_FILES = has('--skip-files');
const MERGE_CONFIG = has('--merge-config');
const ENABLE_ROUTINES = has('--enable-routines');
const BATCH = Math.max(1, Number(val('--batch', '500')));
const ALLOW_RUNNING = has('--allow-running');

const SEEDED_USER_ID = '00000000-0000-0000-0000-000000000000';
const BUCKET = 'files';

/** Never copied. `sessions` is always LocalSessionStore (~/.fleex/sessions.json);
 *  `kv_store` does not exist on Supabase; `user_sessions` holds HTTP/OAuth sessions. */
const DENY_TABLES = new Set(['_migrations', 'sessions', 'kv_store', 'user_sessions']);

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
function log(msg = '') { console.log(msg); }

if (!FROM || !INTO) fail('Usage: --from <workspace> --into <workspace> [--apply --backup <file>]');
if (FROM === INTO) fail('--from and --into must differ.');
if (KV_POLICY !== 'skip' && KV_POLICY !== 'suffix') fail(`--kv-policy must be "skip" or "suffix" (got "${KV_POLICY}").`);

// ── Workspaces ────────────────────────────────────────────────────────────────
interface Workspace { name: string; is_default?: boolean; env?: Record<string, string>; basePath?: string }

function loadWorkspaces(): Workspace[] {
  const p = join(homedir(), '.fleex', 'workspaces.json');
  if (!existsSync(p)) fail(`${p} not found — this script only supports workspace-based installs.`);
  const raw = JSON.parse(readFileSync(p, 'utf-8')) as { workspaces?: Workspace[] };
  return raw.workspaces ?? [];
}

function resolveWs(name: string, all: Workspace[]): Required<Pick<Workspace, 'name' | 'env'>> & Workspace {
  const ws = all.find((w) => w.name.toLowerCase() === name.toLowerCase());
  if (!ws) fail(`Workspace "${name}" not found. Known: ${all.map((w) => w.name).join(', ') || '(none)'}`);
  const env = ws.env ?? {};
  const driver = env['FLEEX_STORAGE_DRIVER'];
  if (driver !== 'supabase') {
    fail(`Workspace "${ws.name}" uses FLEEX_STORAGE_DRIVER="${driver ?? '(unset)'}" — this script only merges supabase → supabase.`);
  }
  for (const k of ['FLEEX_SUPABASE_URL', 'FLEEX_SUPABASE_KEY', 'FLEEX_SUPABASE_DB_URL'] as const) {
    if (!env[k]) {
      fail(`Workspace "${ws.name}" is missing ${k}. ` +
        `Note the code reads the FLEEX_-prefixed names (the README example showing SUPABASE_URL / ` +
        `SUPABASE_SERVICE_ROLE_KEY is stale — see docs/MIGRATION_GUIDE.md §4).`);
    }
  }
  return { ...ws, env };
}

/** Host:port/db, used to prove the two connection strings are not the same database. */
function dbIdentity(url: string): string {
  try { const u = new URL(url); return `${u.hostname}:${u.port || '5432'}${u.pathname}`; } catch { return url; }
}
function dbPort(url: string): string {
  try { return new URL(url).port || '5432'; } catch { return '5432'; }
}

/** Live Fleex processes, from ~/.fleex/.run/<slug>/*.pid. */
function runningInstances(): string[] {
  const runDir = join(homedir(), '.fleex', '.run');
  if (!existsSync(runDir)) return [];
  const alive: string[] = [];
  for (const slug of readdirSync(runDir)) {
    let files: string[] = [];
    try { files = readdirSync(join(runDir, slug)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.pid')) continue;
      let pid = 0;
      try { pid = Number(readFileSync(join(runDir, slug, f), 'utf-8').trim()); } catch { continue; }
      if (!Number.isFinite(pid) || pid <= 0) continue;
      try { process.kill(pid, 0); alive.push(`${slug}/${f.replace(/\.pid$/, '')} (pid ${pid})`); } catch { /* dead */ }
    }
  }
  return alive;
}

// ── SQL helpers ───────────────────────────────────────────────────────────────
type Q = { query(text: string, params?: unknown[]): Promise<pg.QueryResult> };
type Row = Record<string, unknown>;

const JSON_TYPES = new Set(['json', 'jsonb']);
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
/** Composite-key cache key. JSON so no separator can ever be ambiguous:
 *  user_kv keys legitimately contain ':' and provider ids are opaque. */
const ck = (...parts: unknown[]) => JSON.stringify(parts.map(String));

async function baseTables(c: Q): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  // table_type filters out deliverables_search, which is a VIEW (migrations 029→031).
  return rows.map((r) => String(r['table_name'])).filter((t) => !DENY_TABLES.has(t));
}

/** table -> (column -> data_type) */
async function columnTypes(c: Q): Promise<Map<string, Map<string, string>>> {
  const { rows } = await c.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  const m = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const t = String(r['table_name']);
    if (!m.has(t)) m.set(t, new Map());
    m.get(t)!.set(String(r['column_name']), String(r['data_type']));
  }
  return m;
}

/** table -> primary-key columns, in order. Handles the composite PKs for free. */
async function primaryKeys(c: Q): Promise<Map<string, string[]>> {
  const { rows } = await c.query(`
    SELECT c.conrelid::regclass::text AS tbl,
           array_agg(a.attname::text ORDER BY k.ord) AS pk
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'p' AND c.connamespace = 'public'::regnamespace
     GROUP BY 1`);
  const m = new Map<string, string[]>();
  for (const r of rows) {
    m.set(String(r['tbl']).replace(/"/g, ''), (r['pk'] as string[]).map(String));
  }
  return m;
}

async function count(c: Q, table: string): Promise<number> {
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${q(table)}`);
  return Number(rows[0]?.['n'] ?? 0);
}

/** Paged full read. OFFSET paging is stable because the source is read-only. */
async function* readRows(c: Q, table: string, order: string[], page = 2000): AsyncGenerator<Row[]> {
  const ord = order.length ? `ORDER BY ${order.map(q).join(', ')}` : '';
  for (let offset = 0; ; ) {
    const { rows } = await c.query(`SELECT * FROM ${q(table)} ${ord} LIMIT ${page} OFFSET ${offset}`);
    if (rows.length === 0) return;
    yield rows as Row[];
    if (rows.length < page) return;
    offset += rows.length;
  }
}

/**
 * Batched INSERT ... ON CONFLICT DO NOTHING.
 *
 * The JSON handling is load-bearing: node-postgres serialises a JS array as a
 * Postgres ARRAY literal ({...}), not as JSON. Without an explicit JSON.stringify
 * plus a ::json/::jsonb cast, every JSON-array column (tickets.tags, tickets.links,
 * comments.mentions, panels.members, workflow_templates.steps/edges, routines.subject,
 * step_runs.output, app_config.data, …) would be mangled or rejected.
 */
async function insertRows(
  c: Q, table: string, rows: Row[], cols: string[],
  types: Map<string, string>, pk: string[],
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const ph: string[] = [];
      for (const col of cols) {
        const t = types.get(col) ?? '';
        let v = row[col] ?? null;
        if (v !== null && JSON_TYPES.has(t)) {
          v = JSON.stringify(v);
          ph.push(`$${params.length + 1}::${t}`);
        } else {
          ph.push(`$${params.length + 1}`);
        }
        params.push(v);
      }
      tuples.push(`(${ph.join(',')})`);
    }
    const conflict = pk.length
      ? `ON CONFLICT (${pk.map(q).join(', ')}) DO NOTHING`
      : 'ON CONFLICT DO NOTHING';
    const res = await c.query(
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')} ${conflict}`,
      params,
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

/** Natural-key collision analysis: which source rows to skip, and how to remap them. */
async function naturalKey(src: Q, dst: Q, table: string, keyCol: string) {
  const s = (await src.query(`SELECT id, ${q(keyCol)} AS k FROM ${q(table)}`)).rows;
  const d = (await dst.query(`SELECT id, ${q(keyCol)} AS k FROM ${q(table)}`)).rows;
  const byKey = new Map(d.map((r) => [String(r['k']), String(r['id'])]));
  const remap = new Map<string, string>();   // source id -> target id
  const skip = new Set<string>();            // source ids not to insert
  const collisions: string[] = [];
  for (const r of s) {
    const hit = byKey.get(String(r['k']));
    if (hit === undefined) continue;
    skip.add(String(r['id']));
    collisions.push(String(r['k']));
    if (hit !== String(r['id'])) remap.set(String(r['id']), hit);
  }
  return { remap, skip, collisions, srcCount: s.length };
}

function remapCol(row: Row, col: string, map: Map<string, string>): void {
  const cur = row[col];
  if (typeof cur !== 'string') return;
  const to = map.get(cur);
  if (to) row[col] = to;
}

/** panels.members is a JSONB array of { personaId, order, modelOverride }. */
function remapMembers(members: unknown, map: Map<string, string>): unknown {
  if (!Array.isArray(members)) return members;
  return members.map((m) => {
    if (m && typeof m === 'object' && 'personaId' in (m as Record<string, unknown>)) {
      const to = map.get(String((m as Record<string, unknown>)['personaId']));
      if (to) return { ...(m as Record<string, unknown>), personaId: to };
    }
    return m;
  });
}

// ── Generic table copy ────────────────────────────────────────────────────────
interface CopyOpts {
  order?: string[];
  /** Source primary-key values to skip entirely (single-column PKs only). */
  skipIds?: Set<string>;
  pkCol?: string;
  /** Rewrite a row in place; return null to drop it. */
  transform?: (row: Row) => Row | null;
}

async function copyTable(
  srcC: Q, dstC: Q, table: string,
  srcCols: Map<string, string>, dstCols: Map<string, string>, pk: string[],
  opts: CopyOpts = {},
): Promise<{ read: number; inserted: number; dropped: number }> {
  // Only columns present on BOTH sides, so schema drift degrades gracefully.
  const cols = [...dstCols.keys()].filter((c) => srcCols.has(c));
  const order = opts.order ?? (pk.length ? pk : []);
  const pkCol = opts.pkCol ?? 'id';
  let read = 0, inserted = 0, dropped = 0;

  for await (const batch of readRows(srcC, table, order)) {
    read += batch.length;
    const out: Row[] = [];
    for (const row of batch) {
      if (opts.skipIds?.has(String(row[pkCol]))) { dropped++; continue; }
      const t = opts.transform ? opts.transform(row) : row;
      if (t === null) { dropped++; continue; }
      out.push(t);
    }
    if (out.length) inserted += await insertRows(dstC, table, out, cols, dstCols, pk);
  }
  return { read, inserted, dropped };
}

// ── Storage bucket copy ───────────────────────────────────────────────────────
/**
 * Copies the `files` bucket source → target. Runs BEFORE the SQL transaction on
 * purpose: the two cannot share a transaction, and if the SQL phase later rolls
 * back an orphan blob is invisible and harmless, whereas a `files` row whose blob
 * is missing produces a hard 404 in the UI.
 */
async function copyBucket(
  srcEnv: Record<string, string>, dstEnv: Record<string, string>,
  ids: { id: string; mime: string }[], apply: boolean,
): Promise<{ copied: number; existing: number; missing: number }> {
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  const src = createClient(srcEnv['FLEEX_SUPABASE_URL']!, srcEnv['FLEEX_SUPABASE_KEY']!, opts);
  const dst = createClient(dstEnv['FLEEX_SUPABASE_URL']!, dstEnv['FLEEX_SUPABASE_KEY']!, opts);
  let copied = 0, existing = 0, missing = 0;

  for (const [i, f] of ids.entries()) {
    if (!apply) continue;
    const dl = await src.storage.from(BUCKET).download(f.id);
    if (dl.error || !dl.data) {
      missing++;
      console.warn(`  ⚠ blob missing on source: ${f.id} (${dl.error?.message ?? 'no data'})`);
      continue;
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const up = await dst.storage.from(BUCKET).upload(f.id, buf, { contentType: f.mime, upsert: false });
    if (up.error) {
      const m = up.error.message.toLowerCase();
      // upsert:false → an existing key is a 409. That is what makes this re-runnable,
      // and it guarantees the target's own blobs are never overwritten.
      if (m.includes('already exists') || m.includes('duplicate') || m.includes('resource already')) existing++;
      else throw new Error(`upload of ${f.id} failed: ${up.error.message}`);
    } else {
      copied++;
    }
    if ((i + 1) % 25 === 0) log(`  … ${i + 1}/${ids.length} blobs`);
  }
  return { copied, existing, missing };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const all = loadWorkspaces();
  const srcWs = resolveWs(FROM!, all);
  const dstWs = resolveWs(INTO!, all);
  const srcUrl = srcWs.env['FLEEX_SUPABASE_DB_URL']!;
  const dstUrl = dstWs.env['FLEEX_SUPABASE_DB_URL']!;

  log(`\n${'='.repeat(78)}`);
  log(`  Fleex workspace merge:  ${srcWs.name}  →  ${dstWs.name}`);
  log(`  Mode: ${APPLY ? 'APPLY (writes to the target)' : 'DRY RUN (audit only, no writes)'}`);
  log(`${'='.repeat(78)}\n`);

  // ── Preflight ──
  if (dbIdentity(srcUrl) === dbIdentity(dstUrl)) {
    fail(`Both workspaces point at the same database (${dbIdentity(srcUrl)}). Refusing to merge a database into itself.`);
  }
  if (srcWs.env['FLEEX_SUPABASE_URL'] === dstWs.env['FLEEX_SUPABASE_URL']) {
    fail('Both workspaces share the same FLEEX_SUPABASE_URL. Refusing to run.');
  }
  if (dbPort(dstUrl) === '6543') {
    fail('The target FLEEX_SUPABASE_DB_URL uses port 6543 (pgbouncer transaction mode), which ' +
      'cannot hold the long BEGIN…COMMIT this merge needs. Use the direct connection (port 5432).');
  }
  const running = ALLOW_RUNNING ? [] : runningInstances();
  if (running.length) {
    fail(`Fleex is still running:\n    ${running.join('\n    ')}\n\n` +
      `  Run "fleex stop --all" first. The storage adapters use write-through in-memory caches\n` +
      `  warmed at boot, so a live server would neither see these rows nor stop overwriting them.`);
  }
  if (APPLY) {
    if (!BACKUP) {
      fail('--apply requires --backup <file>. Take one first:\n\n' +
        `    mkdir -p ~/.fleex/backups\n` +
        `    pg_dump "$TARGET_DB_URL" -Fc --no-owner --no-privileges \\\n` +
        `      -f ~/.fleex/backups/${dstWs.name}-premerge-$(date +%Y%m%d-%H%M%S).dump\n\n` +
        '  (pg_dump does not cover the Storage bucket; the blob copy is insert-only, and\n' +
        `   the ${srcWs.name} instance is left untouched as the other half of the safety net.)`);
    }
    if (!existsSync(BACKUP) || statSync(BACKUP).size === 0) fail(`Backup "${BACKUP}" does not exist or is empty.`);
    log(`✓ Backup: ${BACKUP} (${(statSync(BACKUP).size / 1e6).toFixed(1)} MB)`);
  }

  const srcPool = new pg.Pool({ connectionString: srcUrl });
  const dstPool = new pg.Pool({ connectionString: dstUrl });
  const srcC = await srcPool.connect();
  let dstC: pg.PoolClient | null = null;
  const report: Record<string, unknown> = { from: srcWs.name, into: dstWs.name, apply: APPLY };

  try {
    // Postgres itself now rejects any write on this connection.
    await srcC.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    log(`✓ Source connection is READ ONLY (enforced by Postgres)`);

    // ── Migration parity ──
    const mig = async (c: Q) => (await c.query('SELECT name FROM _migrations ORDER BY name')).rows.map((r) => String(r['name']));
    const [srcMig, dstMig] = [await mig(srcC), await mig(dstPool)];
    const onlySrc = srcMig.filter((m) => !dstMig.includes(m));
    const onlyDst = dstMig.filter((m) => !srcMig.includes(m));
    if (onlySrc.length || onlyDst.length) {
      fail(`Schema versions differ — align them before merging.\n` +
        `    only in ${srcWs.name}: ${onlySrc.join(', ') || '(none)'}\n` +
        `    only in ${dstWs.name}: ${onlyDst.join(', ') || '(none)'}\n\n` +
        `  Run, with the lagging workspace's env block:\n` +
        `    bun run packages/server/src/infrastructure/migrations/cli-migrate.ts migrate`);
    }
    log(`✓ Both instances at the same migration version (${srcMig.length} migrations)`);

    // ── Physical schema parity ──
    // Equal _migrations does not imply equal physical schema: adapters/supabase/schema.sql
    // was historically applied by hand, and several migrations' supabase: branches differ
    // from their pgsql: ones.
    const [srcTypes, dstTypes, pks] = [await columnTypes(srcC), await columnTypes(dstPool), await primaryKeys(dstPool)];
    const tables = await baseTables(dstPool);
    const srcTables = new Set(await baseTables(srcC));
    const shapeErr: string[] = [];
    for (const t of tables) {
      if (!srcTables.has(t)) { shapeErr.push(`${t}: missing on ${srcWs.name}`); continue; }
      const a = [...(srcTypes.get(t)?.keys() ?? [])].sort();
      const b = [...(dstTypes.get(t)?.keys() ?? [])].sort();
      const onlyA = a.filter((c) => !b.includes(c));
      const onlyB = b.filter((c) => !a.includes(c));
      if (onlyA.length || onlyB.length) {
        shapeErr.push(`${t}: only in ${srcWs.name} [${onlyA}] / only in ${dstWs.name} [${onlyB}]`);
      }
    }
    if (shapeErr.length) fail(`Physical schemas differ:\n    ${shapeErr.join('\n    ')}`);
    log(`✓ Column sets identical across ${tables.length} tables\n`);
    // ── Audit: row counts ──
    log('Row counts');
    log(`  ${'table'.padEnd(30)} ${srcWs.name.padStart(10)} ${dstWs.name.padStart(10)}`);
    log(`  ${'-'.repeat(52)}`);
    const counts: Record<string, { from: number; into: number }> = {};
    for (const t of tables) {
      const a = await count(srcC, t);
      const b = await count(dstPool, t);
      counts[t] = { from: a, into: b };
      if (a || b) log(`  ${t.padEnd(30)} ${String(a).padStart(10)} ${String(b).padStart(10)}`);
    }
    report['counts'] = counts;

    // ── Audit: natural-key collisions (target wins) ──
    const nk = {
      agent_personas: await naturalKey(srcC, dstPool, 'agent_personas', 'name'),
      workflow_templates: await naturalKey(srcC, dstPool, 'workflow_templates', 'slug'),
      skills: await naturalKey(srcC, dstPool, 'skills', 'command_name'),
      panels: await naturalKey(srcC, dstPool, 'panels', 'name'),
      routines: await naturalKey(srcC, dstPool, 'routines', 'slug'),
    };
    log('');
    log('Unique-key collisions (the target wins; the source row is skipped and remapped)');
    for (const [t, r] of Object.entries(nk)) {
      if (!r.collisions.length) { log(`  ${t.padEnd(20)} none`); continue; }
      log(`  ${t.padEnd(20)} ${r.collisions.length}/${r.srcCount} -> ${r.collisions.join(', ')}`);
    }
    report['collisions'] = Object.fromEntries(Object.entries(nk).map(([t, r]) => [t, r.collisions]));

    if (nk.agent_personas.collisions.length) {
      // The one semantic risk of "target wins": the source's workflows, mentions and
      // deliverables reference personas BY NAME, so they silently re-point at the
      // target's persona of the same name, which may carry a different soul/model.
      const names = nk.agent_personas.collisions;
      const sRows = (await srcC.query(
        'SELECT name, model, length(soul_md) AS soul FROM agent_personas WHERE name = ANY($1)', [names])).rows;
      const dRows = (await dstPool.query(
        'SELECT name, model, length(soul_md) AS soul FROM agent_personas WHERE name = ANY($1)', [names])).rows;
      const dBy = new Map(dRows.map((r) => [String(r['name']), r]));
      log('');
      log('  WARNING same-name personas: imported work will resolve to the target version');
      for (const r of sRows) {
        const d = dBy.get(String(r['name']));
        log(`      ${String(r['name']).padEnd(22)} ${srcWs.name}: ${r['model']} soul=${r['soul']}` +
          `   ${dstWs.name}: ${d?.['model']} soul=${d?.['soul']}`);
      }
    }

    // ── Audit: display_id ──
    const dRange = async (c: Q) => (await c.query(
      'SELECT COALESCE(min(display_id),0) AS lo, COALESCE(max(display_id),0) AS hi FROM tickets')).rows[0]!;
    const sR = await dRange(srcC);
    const dR = await dRange(dstPool);
    const offset = Number(dR['hi']);
    log('');
    log('Ticket numbering');
    log(`  ${srcWs.name}: #${sR['lo']}-#${sR['hi']}    ${dstWs.name}: #${dR['lo']}-#${dR['hi']}`);
    log(`  -> ${srcWs.name} tickets renumbered from #${offset + 1} upward; ${dstWs.name} keeps its numbers`);
    report['displayIdOffset'] = offset;

    // ── Audit: boards sharing a name (boards.name has no unique constraint) ──
    const srcBoardNames = (await srcC.query('SELECT name FROM boards')).rows.map((r) => String(r['name']));
    const dstBoardNames = new Set((await dstPool.query('SELECT name FROM boards')).rows.map((r) => String(r['name'])));
    const dupBoards = [...new Set(srcBoardNames.filter((n) => dstBoardNames.has(n)))];
    if (dupBoards.length) {
      log('');
      log(`  WARNING boards sharing a name will coexist (no unique constraint on boards.name),` +
        ` manual cleanup after the merge: ${dupBoards.join(', ')}`);
    }

    // ── Audit: users / user_kv ──
    const dstEmails = new Set((await dstPool.query('SELECT email FROM users')).rows.map((r) => String(r['email'])));
    const dstProv = new Set((await dstPool.query('SELECT provider, provider_id FROM users')).rows
      .map((r) => ck(r['provider'], r['provider_id'])));
    const srcUsers = (await srcC.query('SELECT * FROM users')).rows;
    const userSkipIds = new Set(srcUsers
      .filter((u) => String(u['id']) === SEEDED_USER_ID || dstEmails.has(String(u['email'])) ||
        dstProv.has(ck(u['provider'], u['provider_id'])))
      .map((u) => String(u['id'])));
    log('');
    log(`Users: ${srcUsers.length} in ${srcWs.name}, ${userSkipIds.size} skipped` +
      ` (seeded local user and/or email/provider collisions)`);

    const dstKv = new Set((await dstPool.query('SELECT user_id, key FROM user_kv')).rows
      .map((r) => ck(r['user_id'], r['key'])));
    const srcKvRows = (await srcC.query('SELECT user_id, key FROM user_kv')).rows;
    const kvHit = srcKvRows.filter((r) => dstKv.has(ck(r['user_id'], r['key'])));
    const kvScratch = kvHit.filter((r) => String(r['key']).startsWith('scratchpad:'));
    log(`user_kv: ${srcKvRows.length} keys in ${srcWs.name}, ${kvHit.length} colliding` +
      ` (${kvScratch.length} of them scratchpad content)`);
    if (kvScratch.length) {
      log('  -> policy "' + KV_POLICY + '": ' + (KV_POLICY === 'suffix'
        ? `colliding scratchpads imported as "<key> (${srcWs.name})" so nothing is lost`
        : 'colliding scratchpads DROPPED (pass --kv-policy suffix to keep them)'));
    }

    // ── Audit: app_config deliverable types ──
    const cfgData = async (c: Q) =>
      (await c.query("SELECT data FROM app_config WHERE id = 'singleton'")).rows[0]?.['data'] as Record<string, unknown> | undefined;
    const sCfg = await cfgData(srcC);
    const dCfg = await cfgData(dstPool);
    const typeIds = (c?: Record<string, unknown>) =>
      (Array.isArray(c?.['deliverableTypes']) ? (c!['deliverableTypes'] as Record<string, unknown>[]) : [])
        .map((t) => String(t['id']));
    const dstTypeIds = new Set(typeIds(dCfg));
    const onlySrcTypes = typeIds(sCfg).filter((t) => !dstTypeIds.has(t));
    if (onlySrcTypes.length) {
      log('');
      log(`  WARNING deliverable types only in ${srcWs.name}: ${onlySrcTypes.join(', ')}` +
        ` (imported deliverables of these types render with fallbacks).` +
        (MERGE_CONFIG ? ' --merge-config will union them.' : ' Pass --merge-config to union them.'));
    }

    // ── Audit: files vs blobs ──
    const srcFiles = (await srcC.query('SELECT id, mime_type FROM files')).rows
      .map((r) => ({ id: String(r['id']), mime: String(r['mime_type']) }));
    log('');
    log(`Files: ${srcFiles.length} rows in ${srcWs.name}${SKIP_FILES ? ' (blob copy skipped)' : ''}`);

    if (!APPLY) {
      if (REPORT) { writeFileSync(REPORT, JSON.stringify(report, null, 2)); log(`\nReport written to ${REPORT}`); }
      log('');
      log('='.repeat(78));
      log('  DRY RUN - nothing was written. Review the audit above, then re-run with:');
      log(`    --apply --backup <pg_dump of ${dstWs.name}>`);
      log('='.repeat(78));
      log('');
      return;
    }

    // ── Storage blobs (before the SQL transaction — see copyBucket) ──
    if (!SKIP_FILES && srcFiles.length) {
      log('');
      log(`Copying ${srcFiles.length} blobs from the "${BUCKET}" bucket...`);
      const b = await copyBucket(srcWs.env, dstWs.env, srcFiles, true);
      log(`  copied ${b.copied}, already present ${b.existing}, missing on source ${b.missing}`);
      report['blobs'] = b;
    }

    // ── SQL phase: one transaction, on a dedicated client ──
    // A pool would scatter BEGIN/COMMIT across connections and the transaction
    // would be meaningless.
    dstC = await dstPool.connect();
    const stats: Record<string, { read: number; inserted: number; dropped: number }> = {};
    const cols = (t: string) => dstTypes.get(t) ?? new Map<string, string>();
    const sCols = (t: string) => srcTypes.get(t) ?? new Map<string, string>();
    const pk = (t: string) => pks.get(t) ?? ['id'];
    const run = async (t: string, o: CopyOpts = {}) => {
      stats[t] = await copyTable(srcC, dstC!, t, sCols(t), cols(t), pk(t), o);
      const s = stats[t]!;
      log(`  ${t.padEnd(30)} read ${String(s.read).padStart(7)}  inserted ${String(s.inserted).padStart(7)}` +
        `  skipped ${String(s.dropped).padStart(6)}`);
    };

    const mapCsvPath = join(homedir(), '.fleex', `merge-${srcWs.name}-into-${dstWs.name}-display-ids.csv`);
    const mapCsvOut: string[] = ['ticket_id,old_display_id,new_display_id,title'];

    try {
      await dstC.query('BEGIN');
      // Supabase's defaults would otherwise kill a long-running merge.
      await dstC.query("SET LOCAL statement_timeout = '30min'");
      await dstC.query("SET LOCAL idle_in_transaction_session_timeout = '30min'");
      // Serialise concurrent runs of this script.
      const lock = await dstC.query("SELECT pg_try_advisory_xact_lock(hashtext('fleex-merge-workspaces')) AS ok");
      if (!lock.rows[0]?.['ok']) fail('Another merge is already running against this target.');

      const personaMap = nk.agent_personas.remap;
      const templateMap = nk.workflow_templates.remap;
      const routineMap = nk.routines.remap;

      log('');
      log('Phase A - primitives (natural keys, target wins)');
      await run('agent_personas', { skipIds: nk.agent_personas.skip });
      await run('workflow_templates', { skipIds: nk.workflow_templates.skip });
      await run('skills', {
        skipIds: nk.skills.skip,
        transform: (r) => { remapCol(r, 'persona_id', personaMap); return r; },
      });
      await run('panels', {
        skipIds: nk.panels.skip,
        transform: (r) => {
          remapCol(r, 'orchestrator_persona_id', personaMap);
          // members is a JSONB array of { personaId, order, modelOverride }
          r['members'] = remapMembers(r['members'], personaMap);
          return r;
        },
      });
      await run('routines', {
        skipIds: nk.routines.skip,
        transform: (r) => {
          remapCol(r, 'template_id', templateMap);
          // Scheduler claims (migration 032) are per-instance and meaningless here.
          r['last_claimed_by'] = null;
          r['last_claimed_at'] = null;
          // Imported disabled by default: the source's routines were authored against
          // the source workspace's basePath, and a cron firing right after
          // `fleex start` against a worktree that is not there is a real trap.
          if (!ENABLE_ROUTINES) r['enabled'] = false;
          return r;
        },
      });

      log('');
      log('Phase B - content (ids preserved)');
      await run('boards');

      // ── tickets: renumber display_id above the target's range ──
      const existingTicketIds = new Set(
        (await dstC.query('SELECT id FROM tickets')).rows.map((r) => String(r['id'])));
      const srcTickets = (await srcC.query(
        'SELECT * FROM tickets ORDER BY display_id ASC, created_at ASC, id ASC')).rows as Row[];
      let n = 0;
      const renumbered: Row[] = [];
      for (const t of srcTickets) {
        if (existingTicketIds.has(String(t['id']))) continue;   // resumed run
        const old = t['display_id'];
        t['display_id'] = offset + (++n);
        mapCsvOut.push(`${t['id']},${old},${t['display_id']},"${String(t['title']).replace(/"/g, '""')}"`);
        renumbered.push(t);
      }
      const tCols = [...cols('tickets').keys()].filter((c) => sCols('tickets').has(c));
      const tIns = await insertRows(dstC, 'tickets', renumbered, tCols, cols('tickets'), pk('tickets'));
      stats['tickets'] = { read: srcTickets.length, inserted: tIns, dropped: srcTickets.length - renumbered.length };
      log(`  ${'tickets'.padEnd(30)} read ${String(srcTickets.length).padStart(7)}  inserted ${String(tIns).padStart(7)}` +
        `  skipped ${String(srcTickets.length - renumbered.length).padStart(6)}`);

      await run('ticket_groups');
      await run('ticket_group_boards');
      await run('ticket_group_memberships');
      await run('ticket_relationships');
      // created_at ordering so a comment lands after its parent_id.
      await run('comments', { order: ['created_at', 'id'] });
      await run('mentions', { order: ['created_at', 'id'] });
      await run('workflow_runs', {
        order: ['created_at', 'id'],   // parent_run_id
        transform: (r) => {
          remapCol(r, 'template_id', templateMap);
          remapCol(r, 'routine_id', routineMap);
          return r;
        },
      });
      await run('step_runs', { order: ['created_at', 'id'] });
      await run('deliverables', { order: ['created_at', 'id'] });
      await run('agent_event_executions', {
        pkCol: 'execution_id',
        order: ['started_at', 'execution_id'],
        transform: (r) => {
          // persona_id also legitimately holds the literal 'cli' or a panel id;
          // remapCol only rewrites values it actually knows.
          remapCol(r, 'persona_id', personaMap);
          remapCol(r, 'routine_id', routineMap);
          return r;
        },
      });
      await run('ticket_activities', { order: ['created_at', 'id'] });
      await run('files');

      if (!SKIP_TOKENS) await run('api_tokens');
      else log(`  ${'api_tokens'.padEnd(30)} skipped (--skip-tokens)`);

      if (!SKIP_EVENT_LOG) await run('domain_event_log', { order: ['occurred_at', 'id'] });
      else log(`  ${'domain_event_log'.padEnd(30)} skipped (--skip-event-log)`);

      // users: three unique constraints (id, email, (provider, provider_id)), so a
      // colliding email would abort the whole transaction. Pre-filter, don't rely
      // on ON CONFLICT (id).
      await run('users', { skipIds: userSkipIds });

      // user_kv: composite PK (user_id, key). Ticket-scoped keys never really collide;
      // scratchpad keys carry content, so under "suffix" they are kept aside.
      const dstKvNow = new Set((await dstC.query('SELECT user_id, key FROM user_kv')).rows
        .map((r) => ck(r['user_id'], r['key'])));
      await run('user_kv', {
        transform: (r) => {
          if (!dstKvNow.has(ck(r['user_id'], r['key']))) return r;
          // Colliding key. Only scratchpad keys carry content worth keeping aside;
          // read cursors and seen-deliverable sets are per-user UI state that the
          // target rebuilds on its own, so the target's value simply wins.
          //
          // Restricting the suffix to scratchpad keys is also what makes a re-run
          // idempotent: a cursor imported by an earlier run now looks like a
          // collision, and suffixing it would add a new row on every run.
          if (KV_POLICY === 'skip' || !String(r['key']).startsWith('scratchpad:')) return null;
          const suffixed = `${r['key']} (${srcWs.name})`;
          if (dstKvNow.has(ck(r['user_id'], suffixed))) return null;   // already imported
          r['key'] = suffixed;
          return r;
        },
      });

      // app_config is a singleton row: ON CONFLICT (id) DO NOTHING keeps the target's.
      if (MERGE_CONFIG && sCfg) {
        const merged = { ...(dCfg ?? {}) } as Record<string, unknown>;
        const dTypes = Array.isArray(dCfg?.['deliverableTypes']) ? dCfg!['deliverableTypes'] as Record<string, unknown>[] : [];
        const sTypes = Array.isArray(sCfg['deliverableTypes']) ? sCfg['deliverableTypes'] as Record<string, unknown>[] : [];
        const seen = new Set(dTypes.map((t) => String(t['id'])));
        merged['deliverableTypes'] = [...dTypes, ...sTypes.filter((t) => !seen.has(String(t['id'])))];
        const dRepos = Array.isArray(dCfg?.['repositories']) ? dCfg!['repositories'] as unknown[] : [];
        const sRepos = Array.isArray(sCfg['repositories']) ? sCfg['repositories'] as unknown[] : [];
        const key = (r: unknown) => JSON.stringify(r);
        const seenR = new Set(dRepos.map(key));
        merged['repositories'] = [...dRepos, ...sRepos.filter((r) => !seenR.has(key(r)))];
        // basePath is workspace-local and must never be copied.
        delete (merged as { basePath?: unknown })['basePath'];
        if (dCfg && 'basePath' in dCfg) merged['basePath'] = dCfg['basePath'];
        await dstC.query("UPDATE app_config SET data = $1::jsonb, updated_at = now() WHERE id = 'singleton'",
          [JSON.stringify(merged)]);
        log(`  ${'app_config'.padEnd(30)} deliverableTypes/repositories unioned (--merge-config)`);
      } else {
        log(`  ${'app_config'.padEnd(30)} kept from ${dstWs.name} (singleton)`);
      }

      // ── Recalibrate the ticket sequence — MUST be after the ticket inserts ──
      // setval's third arg (is_called) must be true: with false the next nextval
      // returns MAX itself and violates idx_tickets_display_id_unique.
      // setval is not transactional; if this transaction aborts the sequence keeps
      // the raised value, which only creates number gaps — never collisions.
      const seq = (await dstC.query("SELECT pg_get_serial_sequence('tickets','display_id') AS s")).rows[0]?.['s'];
      if (!seq) throw new Error('tickets.display_id has no owned sequence — refusing to leave numbering broken.');
      await dstC.query('SELECT setval($1::regclass, (SELECT COALESCE(MAX(display_id), 1) FROM tickets), true)', [seq]);
      const seqNow = (await dstC.query('SELECT last_value, is_called FROM ' + String(seq))).rows[0];
      log('');
      log(`Sequence ${seq} set to ${seqNow?.['last_value']} (is_called=${seqNow?.['is_called']})`);

      await dstC.query('COMMIT');
      log('');
      log('COMMIT ok');
    } catch (e) {
      await dstC.query('ROLLBACK').catch(() => {});
      throw e;
    }

    report['stats'] = stats;
    if (mapCsvPath && mapCsvOut.length > 1) {
      writeFileSync(mapCsvPath, mapCsvOut.join('\n') + '\n');
      log(`Ticket number map: ${mapCsvPath}`);
    }

    // ── Post-merge verification ──
    log('');
    log('Verification (every count must be 0)');
    const checks: [string, string][] = [
      ['duplicate display_id', 'SELECT count(*)::int AS n FROM (SELECT display_id FROM tickets GROUP BY 1 HAVING count(*) > 1) x'],
      ['tickets without board', 'SELECT count(*)::int AS n FROM tickets t LEFT JOIN boards b ON b.id = t.board_id WHERE b.id IS NULL'],
      ['comments without ticket', 'SELECT count(*)::int AS n FROM comments c LEFT JOIN tickets t ON t.id = c.ticket_id WHERE t.id IS NULL'],
      ['mentions without ticket', 'SELECT count(*)::int AS n FROM mentions m LEFT JOIN tickets t ON t.id = m.ticket_id WHERE t.id IS NULL'],
      ['mentions without comment', 'SELECT count(*)::int AS n FROM mentions m LEFT JOIN comments c ON c.id = m.comment_id WHERE c.id IS NULL'],
      ['activities without ticket', 'SELECT count(*)::int AS n FROM ticket_activities a LEFT JOIN tickets t ON t.id = a.ticket_id WHERE t.id IS NULL'],
      ['deliverables without ticket', 'SELECT count(*)::int AS n FROM deliverables d LEFT JOIN tickets t ON t.id = d.ticket_id WHERE d.ticket_id IS NOT NULL AND t.id IS NULL'],
      ['deliverables without run', 'SELECT count(*)::int AS n FROM deliverables d LEFT JOIN workflow_runs w ON w.id = d.workflow_run_id WHERE d.workflow_run_id IS NOT NULL AND w.id IS NULL'],
      ['skills without persona', 'SELECT count(*)::int AS n FROM skills s LEFT JOIN agent_personas p ON p.id = s.persona_id WHERE p.id IS NULL'],
      ['panels without orchestrator', 'SELECT count(*)::int AS n FROM panels pa LEFT JOIN agent_personas p ON p.id = pa.orchestrator_persona_id WHERE pa.orchestrator_persona_id IS NOT NULL AND p.id IS NULL'],
      ['panel members without persona', `SELECT count(*)::int AS n FROM panels pa, LATERAL jsonb_array_elements(pa.members) m
         LEFT JOIN agent_personas p ON p.id = m->>'personaId' WHERE p.id IS NULL`],
      ['runs without template', 'SELECT count(*)::int AS n FROM workflow_runs w LEFT JOIN workflow_templates t ON t.id = w.template_id WHERE w.template_id IS NOT NULL AND t.id IS NULL'],
      ['runs without routine', 'SELECT count(*)::int AS n FROM workflow_runs w LEFT JOIN routines r ON r.id = w.routine_id WHERE w.routine_id IS NOT NULL AND r.id IS NULL'],
      ['step_runs without run', 'SELECT count(*)::int AS n FROM step_runs s LEFT JOIN workflow_runs w ON w.id = s.workflow_run_id WHERE w.id IS NULL'],
      ['routines without template', 'SELECT count(*)::int AS n FROM routines r LEFT JOIN workflow_templates t ON t.id = r.template_id WHERE r.template_id IS NOT NULL AND t.id IS NULL'],
      ['user_kv without user', 'SELECT count(*)::int AS n FROM user_kv k LEFT JOIN users u ON u.id = k.user_id WHERE u.id IS NULL'],
      ['group memberships without ticket', 'SELECT count(*)::int AS n FROM ticket_group_memberships m LEFT JOIN tickets t ON t.id = m.ticket_id WHERE t.id IS NULL'],
      ['group memberships without group', 'SELECT count(*)::int AS n FROM ticket_group_memberships m LEFT JOIN ticket_groups g ON g.id = m.group_id WHERE g.id IS NULL'],
      ['relationships without parent', 'SELECT count(*)::int AS n FROM ticket_relationships r LEFT JOIN tickets t ON t.id = r.parent_id WHERE t.id IS NULL'],
      ['relationships without child', 'SELECT count(*)::int AS n FROM ticket_relationships r LEFT JOIN tickets t ON t.id = r.child_id WHERE t.id IS NULL'],
      // Name-based references: the class the remap deliberately does not touch.
      ['mentions naming an unknown agent', `SELECT count(*)::int AS n FROM mentions
         WHERE target_type = 'agent' AND target_agent NOT IN (SELECT name FROM agent_personas)`],
      ['routines naming an unknown target', `SELECT count(*)::int AS n FROM routines
         WHERE (target_kind = 'agent' AND target_ref NOT IN (SELECT name FROM agent_personas))
            OR (target_kind = 'skill' AND target_ref NOT IN (SELECT command_name FROM skills))
            OR (target_kind = 'panel' AND target_ref NOT IN (SELECT name FROM panels))`],
    ];
    let bad = 0;
    for (const [label, sql] of checks) {
      let n = -1;
      try { n = Number((await dstPool.query(sql)).rows[0]?.['n'] ?? -1); }
      catch (e) { log(`  ${label.padEnd(36)} SKIPPED (${(e as Error).message.split('\n')[0]})`); continue; }
      if (n !== 0) bad++;
      log(`  ${label.padEnd(36)} ${n === 0 ? 'ok' : `${n}  <-- CHECK THIS`}`);
    }
    report['verification'] = { failed: bad };

    // Files metadata vs blobs actually present.
    try {
      const fRows = Number((await dstPool.query('SELECT count(*)::int AS n FROM files')).rows[0]?.['n'] ?? 0);
      const fBlobs = Number((await dstPool.query(
        "SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = $1", [BUCKET])).rows[0]?.['n'] ?? 0);
      log(`  ${'files rows vs blobs'.padEnd(36)} ${fRows} rows / ${fBlobs} blobs`);
    } catch { /* storage schema not readable by this role */ }

    if (REPORT) { writeFileSync(REPORT, JSON.stringify(report, null, 2)); log(`\nReport written to ${REPORT}`); }

    log('');
    log('='.repeat(78));
    log(`  Merge complete: ${srcWs.name} -> ${dstWs.name}` + (bad ? `  (${bad} verification check(s) non-zero)` : ''));
    log('');
    log('  Next steps:');
    log(`    1. fleex start --workspace ${dstWs.name}`);
    log('    2. Check a board, open an imported ticket, download an attachment.');
    log('    3. Create a ticket and confirm it gets the next free number.');
    log(`    4. fleex routine list  -> re-enable the ${srcWs.name} routines you want` +
      (ENABLE_ROUTINES ? '' : ' (imported disabled)') + ', and fix their repo/board targets.');
    log(`    5. Do NOT run "fleex start --workspace ${srcWs.name}" again: it would write to` +
      ' the old database and the two contents would diverge.');
    log('='.repeat(78));
    log('');
  } finally {
    srcC.release();
    dstC?.release();
    await srcPool.end().catch(() => {});
    await dstPool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
