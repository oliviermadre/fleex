import { worktreeSourceId, type WorktreeServerSnapshot, type WorktreeSetupSnapshot } from '@fleex/shared';
import { ActionRunService, type RunExecFn, type TerminalRunPort } from '../../src/domain/services/action-run.service.js';
import { WorktreeActionsService, type WorktreeServerTerminals } from '../../src/application/services/worktree-actions.service.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { FakeConfigPort, FakeHostFs, FakeLoggerPort } from './fakes.js';

export const WS = '/base/workspaces/775c62-repo-actions';
export const FLEEX = `${WS}/fleex`;
export const SECOND = `${WS}/secondrepo`;

/** tmux as the service sees it: sessions that are alive, dead, and the ports they listen on. */
export class FakeTmux implements TerminalRunPort, WorktreeServerTerminals {
  sessions = new Map<string, { dead: boolean; status: number; ports: number[]; finish?: (code: number, cancelled: boolean) => void }>();
  started: { command: string; cwd: string; sessionName: string; maxMs?: number }[] = [];

  sessionNameFor(key: string): string {
    return `fxact_t_${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  async start(req: { runId: string; command: string; cwd: string; sessionName: string; maxMs?: number }) {
    this.started.push(req);
    let finish!: (code: number, cancelled: boolean) => void;
    const done = new Promise<{ exitCode: number; output: string; cancelled: boolean; timedOut: boolean }>((resolve) => {
      finish = (code, cancelled) => resolve({ exitCode: code, output: '', cancelled, timedOut: false });
    });
    this.sessions.set(req.sessionName, { dead: false, status: 0, ports: [], finish });
    return {
      done,
      cancel: async () => {
        this.sessions.delete(req.sessionName);
        finish(130, true);
      },
    };
  }

  /** The command in a session exits with `code` (pane kept, like remain-on-exit). */
  exit(sessionName: string, code: number): void {
    const s = this.sessions.get(sessionName)!;
    s.dead = true;
    s.status = code;
    s.finish?.(code, false);
  }

  async inspect(name: string) {
    const s = this.sessions.get(name);
    if (!s) return { alive: false, dead: false, ports: [] };
    return { alive: true, dead: s.dead, exitStatus: s.status, ports: s.dead ? [] : s.ports };
  }

  async close(name: string): Promise<void> {
    this.sessions.delete(name);
  }
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

export function setup(opts: { tmux?: FakeTmux; config?: FakeConfigPort; exec?: RunExecFn; overlay?: ConstructorParameters<typeof WorktreeActionsService>[0]['overlay']; advanceClockOnSleep?: boolean } = {}) {
  const tmux = opts.tmux ?? new FakeTmux();
  const config = opts.config ?? new FakeConfigPort();
  const hostFs = new FakeHostFs();
  const broadcasts: (WorktreeServerSnapshot | WorktreeSetupSnapshot)[] = [];
  const execCalls: { command: string; cwd: string; timeoutMs: number }[] = [];
  const shellCalls: string[] = [];
  const clock = { ms: Date.parse('2026-10-04T10:00:00Z') };
  let service!: WorktreeActionsService;
  const actionRuns = new ActionRunService({
    exec: async (command, options) => {
      execCalls.push({ command, ...options });
      return opts.exec ? opts.exec(command, options) : { stdout: '', stderr: '', exitCode: 0 };
    },
    terminal: tmux,
    defaultCwd: '/home',
    broadcast: () => {},
    onFinished: (run) => service.onRunFinished(run),
  });
  service = new WorktreeActionsService({
    hostFs,
    getRepoInfo: async (path) => {
      if (path === FLEEX) return { org: 'oliviermadre', name: 'fleex', branch: 'ticket/775c62-repo-actions' };
      if (path === SECOND) return { org: 'oliviermadre', name: 'secondrepo', branch: 'main' };
      throw new Error('no remote');
    },
    discoverWorktrees: async (root) => (root === WS ? [SECOND, FLEEX] : [root]),
    config,
    resolver: new RepoPathResolver('/base'),
    actionRuns,
    terminals: tmux,
    shell: async (command) => {
      shellCalls.push(command);
      return { stdout: '', stderr: '', exitCode: 1 };
    },
    broadcast: (_t, data) => broadcasts.push(data),
    logger: new FakeLoggerPort(),
    now: () => new Date(clock.ms),
    setTimer: () => 0,
    sleep: async (ms: number) => {
      if (opts.advanceClockOnSleep) clock.ms += ms;
      await flush();
    },
    ...(opts.overlay ? { overlay: opts.overlay } : {}),
  });

  hostFs.writeFile(`${WS}/.fleex.json`, JSON.stringify({ ticketId: 'T-775' }));
  hostFs.addDirEntries(FLEEX, [
    { name: 'package.json', isFile: true, isDirectory: false },
    { name: 'pnpm-lock.yaml', isFile: true, isDirectory: false },
    { name: '.claude', isFile: false, isDirectory: true },
  ]);
  hostFs.writeFile(`${FLEEX}/package.json`, JSON.stringify({ scripts: { dev: 'vite', test: 'vitest run', lint: 'tsc' } }));
  hostFs.writeFile(`${FLEEX}/.claude/launch.json`, JSON.stringify({ configurations: [{ name: 'web', runtimeExecutable: 'pnpm', runtimeArgs: ['dev'], port: 5173 }] }));
  hostFs.addDirEntries(SECOND, [
    { name: 'Makefile', isFile: true, isDirectory: false },
    { name: 'composer.json', isFile: true, isDirectory: false },
  ]);
  hostFs.writeFile(`${SECOND}/Makefile`, 'up:\n\tdocker compose up\n');
  hostFs.writeFile(`${SECOND}/composer.json`, JSON.stringify({ scripts: { serve: 'php -S 0:8080', 'post-install-cmd': 'x' } }));

  const startSession = (path: string) => tmux.sessionNameFor(`${worktreeSourceId(path)}::start`);
  return { service, tmux, hostFs, config, broadcasts, shellCalls, execCalls, actionRuns, startSession, clock };
}

