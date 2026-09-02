#!/usr/bin/env bun
/**
 * Backfill `cost_usd` + token breakdown on agent executions whose metrics were
 * never persisted (historically: every workflow-step execution — see
 * execute-agent.ts `executeForWorkflowStep`, fixed going forward).
 *
 * It is idempotent and NULL-only: it only fills rows where `cost_usd IS NULL`,
 * and the UPDATE is guarded by the same predicate, so re-running is a no-op and
 * it never clobbers a value the SDK already reported.
 *
 * Matching (exact, no time heuristics):
 *   execution row → SDK session id:
 *     1. `agent_event_executions.sdk_session_id` if present, else
 *     2. the `turn_start` event in ~/.fleex/projects/agent-events/<exec>.jsonl
 *   session id → Claude transcript: <claude-dir>/projects/<enc>/<sessionId>.jsonl
 *   transcript → cost: sum each assistant `usage` × public list price.
 *
 * Two-machine setup: driven by DB rows + skip-if-transcript-absent, so each
 * machine fills only the rows whose transcript it holds locally. Run it on both.
 *
 * Usage:
 *   bun run packages/server/scripts/backfill-agentic-costs.ts [--workspace <name|all>] [--apply] [--claude-dir <path>]
 *
 *   --workspace   default | tada | sqlite | all   (default: all supabase workspaces)
 *   --apply       write changes (default: dry-run, writes nothing)
 *   --claude-dir  Claude home (default: $CLAUDE_CONFIG_DIR or ~/.claude)
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';

// ── Pricing (USD per token, public list / standard tier) ────────────────────
// inp=input, out=output, read=cache read, w5=cache write 5m, w1=cache write 1h.
// Cache multipliers: read ×0.1, write-5m ×1.25, write-1h ×2 of the input price.
type Price = { inp: number; out: number; read: number; w5: number; w1: number };
const price = (inp: number, out: number): Price => ({
  inp, out, read: inp * 0.1, w5: inp * 1.25, w1: inp * 2,
});
const PRICING: Record<string, Price> = {
  'claude-opus-5': price(5e-6, 25e-6),
  'claude-opus-4-8': price(5e-6, 25e-6),
  'claude-opus-4-7': price(5e-6, 25e-6),
  'claude-opus-4-6': price(5e-6, 25e-6),
  'claude-opus-4-5': price(5e-6, 25e-6),
  'claude-sonnet-5': price(3e-6, 15e-6),
  'claude-sonnet-4-6': price(3e-6, 15e-6),
  'claude-sonnet-4-5': price(3e-6, 15e-6),
  'claude-haiku-4-5': price(1e-6, 5e-6),
  'claude-haiku-4-5-20251001': price(1e-6, 5e-6),
  'claude-fable-5-1': price(10e-6, 50e-6),
  'claude-fable-5': price(10e-6, 50e-6),
  // Claude Code's synthetic (non-API) assistant messages — no billable cost.
  '<synthetic>': price(0, 0),
};
/** Normalize a model id to a pricing key (handles dated snapshots / fast suffixes). */
function priceFor(model: string): Price | null {
  if (PRICING[model]) return PRICING[model];
  const base = model.replace(/-\d{8}$/, '').replace(/-fast$/, '');
  return PRICING[base] ?? null;
}

// ── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d?: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const APPLY = has('--apply');
const WS_ARG = (val('--workspace', 'all') ?? 'all').toLowerCase();
const CLAUDE_DIR = val('--claude-dir', process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'))!;
const EVENTS_DIR = join(homedir(), '.fleex', 'projects', 'agent-events');

// ── Types ─────────────────────────────────────────────────────────────────
interface Workspace { name: string; env: Record<string, string>; }
interface ExecRow {
  execution_id: string;
  sdk_session_id: string | null;
  mention_id: string | null;
  model: string | null;
  ticket_id: string | null;
  started_at: string | null;
}
interface Computed {
  cost: number; input: number; output: number; cacheRead: number; cacheCreation: number;
  models: Set<string>; unknown: Set<string>;
}

// Minimal DB abstraction over pg (supabase) and bun:sqlite.
interface Db {
  selectNullCost(): Promise<ExecRow[]>;
  update(r: { cost: number; input: number; output: number; cacheRead: number; cacheCreation: number; sessionId: string; executionId: string }): Promise<number>;
  close(): Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function loadWorkspaces(): Workspace[] {
  const path = join(homedir(), '.fleex', 'workspaces.json');
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return (raw.workspaces ?? []) as Workspace[];
}

/** Build sessionId → transcript path from <claude-dir>/projects/<enc>/<sid>.jsonl. */
async function buildTranscriptIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const projects = join(CLAUDE_DIR, 'projects');
  if (!existsSync(projects)) return index;
  for (const dir of await readdir(projects, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const sub = join(projects, dir.name);
    for (const f of await readdir(sub)) {
      if (f.endsWith('.jsonl')) index.set(f.slice(0, -'.jsonl'.length), join(sub, f));
    }
  }
  return index;
}

/** Resolve an execution's SDK session id from its row or its local event file. */
async function resolveSessionId(row: ExecRow): Promise<string | null> {
  if (row.sdk_session_id) return row.sdk_session_id;
  const file = join(EVENTS_DIR, `${row.execution_id}.jsonl`);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.includes('sessionId')) continue;
    try {
      const ev = JSON.parse(line);
      const sid = ev?.data?.sessionId;
      if (typeof sid === 'string' && sid) return sid;
    } catch { /* skip malformed */ }
  }
  return null;
}

