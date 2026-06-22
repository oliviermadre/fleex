#!/usr/bin/env bun
/**
 * Backfill / safety-net for CLI session costs. Scans local Claude transcripts,
 * finds manual `claude` CLI sessions (`entrypoint: cli`) run inside a Fleex
 * worktree (`.fleex.json` in cwd or an ancestor), computes their cost, and
 * upserts them into the right workspace DB as `source='cli'` executions.
 *
 * The real-time path is the `SessionEnd` hook (server `/api/hook`); this script
 * covers history and sessions that never fired the hook. Idempotent (stable
 * `cli:<sessionId>` key), routed per workspace by `basePath`.
 *
 * Usage:
 *   bun run packages/server/scripts/ingest-cli-sessions.ts [--workspace <name|all>] [--apply] [--claude-dir <path>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import { computeSessionCost, detectFleexTicket } from '../src/application/utils/cli-session-ingest.js';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d; };
const APPLY = has('--apply');
const WS_ARG = (val('--workspace', 'all') ?? 'all').toLowerCase();
const CLAUDE_DIR = val('--claude-dir', process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'))!;

interface Workspace { name: string; env: Record<string, string>; basePath?: string; }

function loadWorkspaces(): Workspace[] {
  const raw = JSON.parse(readFileSync(join(homedir(), '.fleex', 'workspaces.json'), 'utf-8'));
  return (raw.workspaces ?? []) as Workspace[];
}

/** Match a cwd to the workspace whose basePath contains it (longest first). */
function routeWorkspace(cwd: string, workspaces: Workspace[]): Workspace | null {
  const c = resolve(cwd);
  const sorted = [...workspaces].filter((w) => w.basePath).sort((a, b) => b.basePath!.length - a.basePath!.length);
  for (const w of sorted) {
    const base = resolve(w.basePath!);
    if (c === base || c.startsWith(base + sep)) return w;
  }
  return null;
}

interface Db {
  hasTicket(id: string): Promise<boolean>;
  upsert(r: Row): Promise<void>;
  close(): Promise<void>;
}
interface Row {
  executionId: string; sessionId: string; ticketId: string; model: string | null;
  startedAt: string; completedAt: string; durationMs: number | null; cost: number;
  input: number; output: number; cacheRead: number; cacheCreation: number;
}

async function openSupabase(dbUrl: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: dbUrl });
  return {
    async hasTicket(id) { const { rowCount } = await pool.query('SELECT 1 FROM tickets WHERE id = $1', [id]); return (rowCount ?? 0) > 0; },
    async upsert(r) {
      await pool.query(
        `INSERT INTO agent_event_executions
          (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at,
           completed_at, sdk_session_id, model, duration_ms, cost_usd, input_tokens,
           output_tokens, cache_read_tokens, cache_creation_tokens, source)
         VALUES ($1,'cli',$2,$3,0,'completed',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'cli')
         ON CONFLICT (execution_id) DO UPDATE SET
           completed_at=EXCLUDED.completed_at, sdk_session_id=EXCLUDED.sdk_session_id, model=EXCLUDED.model,
           duration_ms=EXCLUDED.duration_ms, cost_usd=EXCLUDED.cost_usd, input_tokens=EXCLUDED.input_tokens,
           output_tokens=EXCLUDED.output_tokens, cache_read_tokens=EXCLUDED.cache_read_tokens,
           cache_creation_tokens=EXCLUDED.cache_creation_tokens, source='cli'`,
        [r.executionId, r.ticketId, r.executionId, r.startedAt, r.completedAt, r.sessionId, r.model,
         r.durationMs, r.cost, r.input, r.output, r.cacheRead, r.cacheCreation],
      );
    },
    async close() { await pool.end(); },
  };
}

async function openSqlite(dbPath: string): Promise<Db> {
  const { Database } = await import('bun:sqlite');
  const db = new Database(dbPath);
  return {
    async hasTicket(id) { return !!db.query('SELECT 1 FROM tickets WHERE id = ?').get(id); },
    async upsert(r) {
      db.query(
        `INSERT INTO agent_event_executions
          (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at,
           completed_at, sdk_session_id, model, duration_ms, cost_usd, input_tokens,
           output_tokens, cache_read_tokens, cache_creation_tokens, source)
         VALUES (?,'cli',?,?,0,'completed',?,?,?,?,?,?,?,?,?,?,'cli')
         ON CONFLICT(execution_id) DO UPDATE SET
           completed_at=excluded.completed_at, sdk_session_id=excluded.sdk_session_id, model=excluded.model,
           duration_ms=excluded.duration_ms, cost_usd=excluded.cost_usd, input_tokens=excluded.input_tokens,
           output_tokens=excluded.output_tokens, cache_read_tokens=excluded.cache_read_tokens,
           cache_creation_tokens=excluded.cache_creation_tokens, source='cli'`,
      ).run(r.executionId, r.ticketId, r.executionId, r.startedAt, r.completedAt, r.sessionId, r.model,
            r.durationMs, r.cost, r.input, r.output, r.cacheRead, r.cacheCreation);
    },
    async close() { db.close(); },
  };
}

