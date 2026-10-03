#!/usr/bin/env bun
/**
 * Correct historical SDK execution costs that hold a running SESSION total
 * instead of the run's own spend — evidence-driven, dry-run by default.
 *
 * Why: since Claude Code CLI 2.1.284 (agent SDK ≥ 0.3.280, bumped 2026-09-28) a
 * resumed session reports usage that carries over every earlier run, and Fleex
 * stored it as the run's cost. Older CLIs reported per-query usage, so those
 * rows are right and must NOT be touched. A run's regime is never guessed from
 * the shape of the numbers:
 *
 *   1. transcript here → ground truth: keep whichever of raw / delta matches the
 *      spend priced from the transcript over the run's window; neither → skip
 *   2. no transcript, CLI version known (column or local event log) →
 *      ≤ 2.1.279 per-run (confirm), ≥ 2.1.284 delta when the previous run of the
 *      session is a proven running total; anything else → skip
 *   3. nothing known → skip (listed)
 *
 * Idempotent: only rows with cost_basis NULL/'unverified' are decided; written
 * rows get cost_basis='per_run:backfill' and keep the raw SDK values in
 * sdk_total_*. Re-running is a no-op. `--revert` restores the raw values.
 *
 * Usage:
 *   bun run packages/server/scripts/fix-sdk-session-costs.ts [--workspace <name|all>] [--claude-dir <path>]
 *     (default)  dry-run: per-row report, writes nothing
 *     --apply    write the decisions
 *     --verify   audit: chain invariant + transcript agreement by CLI version
 *     --revert   restore raw values on rows this script wrote
 *
 * Two-machine setup: transcripts and event logs are local, so run it on both.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pg from 'pg';
import {
  classifySession, carriesSessionTotals, costsAgree, perRunUsage,
  type HistoricalRun, type SdkUsageTotals, type CostBasis,
} from '../src/application/utils/sdk-run-usage.js';
import { readPricedMessages, costInWindow, type PricedMessage } from './lib/transcript-cost.js';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d; };
const MODE = has('--revert') ? 'revert' : has('--verify') ? 'verify' : has('--apply') ? 'apply' : 'dry-run';
const WS_ARG = (val('--workspace', 'all') ?? 'all').toLowerCase();
const CLAUDE_DIR = val('--claude-dir', process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'))!;
const EVENTS_DIR = join(homedir(), '.fleex', 'projects', 'agent-events');
/** Transcript lines are written a little after the result; widen the run window. */
const WINDOW_SLACK_MS = 5_000;

// ── DB ──────────────────────────────────────────────────────────────────────
interface Db {
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
  close(): Promise<void>;
}
const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

async function openDb(env: Record<string, string>): Promise<Db | null> {
  if (env['FLEEX_STORAGE_DRIVER'] === 'supabase' && env['FLEEX_SUPABASE_DB_URL']) {
    const pool = new pg.Pool({ connectionString: env['FLEEX_SUPABASE_DB_URL'] });
    return {
      all: async (sql, p = []) => (await pool.query(toPg(sql), p)).rows,
      run: async (sql, p = []) => (await pool.query(toPg(sql), p)).rowCount ?? 0,
      close: () => pool.end(),
    };
  }
  if (env['FLEEX_STORAGE_DRIVER'] === 'sqlite' && env['FLEEX_SQLITE_PATH'] && existsSync(env['FLEEX_SQLITE_PATH'])) {
    const { Database } = await import('bun:sqlite');
    const db = new Database(env['FLEEX_SQLITE_PATH']);
    return {
      all: async (sql, p = []) => db.query(sql).all(...(p as never[])) as Record<string, unknown>[],
      run: async (sql, p = []) => db.query(sql).run(...(p as never[])).changes,
      close: async () => db.close(),
    };
  }
  return null;
}

// ── Local evidence ──────────────────────────────────────────────────────────
function transcriptIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  const root = join(CLAUDE_DIR, 'projects');
  if (!existsSync(root)) return idx;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(root, d.name))) if (f.endsWith('.jsonl')) idx.set(f.slice(0, -6), join(root, d.name, f));
  }
  return idx;
}

