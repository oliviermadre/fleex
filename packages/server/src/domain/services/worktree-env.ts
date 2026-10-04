/**
 * The `FLEEX_*` environment given to hooks and worktree actions (PRD §7), so a
 * script can find its worktree, branch and ticket without template syntax.
 * The `{{…}}` substitutions of the inline hook keep working alongside.
 */

export interface FleexEnvContext {
  /** `org/name`. */
  repo?: string;
  /** The repository's main checkout (its bare clone for managed repos). */
  repoPath?: string;
  worktreePath: string;
  /** The ticket workspace holding the worktree. */
  workspacePath?: string;
  branch?: string;
  ticketId?: string;
  port?: number;
  url?: string;
  /** Size of the reserved port range (port reservation on). */
  portCount?: number;
}

export function buildFleexEnv(ctx: FleexEnvContext): Record<string, string> {
  const env: Record<string, string> = { FLEEX_WORKTREE_PATH: ctx.worktreePath };
  if (ctx.repo) env['FLEEX_REPO'] = ctx.repo;
  if (ctx.repoPath) env['FLEEX_REPO_PATH'] = ctx.repoPath;
  if (ctx.workspacePath) env['FLEEX_WORKSPACE_PATH'] = ctx.workspacePath;
  if (ctx.branch) env['FLEEX_BRANCH'] = ctx.branch;
  if (ctx.ticketId) env['FLEEX_TICKET_ID'] = ctx.ticketId;
  if (ctx.port) env['FLEEX_PORT'] = String(ctx.port);
  if (ctx.url) env['FLEEX_URL'] = ctx.url;
  if (ctx.port && ctx.portCount) env['FLEEX_PORT_COUNT'] = String(ctx.portCount);
  return env;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Prefix a shell command with `export` statements. The gateway's exec has no
 * env option, and a prefix works the same in background (`zsh -l -c`) and
 * terminal (`zsh -l -i -c`) runs. Invalid names are dropped, never interpolated.
 */
export function withEnv(command: string, env: Record<string, string>): string {
  const pairs = Object.entries(env).filter(([k]) => ENV_NAME.test(k));
  if (pairs.length === 0) return command;
  return `export ${pairs.map(([k, v]) => `${k}=${quote(v)}`).join(' ')}; ${command}`;
}

/** argv for `env K=V … <argv>`, for execFile-style calls (file hooks, bash -c). */
export function envArgv(env: Record<string, string>, argv: string[]): string[] {
  return [...Object.entries(env).filter(([k]) => ENV_NAME.test(k)).map(([k, v]) => `${k}=${v}`), ...argv];
}

/** The `{{org}}` `{{repo}}` `{{branch}}` `{{worktree_path}}` substitutions of inline hooks (kept for old scripts). */
export function interpolateHook(script: string, vars: { org: string; repo: string; branch: string; worktreePath: string }): string {
  return script
    .replace(/\{\{org\}\}/g, vars.org)
    .replace(/\{\{repo\}\}/g, vars.repo)
    .replace(/\{\{branch\}\}/g, vars.branch)
    .replace(/\{\{worktree_path\}\}/g, vars.worktreePath);
}
