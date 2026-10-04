import chalk from 'chalk';
import { isWorktreeVerb, type WorktreeRunResponse } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { info, ok as success } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
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
      if (res.runId) info(`Server run ${res.runId} — its log: worktree menu › Logs, or GET /api/action-runs/${res.runId}`);
      if (s.tmuxSession) info(`Live terminal: tmux attach -t ${s.tmuxSession}`);
      if (!res.runId && !s.tmuxSession) info('No server run yet.');
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

export default def;
