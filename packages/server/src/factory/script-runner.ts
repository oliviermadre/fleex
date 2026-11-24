/**
 * What a script station does: it runs shell commands for a ticket, in the worktrees the ticket has and in its
 * workspace, and concludes from how they end. Nothing here knows what the commands are for: testing is one use,
 * opening a browser or warning someone is another.
 *
 * A station has an optional default action, the name of a command each repository may define for itself (the named
 * actions of the configuration, filled in repository by repository), and lines of its own. A line is for one
 * repository, for any repository, or for the ticket's workspace, and is either a named action or a command typed in.
 * For each repository of the ticket: its own line, else the "any repository" line, else the default action, else
 * nothing to run.
 *
 * Deciding what to run is a pure function (`planScript`); running it goes through what the module gives.
 */
import type { StationRunResult } from './station-runner.js';

export const ANY_REPO = '*';
export const WORKSPACE = 'workspace';
export interface ScriptLine { target: string; kind: 'action' | 'command'; value: string }
export interface ScriptSpec {
  /** The named action run in every repository that has no line of its own; none when empty. */
  action?: string;
  lines: ScriptLine[];
  /** A repository there is nothing to run for: it is skipped, it counts as a failure, or the ticket leaves by "unconfigured". */
  missing: 'ignore' | 'ko' | 'own';
  /** After a command fails: run the others anyway, or stop there. */
  onFail: 'all' | 'stop';
  timeoutSec?: number;
}
export const SCRIPT_OUTCOMES = { ok: 'ok', ko: 'ko', unconfigured: 'unconfigured' } as const;
export const DEFAULT_TIMEOUT_SEC = 300, MAX_TIMEOUT_SEC = 1800;

/** Keep of a script what can be run: known targets and kinds, something to run on each line, one line per target. */
export function normaliseScript(raw: unknown): ScriptSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScriptSpec>;
  const lines: ScriptLine[] = [], seen = new Set<string>();
  for (const l of Array.isArray(r.lines) ? r.lines : []) {
    const target = typeof l?.target === 'string' ? l.target.trim() : '', value = typeof l?.value === 'string' ? l.value.trim() : '';
    const kind = l?.kind === 'action' && target !== WORKSPACE ? 'action' : 'command';
    if (!target || !value || value.length > 4000 || seen.has(target)) continue;
    seen.add(target); lines.push({ target, kind, value });
  }
  const timeout = Number(r.timeoutSec);
  return {
    ...(typeof r.action === 'string' && r.action.trim() ? { action: r.action.trim().slice(0, 60) } : {}),
    lines: lines.slice(0, 40),
    missing: r.missing === 'ko' || r.missing === 'own' ? r.missing : 'ignore',
    onFail: r.onFail === 'stop' ? 'stop' : 'all',
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutSec: Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.floor(timeout))) } : {}),
  };
}
/** The ways out of a script station: "unconfigured" only when it is asked for. */
export const scriptOutcomes = (s: ScriptSpec): string[] => (s.missing === 'own' ? ['ok', 'ko', 'unconfigured'] : ['ok', 'ko']);

/** What a ticket gives a script to work with. `path` is null for a repository whose worktree is not on disk. */
export interface ScriptContext {
  workspace: string;
  worktrees: { repo: string; path: string | null }[];
  /** The named actions a repository defines: name → command. */
  actions(repo: string): Record<string, string>;
  env: Record<string, string>;
}
/** One thing to run, or the reason there is nothing to run. `where` is what the report calls it. */
export interface ScriptStep { where: string; repo: string | null; cwd: string | null; command: string | null; from: string }