async function openDb(ws: Workspace): Promise<Db | null> {
  const driver = ws.env['FLEEX_STORAGE_DRIVER'];
  if (driver === 'supabase') {
    const url = ws.env['FLEEX_SUPABASE_DB_URL'];
    if (!url) { console.error(`  ⚠ ${ws.name}: no FLEEX_SUPABASE_DB_URL`); return null; }
    return openSupabase(url);
  }
  if (driver === 'sqlite') {
    const p = ws.env['FLEEX_SQLITE_PATH'];
    if (!p || !existsSync(p)) { console.error(`  ⚠ ${ws.name}: sqlite path missing`); return null; }
    return openSqlite(p);
  }
  return null;
}

async function main() {
  const all = loadWorkspaces();
  const wanted = WS_ARG === 'all' ? all : all.filter((w) => w.name.toLowerCase() === WS_ARG);
  if (wanted.length === 0) { console.error(`No workspace matched "${WS_ARG}".`); process.exit(1); }

  console.log(`Ingest CLI sessions — ${APPLY ? 'APPLY' : 'DRY-RUN'} | claude=${CLAUDE_DIR}/projects`);

  // Index transcripts (sessionId → path) and open DBs lazily per workspace.
  const projects = join(CLAUDE_DIR, 'projects');
  const dbs = new Map<string, Db | null>();
  const getDb = async (ws: Workspace) => {
    if (!dbs.has(ws.name)) dbs.set(ws.name, await openDb(ws));
    return dbs.get(ws.name) ?? null;
  };

  let scanned = 0, cliFleex = 0, ingested = 0, skipUnknown = 0, skipRoute = 0, costSum = 0;
  const lines: string[] = [];

  if (existsSync(projects)) {
    for (const dir of await readdir(projects, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sub = join(projects, dir.name);
      for (const f of await readdir(sub)) {
        if (!f.endsWith('.jsonl')) continue;
        scanned++;
        const path = join(sub, f);
        const c = await computeSessionCost(path);
        if (c.entrypoint !== 'cli') continue;
        // cwd: derive from the transcript's own cwd field (more reliable than the dir name).
        const cwd = firstCwd(path);
        if (!cwd) continue;
        const ticketId = detectFleexTicket(cwd);
        if (!ticketId) continue;
        cliFleex++;
        const ws = routeWorkspace(cwd, wanted);
        if (!ws) { skipRoute++; continue; }
        const db = await getDb(ws);
        if (!db) { skipRoute++; continue; }
        if (!(await db.hasTicket(ticketId))) { skipRoute++; continue; }
        if (c.hasUnknownModel) { skipUnknown++; console.error(`  ⚠ unknown model in ${f} — skipped`); continue; }

        const sessionId = f.slice(0, -'.jsonl'.length);
        const startedAt = c.startedAt ?? c.completedAt ?? new Date().toISOString();
        const completedAt = c.completedAt ?? startedAt;
        const durationMs = c.startedAt && c.completedAt ? new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime() : null;
        costSum += c.cost;
        lines.push(`  ${ws.name.padEnd(7)} ${ticketId.slice(0, 8)} ${sessionId.slice(0, 8)} ${(c.model ?? '?').replace('claude-', '').slice(0, 14).padEnd(14)} $${c.cost.toFixed(3)}`);
        if (APPLY) {
          await db.upsert({
            executionId: `cli:${sessionId}`, sessionId, ticketId, model: c.model,
            startedAt, completedAt, durationMs, cost: c.cost,
            input: c.inputTokens, output: c.outputTokens, cacheRead: c.cacheReadTokens, cacheCreation: c.cacheCreationTokens,
          });
          ingested++;
        }
      }
    }
  }

  for (const l of lines) console.log(l);
  console.log(`\nScanned ${scanned} | CLI+Fleex ${cliFleex} | matched ${lines.length} ($${costSum.toFixed(2)}) | ` +
    `${APPLY ? `${ingested} upserted` : 'dry-run'} | skipped: ${skipRoute} other-workspace, ${skipUnknown} unknown-model`);

  for (const db of dbs.values()) await db?.close();
}

/** Read the first `cwd` field from a transcript (the session's working dir). */
function firstCwd(path: string): string | null {
  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try { const d = JSON.parse(line); if (typeof d.cwd === 'string' && d.cwd) return d.cwd; } catch { /* skip */ }
  }
  return null;
}

main().catch((e) => { console.error(e); process.exit(1); });