/** Aggregate token usage across a transcript and price it. */
async function computeFromTranscript(path: string): Promise<Computed> {
  const raw = await readFile(path, 'utf-8');
  const c: Computed = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, models: new Set(), unknown: new Set() };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }
    const msg = d['message'] as Record<string, unknown> | undefined;
    const u = msg?.['usage'] as Record<string, unknown> | undefined;
    if (!u) continue;
    const model = (msg?.['model'] as string) ?? '?';
    c.models.add(model);
    const inp = (u['input_tokens'] as number) ?? 0;
    const out = (u['output_tokens'] as number) ?? 0;
    const rd = (u['cache_read_input_tokens'] as number) ?? 0;
    const cc = (u['cache_creation'] as Record<string, number> | undefined) ?? {};
    let w5 = cc['ephemeral_5m_input_tokens'] ?? 0;
    const w1 = cc['ephemeral_1h_input_tokens'] ?? 0;
    if (!w5 && !w1) w5 = (u['cache_creation_input_tokens'] as number) ?? 0;
    c.input += inp; c.output += out; c.cacheRead += rd; c.cacheCreation += w5 + w1;
    const p = priceFor(model);
    if (!p) { c.unknown.add(model); continue; }
    c.cost += inp * p.inp + out * p.out + rd * p.read + w5 * p.w5 + w1 * p.w1;
  }
  return c;
}

const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

// ── DB adapters ─────────────────────────────────────────────────────────────
async function openSupabase(dbUrl: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: dbUrl });
  return {
    async selectNullCost() {
      const { rows } = await pool.query(
        `SELECT execution_id, sdk_session_id, mention_id, model, ticket_id, started_at
         FROM agent_event_executions
         WHERE cost_usd IS NULL AND status IN ('completed','failed','interrupted')
         ORDER BY started_at DESC`,
      );
      return rows as ExecRow[];
    },
    async update(r) {
      const res = await pool.query(
        `UPDATE agent_event_executions
         SET cost_usd = $1, input_tokens = $2, output_tokens = $3,
             cache_read_tokens = $4, cache_creation_tokens = $5,
             sdk_session_id = COALESCE(sdk_session_id, $6)
         WHERE execution_id = $7 AND cost_usd IS NULL`,
        [r.cost, r.input, r.output, r.cacheRead, r.cacheCreation, r.sessionId, r.executionId],
      );
      return res.rowCount ?? 0;
    },
    async close() { await pool.end(); },
  };
}

async function openSqlite(dbPath: string): Promise<Db> {
  // bun:sqlite — only loaded when a sqlite workspace is actually processed.
  const { Database } = await import('bun:sqlite');
  const db = new Database(dbPath);
  return {
    async selectNullCost() {
      return db.query(
        `SELECT execution_id, sdk_session_id, mention_id, model, ticket_id, started_at
         FROM agent_event_executions
         WHERE cost_usd IS NULL AND status IN ('completed','failed','interrupted')
         ORDER BY started_at DESC`,
      ).all() as ExecRow[];
    },
    async update(r) {
      const res = db.query(
        `UPDATE agent_event_executions
         SET cost_usd = ?, input_tokens = ?, output_tokens = ?,
             cache_read_tokens = ?, cache_creation_tokens = ?,
             sdk_session_id = COALESCE(sdk_session_id, ?)
         WHERE execution_id = ? AND cost_usd IS NULL`,
      ).run(r.cost, r.input, r.output, r.cacheRead, r.cacheCreation, r.sessionId, r.executionId);
      return res.changes;
    },
    async close() { db.close(); },
  };
}