const sameRepo = (target: string, repo: string): boolean => target === repo || target === repo.split('/').pop();
export function planScript(spec: ScriptSpec, ctx: ScriptContext): ScriptStep[] {
  const steps: ScriptStep[] = [];
  const own = spec.lines.find((l) => l.target === WORKSPACE);
  if (own) steps.push({ where: 'workspace', repo: null, cwd: ctx.workspace, command: own.value, from: 'station · workspace' });
  for (const wt of ctx.worktrees) {
    const line = spec.lines.find((l) => l.target !== ANY_REPO && l.target !== WORKSPACE && sameRepo(l.target, wt.repo)) ?? spec.lines.find((l) => l.target === ANY_REPO);
    const defined = ctx.actions(wt.repo);
    let command: string | null = null, from = 'nothing to run';
    if (line) { command = line.kind === 'action' ? defined[line.value]?.trim() || null : line.value; from = `station${line.target === ANY_REPO ? ' · any repository' : ''} · ${line.kind === 'action' ? `action "${line.value}"` : 'command'}`; }
    else if (spec.action) { command = defined[spec.action]?.trim() || null; from = `repository · action "${spec.action}"`; }
    steps.push({ where: wt.repo, repo: wt.repo, cwd: wt.path, command, from });
  }
  return steps;
}

export interface ShellResult { stdout: string; stderr: string; exitCode: number; timedOut?: boolean }
export type Shell = (command: string, options: { cwd: string; timeoutMs: number }) => Promise<ShellResult>;

const quote = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;
/** The command with what it may want to know about the ticket in its environment. */
export const withEnv = (command: string, env: Record<string, string>): string => `${Object.entries(env).map(([k, v]) => `export ${k}=${quote(v)}`).join('; ')}\n${command}`;
const tail = (s: string, n = 700): string => { const t = s.trim(); return t.length > n ? `[cut] ${t.slice(-n)}` : t; };

/**
 * Run the steps one after the other and conclude: one failure is "ko"; otherwise what the station says of a repository
 * it has nothing to run for. When nothing ran at all (an item and only lines for repositories, a ticket with no
 * repository), it is "ko" (or the station's own way out): leaving by "ok" would say it was done.
 */
export async function runScript(spec: ScriptSpec, ctx: ScriptContext, shell: Shell): Promise<StationRunResult> {
  const steps = planScript(spec, ctx), timeoutMs = (spec.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000, report: string[] = [];
  let failed = false, missing = steps.length === 0, ran = 0;
  for (const s of steps) {
    if (failed && spec.onFail === 'stop') { report.push(`– ${s.where}: not run, a command before it failed`); continue; }
    if (!s.command) { missing = true; report.push(`? ${s.where}: ${s.from === 'nothing to run' ? 'nothing to run for this repository' : `${s.from} is not defined for this repository`}`); continue; }
    if (!s.cwd) { failed = true; report.push(`✗ ${s.where}: its worktree is not on disk`); continue; }
    ran++;
    try {
      const r = await shell(withEnv(s.command, { ...ctx.env, ...(s.repo ? { FLEEX_REPO: s.repo } : {}) }), { cwd: s.cwd, timeoutMs });
      if (r.exitCode === 0 && !r.timedOut) report.push(`✓ ${s.where} $ ${s.command}`, ...(r.stdout.trim() ? [tail(r.stdout)] : []));
      else { failed = true; report.push(`✗ ${s.where} $ ${s.command} · ${r.timedOut ? `timed out after ${timeoutMs / 1000} s` : `exit ${r.exitCode}`}`, tail(r.stderr || r.stdout)); }
    } catch (err) { failed = true; report.push(`✗ ${s.where} $ ${s.command} · could not be run`, tail(err instanceof Error ? err.message : String(err))); }
  }
  if (steps.length === 0) report.push('? nothing to run: no repository to run in, and the station has no line for the workspace');
  else if (ran === 0 && !failed) report.push(ctx.worktrees.length ? '? nothing ran: no line has a command for these repositories' : '? nothing ran: there is no repository here (an item has none), and the station has no line for the workspace');
  const said = report.filter(Boolean).join('\n');
  const outcome = failed || (missing && spec.missing === 'ko') ? 'ko' : missing && spec.missing === 'own' ? 'unconfigured' : ran === 0 ? 'ko' : 'ok';
  /* what it ran and what that said: an item keeps it as the station's answer (a ticket's run keeps only its error) */
  return { status: 'completed', outcome, executionId: null, error: outcome === 'ok' ? null : said.slice(0, 4000), reply: `\`\`\`\n${said.slice(0, 8000)}\n\`\`\`` };
}