function cliVersionFromEvents(executionId: string): string | null {
  const f = join(EVENTS_DIR, `${executionId}.jsonl`);
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf-8').match(/"claude_code_version":"([^"]+)"/)?.[1] ?? null;
}

const transcriptCache = new Map<string, PricedMessage[] | null>();
function transcriptCost(transcripts: Map<string, string>, sid: string, row: Row): number | null {
  if (!row.completedAt) return null;
  if (!transcriptCache.has(sid)) {
    const p = transcripts.get(sid);
    if (!p) transcriptCache.set(sid, null);
    else {
      // Task subagents write their own transcripts next to the session's: their
      // spend is in the SDK total, so it belongs in the ground truth too.
      const subDir = join(p.slice(0, -'.jsonl'.length), 'subagents');
      const subs = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(subDir, f)) : [];
      transcriptCache.set(sid, [p, ...subs].flatMap(readPricedMessages));
    }
  }
  const msgs = transcriptCache.get(sid);
  if (!msgs) return null;
  return costInWindow(msgs, Date.parse(row.startedAt), Date.parse(row.completedAt) + WINDOW_SLACK_MS);
}

// ── Rows ────────────────────────────────────────────────────────────────────
interface Row {
  executionId: string; sid: string; startedAt: string; completedAt: string | null; model: string | null;
  cost: SdkUsageTotals; sdkTotal: SdkUsageTotals | null; cliVersion: string | null; basis: CostBasis | null;
}
const num = (v: unknown) => (v == null ? undefined : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

const NEW_COLS = ['sdk_total_cost_usd', 'sdk_total_input_tokens', 'sdk_total_output_tokens',
  'sdk_total_cache_read_tokens', 'sdk_total_cache_creation_tokens', 'cli_version', 'cost_basis'];

/** Migration 035 applied? (A dry-run must work before it is, so the report can be reviewed first.) */
async function hasNewColumns(db: Db): Promise<boolean> {
  try { await db.all('SELECT cost_basis FROM agent_event_executions LIMIT 1'); return true; } catch { return false; }
}

async function loadSessions(db: Db, withNewCols: boolean): Promise<Map<string, Row[]>> {
  const extra = withNewCols ? NEW_COLS.join(', ') : NEW_COLS.map((c) => `NULL AS ${c}`).join(', ');
  const rows = await db.all(
    `SELECT execution_id, sdk_session_id, started_at, completed_at, model,
            cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, ${extra}
     FROM agent_event_executions
     WHERE sdk_session_id IS NOT NULL AND cost_usd IS NOT NULL AND (source IS NULL OR source <> 'cli')
     ORDER BY sdk_session_id, started_at`,
  );
  const sessions = new Map<string, Row[]>();
  for (const r of rows) {
    const sid = String(r['sdk_session_id']);
    const hasTotal = r['sdk_total_cost_usd'] != null;
    const row: Row = {
      executionId: String(r['execution_id']), sid, startedAt: iso(r['started_at']),
      completedAt: r['completed_at'] == null ? null : iso(r['completed_at']), model: (r['model'] as string) ?? null,
      cost: { costUsd: num(r['cost_usd']), inputTokens: num(r['input_tokens']), outputTokens: num(r['output_tokens']),
        cacheReadTokens: num(r['cache_read_tokens']), cacheCreationTokens: num(r['cache_creation_tokens']) },
      sdkTotal: hasTotal ? { costUsd: num(r['sdk_total_cost_usd']), inputTokens: num(r['sdk_total_input_tokens']),
        outputTokens: num(r['sdk_total_output_tokens']), cacheReadTokens: num(r['sdk_total_cache_read_tokens']),
        cacheCreationTokens: num(r['sdk_total_cache_creation_tokens']) } : null,
      cliVersion: (r['cli_version'] as string) ?? null,
      basis: (r['cost_basis'] as CostBasis) ?? null,
    };
    (sessions.get(sid) ?? sessions.set(sid, []).get(sid)!).push(row);
  }
  return sessions;
}

const fmt = (n: number | undefined) => (n == null ? '—' : `$${n.toFixed(3)}`);
const lit = (n: number | undefined) => (n == null || !Number.isFinite(n) ? null : n);

// ── Modes ───────────────────────────────────────────────────────────────────
async function fix(db: Db, sessions: Map<string, Row[]>, transcripts: Map<string, string>, apply: boolean) {
  const tally: Record<string, number> = {};
  let before = 0, after = 0, written = 0;
  const lines: string[] = [];
  for (const [sid, rows] of sessions) {
    const hist: HistoricalRun[] = rows.map((r) => {
      const pending = r.basis == null || r.basis === 'unverified';
      return {
        executionId: r.executionId,
        raw: r.sdkTotal ?? r.cost,
        basis: r.basis,
        cliVersion: r.cliVersion ?? cliVersionFromEvents(r.executionId),
        transcriptCostUsd: pending ? transcriptCost(transcripts, sid, r) : null,
      };
    });
    const decisions = classifySession(hist);
    for (const d of decisions) {
      const r = rows.find((x) => x.executionId === d.executionId)!;
      const h = hist.find((x) => x.executionId === d.executionId)!;
      const key = d.action === 'skip' ? `skip: ${d.reason}` : `${d.action} (${d.evidence})`;
      tally[key] = (tally[key] ?? 0) + 1;
      const was = r.cost.costUsd ?? 0;
      before += was;
      const next = d.action === 'rewrite' ? d.run : d.action === 'confirm' ? h.raw : r.cost;
      after += next.costUsd ?? 0;
      if (d.action !== 'confirm') {
        lines.push(`  ${r.executionId.slice(0, 8)} ${sid.slice(0, 8)} ${r.startedAt.slice(0, 16)} ${(h.cliVersion ?? '?').padEnd(8)} ` +
          `${(r.model ?? '?').replace('claude-', '').padEnd(10)} ${fmt(was).padStart(9)} → ${fmt(next.costUsd).padStart(9)}  tx ${fmt(h.transcriptCostUsd ?? undefined).padStart(9)}  ${key}`);
      }
      if (!apply || d.action === 'skip') continue;
      written += await db.run(
        `UPDATE agent_event_executions SET
           cost_usd = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?,
           sdk_total_cost_usd = ?, sdk_total_input_tokens = ?, sdk_total_output_tokens = ?,
           sdk_total_cache_read_tokens = ?, sdk_total_cache_creation_tokens = ?,
           cli_version = COALESCE(cli_version, ?), cost_basis = 'per_run:backfill'
         WHERE execution_id = ? AND (cost_basis IS NULL OR cost_basis = 'unverified')`,
        [lit(next.costUsd), lit(next.inputTokens), lit(next.outputTokens), lit(next.cacheReadTokens), lit(next.cacheCreationTokens),
          lit(h.raw.costUsd), lit(h.raw.inputTokens), lit(h.raw.outputTokens), lit(h.raw.cacheReadTokens), lit(h.raw.cacheCreationTokens),
          h.cliVersion, r.executionId],
      );
    }
  }
  for (const l of lines) console.log(l);
  console.log('\n  decisions:');
  for (const [k, n] of Object.entries(tally).sort()) console.log(`    ${String(n).padStart(5)}  ${k}`);
  console.log(`  pending rows cost: ${fmt(before)} → ${fmt(after)}  |  ${apply ? `${written} row(s) written` : 'dry-run (0 written)'}`);
}

async function verify(sessions: Map<string, Row[]>, transcripts: Map<string, string>) {
  let chainChecked = 0; const chainBad: string[] = [];
  const byVersion: Record<string, { n: number; ok: number }> = {};
  const modelSwitch = { n: 0, ok: 0 };
  let unresolved = 0, unresolvedCost = 0;
  for (const [sid, rows] of sessions) {
    let prev: Row | null = null;
    for (const r of rows) {
      if (r.basis == null || r.basis === 'unverified') { unresolved++; unresolvedCost += r.cost.costUsd ?? 0; }
      // Chain invariant: on a carrying CLI, stored cost = raw − previous raw (or raw after a restart).
      if (prev && r.basis?.startsWith('per_run') && prev.basis?.startsWith('per_run') && r.sdkTotal && prev.sdkTotal
        && carriesSessionTotals(r.cliVersion) && carriesSessionTotals(prev.cliVersion)) {
        chainChecked++;
        const expected = perRunUsage(r.sdkTotal, prev.sdkTotal).costUsd ?? 0;
        if (Math.abs(expected - (r.cost.costUsd ?? 0)) > 1e-4) chainBad.push(`${r.executionId.slice(0, 8)} ${sid.slice(0, 8)} stored ${fmt(r.cost.costUsd)} expected ${fmt(expected)}`);
      }
      // Ground truth: stored cost vs transcript, by CLI version.
      const tx = prev ? transcriptCost(transcripts, sid, r) : null; // resumed runs only
      if (tx != null) {
        const v = r.cliVersion ?? cliVersionFromEvents(r.executionId) ?? '?';
        const ok = costsAgree(tx, r.cost.costUsd ?? 0);
        (byVersion[v] ??= { n: 0, ok: 0 }).n++; if (ok) byVersion[v].ok++;
        if (prev?.model && r.model && prev.model !== r.model) { modelSwitch.n++; if (ok) modelSwitch.ok++; }
      }
      prev = r;
    }
  }
  console.log(`  chain invariant: ${chainChecked - chainBad.length}/${chainChecked} ok`);
  for (const l of chainBad) console.log(`    ✗ ${l}`);
  console.log('  stored cost vs transcript (resumed runs with a transcript here):');
  for (const [v, s] of Object.entries(byVersion).sort()) console.log(`    CLI ${v.padEnd(8)} ${s.ok}/${s.n} agree`);
  console.log(`    model switch in session: ${modelSwitch.ok}/${modelSwitch.n} agree`);
  console.log(`  rows still unverified/legacy: ${unresolved} (${fmt(unresolvedCost)})`);
}

async function revert(db: Db) {
  const n = await db.run(
    `UPDATE agent_event_executions SET
       cost_usd = sdk_total_cost_usd, input_tokens = sdk_total_input_tokens, output_tokens = sdk_total_output_tokens,
       cache_read_tokens = sdk_total_cache_read_tokens, cache_creation_tokens = sdk_total_cache_creation_tokens,
       cost_basis = 'unverified'
     WHERE cost_basis = 'per_run:backfill' AND sdk_total_cost_usd IS NOT NULL`,
  );
  console.log(`  ${n} row(s) restored to their raw SDK values (cost_basis='unverified').`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const all = (JSON.parse(readFileSync(join(homedir(), '.fleex', 'workspaces.json'), 'utf-8')).workspaces ?? []) as { name: string; env: Record<string, string> }[];
  const selected = WS_ARG === 'all' ? all.filter((w) => w.env['FLEEX_STORAGE_DRIVER'] === 'supabase') : all.filter((w) => w.name.toLowerCase() === WS_ARG);
  if (selected.length === 0) { console.error(`No workspace matched "${WS_ARG}".`); process.exit(1); }
  console.log(`fix-sdk-session-costs — ${MODE.toUpperCase()}${MODE === 'dry-run' ? ' (no writes; --apply to write)' : ''}`);
  const transcripts = MODE === 'revert' ? new Map<string, string>() : transcriptIndex();
  if (MODE !== 'revert') console.log(`Indexed ${transcripts.size} local transcript(s) in ${CLAUDE_DIR}/projects`);

  for (const ws of selected) {
    console.log(`\n━━ workspace: ${ws.name} (${ws.env['FLEEX_STORAGE_DRIVER']}) ━━`);
    const db = await openDb(ws.env);
    if (!db) { console.error('  ⚠ cannot open database — skipped'); continue; }
    try {
      const migrated = await hasNewColumns(db);
      if (!migrated && MODE !== 'dry-run' && MODE !== 'verify') {
        console.error('  ⚠ migration 035 not applied on this database — only dry-run/verify are possible');
        continue;
      }
      if (!migrated) console.log('  (migration 035 not applied yet: reading legacy columns only)');
      if (MODE === 'revert') await revert(db);
      else if (MODE === 'verify') await verify(await loadSessions(db, migrated), transcripts);
      else await fix(db, await loadSessions(db, migrated), transcripts, MODE === 'apply');
    } finally {
      await db.close();
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