async function openDb(ws: Workspace): Promise<Db | null> {
  const driver = ws.env['FLEEX_STORAGE_DRIVER'];
  if (driver === 'supabase') {
    const url = ws.env['FLEEX_SUPABASE_DB_URL'];
    if (!url) { console.error(`  ⚠ ${ws.name}: no FLEEX_SUPABASE_DB_URL — skipping`); return null; }
    return openSupabase(url);
  }
  if (driver === 'sqlite') {
    const p = ws.env['FLEEX_SQLITE_PATH'];
    if (!p || !existsSync(p)) { console.error(`  ⚠ ${ws.name}: sqlite path missing — skipping`); return null; }
    return openSqlite(p);
  }
  console.error(`  ⚠ ${ws.name}: unsupported driver "${driver}" — skipping`);
  return null;
}

// ── Per-workspace run ────────────────────────────────────────────────────────
async function processWorkspace(ws: Workspace, transcripts: Map<string, string>) {
  console.log(`\n━━ workspace: ${ws.name} (${ws.env['FLEEX_STORAGE_DRIVER']}) ━━`);
  const db = await openDb(ws);
  if (!db) return { updated: 0, total: 0 };

  let total = 0, applied = 0, costSum = 0;
  let noSession = 0, noTranscript = 0, unknownModel = 0;
  const lines: string[] = [];

  try {
    const rows = await db.selectNullCost();
    total = rows.length;
    for (const row of rows) {
      const sid = await resolveSessionId(row);
      if (!sid) { noSession++; continue; }
      const path = transcripts.get(sid);
      if (!path) { noTranscript++; continue; }

      const c = await computeFromTranscript(path);
      if (c.unknown.size > 0) {
        unknownModel++;
        console.error(`  ⚠ unknown model(s) ${[...c.unknown].join(',')} in ${sid} — skipped (no partial write)`);
        continue;
      }
      costSum += c.cost;
      lines.push(
        `  ${row.execution_id.slice(0, 8)}  ${(row.ticket_id ?? '—').slice(0, 14).padEnd(14)} ${sid.slice(0, 8)}  ` +
        `${[...c.models].map((m) => m.replace('claude-', '')).join(',').slice(0, 16).padEnd(16)} ` +
        `in ${fmtTok(c.input).padStart(7)} out ${fmtTok(c.output).padStart(7)} rd ${fmtTok(c.cacheRead).padStart(7)}  $${c.cost.toFixed(3)}`,
      );

      if (APPLY) {
        applied += await db.update({
          cost: c.cost, input: c.input, output: c.output,
          cacheRead: c.cacheRead, cacheCreation: c.cacheCreation,
          sessionId: sid, executionId: row.execution_id,
        });
      }
    }
  } finally {
    await db.close();
  }

  for (const l of lines) console.log(l);
  console.log(
    `  ── ${ws.name}: ${total} null-cost rows | ${lines.length} matched ($${costSum.toFixed(2)}) | ` +
    `${APPLY ? `${applied} updated` : 'dry-run (0 written)'} | ` +
    `skipped: ${noSession} no-session, ${noTranscript} no-transcript-here, ${unknownModel} unknown-model`,
  );
  return { updated: applied, total };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const all = loadWorkspaces();
  const selected = WS_ARG === 'all'
    ? all.filter((w) => w.env['FLEEX_STORAGE_DRIVER'] === 'supabase')
    : all.filter((w) => w.name.toLowerCase() === WS_ARG);

  if (selected.length === 0) {
    console.error(`No workspace matched "${WS_ARG}". Available: ${all.map((w) => w.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`Backfill agentic costs — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`Workspaces: ${selected.map((w) => w.name).join(', ')}`);
  console.log(`Claude transcripts: ${CLAUDE_DIR}/projects`);

  const transcripts = await buildTranscriptIndex();
  console.log(`Indexed ${transcripts.size} local transcript(s).`);

  let grandUpdated = 0;
  for (const ws of selected) {
    const { updated } = await processWorkspace(ws, transcripts);
    grandUpdated += updated;
  }

  console.log(`\nDone. ${APPLY ? `${grandUpdated} row(s) updated.` : 'Dry-run — re-run with --apply to write.'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
