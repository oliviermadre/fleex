import chalk from 'chalk';
import {
  DEFAULT_CLEANUP_OLDER_THAN,
  parseCleanupOlderThan,
  parseCleanupStatuses,
  type WorktreeCleanupReport,
  type WorktreeCleanupRequest,
} from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { die, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiCall } from '../../../core/api.ts';
import { canPrompt, closePrompts, promptYesNo } from '../../../core/prompt.ts';
import { formatBytes, hasWork, renderApply, renderPlan } from './_render.ts';

interface Options {
  olderThan: string;
  status: string;
  ticket?: string;
  size: boolean;
  apply?: boolean;
  yes?: boolean;
  verbose?: boolean;
  json?: boolean;
}

/** Sizing ~200 GB with `du` and fetching every bare clone is slow: be patient. */
const CLEANUP_TIMEOUT_MS = 30 * 60_000;

export const EXIT_PARTIAL = 2;
export const EXIT_BUSY = 3;

/** Validate the options locally (exit 1 before any server work) and build the request. */
export function toRequest(opts: Pick<Options, 'olderThan' | 'status' | 'ticket' | 'size'>): WorktreeCleanupRequest {
  if (parseCleanupOlderThan(opts.olderThan) === null) {
    die(`--older-than: invalid duration "${opts.olderThan}" (expected e.g. 36h, 14d, 2w, or a number of days)`);
  }
  const statuses = parseCleanupStatuses(opts.status);
  if ('error' in statuses) die(statuses.error);
  return {
    olderThan: opts.olderThan,
    status: statuses.statuses.join(','),
    ...(opts.ticket ? { ticket: opts.ticket } : {}),
    size: opts.size,
  };
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<WorktreeCleanupReport> {
  try {
    return await apiCall<WorktreeCleanupReport>(method, `${apiBase()}${path}`, body, CLEANUP_TIMEOUT_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('HTTP 409')) {
      const text = 'A cleanup is already running on this server (409). Try again once it is done.';
      if (isJsonMode()) process.stdout.write(JSON.stringify({ ok: false, error: text }) + '\n');
      else process.stderr.write(`${chalk.yellow('[fleex]')} ${text}\n`);
      process.exit(EXIT_BUSY);
    }
    die(msg);
  }
}

function progress(msg: string): void {
  if (!isJsonMode()) process.stderr.write(chalk.dim(`${msg}\n`));
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'cleanup',
  description: 'Find the worktrees of closed tickets and remove the ones holding no unpushed work (dry-run by default)',
  setup(cmd) {
    cmd.option('--older-than <duration>', 'Only tickets closed for at least this long: 36h, 14d, 2w, or days', DEFAULT_CLEANUP_OLDER_THAN);
    cmd.option('--status <list>', 'Ticket statuses in scope, CSV (only done, cancelled)', 'done,cancelled');
    cmd.option('--ticket <id>', 'Restrict to one ticket (#123, 123 or UUID)');
    cmd.option('--no-size', 'Skip computing disk sizes (faster)');
    cmd.option('--apply', 'Remove the eligible worktrees (asks for confirmation)');
    cmd.option('-y, --yes', 'With --apply: skip the confirmation (required when stdin is not a TTY)');
    cmd.option('-v, --verbose', 'Also detail eligible worktrees and list tickets below the threshold');
  },
  extraHelp: `
${chalk.bold.yellow('What is kept')} ${chalk.dim('(any one of these keeps a worktree; the report gives every reason)')}:
  dirty, untracked_files ${chalk.dim('(overlay & gitignored files do not count)')}, unpushed_commits ${chalk.dim('(refs/pull/N/head of linked PRs counts as pushed)')},
  pr_open, pr_state_unknown, fetch_failed, tmux_session, process_running, process_check_failed,
  git_status_failed, not_a_worktree, unregistered_worktree

${chalk.bold.yellow('Exit codes')}: 0 ok (or confirmation declined) · 1 usage/server error · 2 apply partially failed · 3 a cleanup is already running

${chalk.bold.yellow('Examples')}:
  ${chalk.dim('$')} fleex worktree cleanup                          ${chalk.dim('# dry-run')}
  ${chalk.dim('$')} fleex worktree cleanup --json --no-size         ${chalk.dim('# machine-readable plan')}
  ${chalk.dim('$')} fleex worktree cleanup --apply                  ${chalk.dim('# remove, after a y/N prompt')}
  ${chalk.dim('$')} fleex worktree cleanup --apply --yes --json     ${chalk.dim('# unattended (routine)')}
`,
  action: async (opts: Options) => {
    const request = toRequest(opts);
    const json = isJsonMode();

    if (!opts.apply) {
      const plan = await fetchPlan(request);
      if (json) return printReport(plan);
      process.stdout.write(renderPlan(plan, { verbose: opts.verbose }));
      if (hasWork(plan)) process.stdout.write(chalk.green('→ Run again with --apply to execute.\n'));
      return;
    }

    // --yes skips the plan round-trip: the server recomputes the plan on apply anyway.
    if (!opts.yes) {
      if (!canPrompt()) die('Refusing to apply without --yes in non-interactive mode');
      const plan = await fetchPlan(request);
      if (!json) process.stdout.write(renderPlan(plan, { verbose: opts.verbose }));
      if (!hasWork(plan)) {
        if (json) printReport(plan);
        else process.stdout.write('Nothing to clean up.\n');
        return;
      }
      const confirmed = await promptYesNo(chalk.bold(confirmQuestion(plan)), false);
      closePrompts();
      if (!confirmed) {
        process.stderr.write(chalk.dim('Aborted. Nothing was changed.\n'));
        return;
      }
    }

    progress('Applying (the server re-checks every guard right before each removal)…');
    const report = await call('POST', '/api/worktree-cleanup/apply', request);
    if (json) printReport(report);
    else process.stdout.write(renderApply(report));
    if ((report.totals.failed ?? 0) > 0) process.exit(EXIT_PARTIAL);
  },
};

function fetchPlan(request: WorktreeCleanupRequest): Promise<WorktreeCleanupReport> {
  progress(`Scanning workspaces (fetching bare clones, checking guards${request.size ? ', sizing' : ''})…`);
  const query = new URLSearchParams(Object.entries(request).map(([k, v]): [string, string] => [k, String(v)]));
  return call('GET', `/api/worktree-cleanup/plan?${query}`);
}

function printReport(report: WorktreeCleanupReport): void {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

export function confirmQuestion(plan: WorktreeCleanupReport): string {
  const t = plan.totals;
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const size = t.reclaimableBytes !== null ? ` (${formatBytes(t.reclaimableBytes)})` : '';
  return `Remove ${n(t.worktreesEligible, 'worktree')}${size}, purge ${n(t.orphanLinks, 'orphan link')} and ${n(t.emptyWorkspaces, 'empty workspace')}?`;
}

export default def;
