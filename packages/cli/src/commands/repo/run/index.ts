import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { WORKTREE_LOGS_SLOT, isWorktreeVerb, type ActionRun, type WorktreeRunResponse } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { info, ok as success } from '../../../core/colors.ts';
import { apiBase, apiGet, apiPost } from '../../../core/api.ts';
import { printJson } from '../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../_worktree.ts';

interface Options { worktree?: string; json?: boolean }

/** Stop may wait on a stop command (up to 2 min server-side). */
const RUN_TIMEOUT_MS = 150_000;

const def: CommandDef = {
  workspaceAware: true,
  name: 'run',
  description: "Run a worktree command by id (npm:test, make:up, launch:web…) or a server verb (start, stop, restart, status, open, logs)",
  extraHelp: `\n${chalk.bold.yellow('Same as the worktree button of the Work view:')} the command runs on the Fleex
server (its terminal and logs appear in the UI). ${chalk.green('fleex repo actions')} lists the ids.
`,
  setup(cmd) {
    cmd.argument('<id|verb>', 'Command id, or start | stop | restart | status | open | logs');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (target: string, opts: Options) => {
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    const body = isWorktreeVerb(target) ? { path: view.path, verb: target } : { path: view.path, id: target };
    const res = await apiPost<WorktreeRunResponse>(`${apiBase()}/api/worktree-actions/run`, body, RUN_TIMEOUT_MS);
    if (opts.json) {
      printJson(res);
      return;
    }
    const s = res.server;
    const state = `${s.state}${s.port ? ` :${s.port}` : ''}${s.exitCode !== undefined ? ` (exit ${s.exitCode})` : ''}`;
    if (target === 'open') {
      // The UI opens it in the ticket's browser; a terminal prints it.
      process.stdout.write(`${res.url}\n`);
    } else if (target === 'logs') {
      await showLogs(res);
    } else if (res.alreadyRunning) {
      info(`Already running${res.runId ? ` (run ${res.runId})` : ''} — server ${state}`);
    } else if (res.runId) {
      success(`Started ${target}${res.run?.mode === 'terminal' ? ' in a terminal' : ''} (run ${res.runId}) — server ${state}`);
    } else {
      success(`${view.repo ?? view.path}: server ${state}`);
    }
    // Every service the probe reported (`{"endpoints":[…]}` on its stdout).
    if (target !== 'open' && s.state === 'running') {
      for (const e of s.endpoints ?? []) process.stdout.write(`  ${e.primary ? '★' : ' '} ${e.name.padEnd(12)} ${e.url}\n`);
    }
  },
};

/**
 * `logs` shows the logs for real: the server.logs command's live terminal
 * (attached when this is a TTY), else the start run's recorded output.
 */
async function showLogs(res: WorktreeRunResponse): Promise<void> {
  const s = res.server;
  if (res.run?.slot === WORKTREE_LOGS_SLOT && res.run.tmuxSession) {
    if (process.stdout.isTTY) {
      spawnSync('tmux', ['attach', '-t', res.run.tmuxSession], { stdio: 'inherit' });
    } else {
      info(`Logs command running in tmux — tmux attach -t ${res.run.tmuxSession}`);
    }
    return;
  }
  if (!res.runId) {
    info(s.tmuxSession ? `No run recorded — tmux attach -t ${s.tmuxSession}` : 'No logs: no start run yet, and no logs command (server.logs) configured.');
    return;
  }
  const run = await apiGet<ActionRun>(`${apiBase()}/api/action-runs/${res.runId}`);
  const out = [run.stdout, run.stderr].filter(Boolean).join('\n');
  process.stdout.write(out ? (out.endsWith('\n') ? out : `${out}\n`) : '');
  if (!out) info('The start run printed nothing.');
  if (s.tmuxSession && !run.finishedAt) info(`Live: tmux attach -t ${s.tmuxSession}  (or set server.logs, e.g. docker compose logs -f)`);
}

export default def;
