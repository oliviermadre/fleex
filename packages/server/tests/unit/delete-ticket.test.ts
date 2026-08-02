import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// The use case reaches for the real filesystem to detect and drop the workspace.
const fsMocks = vi.hoisted(() => ({ existsSync: vi.fn(), rmSync: vi.fn() }));
vi.mock('node:fs', () => fsMocks);

const { DeleteTicketUseCase } = await import('../../src/application/use-cases/delete-ticket.js');
const { TicketEntity } = await import('../../src/domain/entities/ticket.entity.js');
const { buildTicketWorkspaceId } = await import('../../src/domain/services/branch-utils.js');

import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { FileStorePort } from '../../src/application/ports/file-store.port.js';
import type { FileMetaStorePort } from '../../src/application/ports/file-meta-store.port.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';
import type { GitPort } from '../../src/application/ports/git.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { KillSessionUseCase } from '../../src/application/use-cases/kill-session.js';
import type { EventBus } from '../../src/application/event-bus.js';

describe('DeleteTicketUseCase', () => {
  let ticket: InstanceType<typeof TicketEntity>;
  let ticketStore: TicketStorePort;
  let commentStore: CommentStorePort;
  let fileStore: FileStorePort;
  let fileMetaStore: FileMetaStorePort;
  let sessionStore: SessionStorePort;
  let killSession: KillSessionUseCase;
  let git: GitPort;
  let resolver: RepoPathResolver;
  let logger: LoggerPort;
  let emitted: AnyDomainEvent[];
  let eventBus: EventBus;
  let useCase: InstanceType<typeof DeleteTicketUseCase>;

  const actor = { source: 'web' as const, actorType: 'user' as const };
  const WORKSPACE = '/base/workspaces/ws-1';
  const WT_PATH = '/base/workspaces/ws-1/repo';
  const BARE = '/base/bare/org/repo';

  function build() {
    useCase = new DeleteTicketUseCase(
      ticketStore, commentStore, fileStore, fileMetaStore, sessionStore,
      killSession, git, resolver, eventBus, logger,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();

    ticket = TicketEntity.create({
      id: 'T1', boardId: randomUUID(), displayId: 1, title: 'Ship it',
      description: 'see /api/files/11111111-1111-1111-1111-111111111111',
    });
    ticket.addLink('repository', 'org/repo', 'org/repo', null, randomUUID());

    ticketStore = {
      getTicketById: vi.fn().mockResolvedValue(ticket),
      removeTicket: vi.fn().mockResolvedValue(undefined),
    } as unknown as TicketStorePort;
    commentStore = { getByTicket: vi.fn().mockResolvedValue([]) } as unknown as CommentStorePort;
    fileStore = { remove: vi.fn().mockResolvedValue(undefined) } as unknown as FileStorePort;
    fileMetaStore = { remove: vi.fn().mockResolvedValue(undefined) } as unknown as FileMetaStorePort;
    sessionStore = { getAll: vi.fn().mockResolvedValue([]) } as unknown as SessionStorePort;
    killSession = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as KillSessionUseCase;
    git = {
      listWorktrees: vi.fn().mockResolvedValue([{ path: WT_PATH, branch: 'feat/x' }]),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitPort;
    resolver = {
      workspacePath: vi.fn().mockReturnValue(WORKSPACE),
      workspaceRepoPath: vi.fn().mockReturnValue(WT_PATH),
      barePath: vi.fn().mockReturnValue(BARE),
    } as unknown as RepoPathResolver;
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    emitted = [];
    eventBus = { emit: vi.fn((...e: AnyDomainEvent[]) => { emitted.push(...e); }) } as unknown as EventBus;

    fsMocks.existsSync.mockReturnValue(true);
    build();
  });

  it('deletes the ticket and emits ticket.deleted with the origin', async () => {
    await useCase.execute({ ticketId: 'T1', actor });

    expect(ticketStore.removeTicket).toHaveBeenCalledWith('T1');
    expect(emitted.find((e) => e.type === 'ticket.deleted')).toMatchObject({
      type: 'ticket.deleted', ticketId: 'T1', source: 'web',
    });
  });

  it('still deletes an already-missing ticket instead of throwing', async () => {
    vi.mocked(ticketStore.getTicketById).mockResolvedValue(null);

    await expect(useCase.execute({ ticketId: 'ghost', actor })).resolves.toBeUndefined();
    expect(ticketStore.removeTicket).toHaveBeenCalledWith('ghost');
    expect(emitted.some((e) => e.type === 'ticket.deleted')).toBe(true);
  });

  it('garbage-collects files referenced by the description and the comments', async () => {
    vi.mocked(commentStore.getByTicket).mockResolvedValue([
      { body: 'and /api/files/22222222-2222-2222-2222-222222222222' },
    ] as never);

    await useCase.execute({ ticketId: 'T1', actor });

    expect(fileStore.remove).toHaveBeenCalledTimes(2);
    expect(fileMetaStore.remove).toHaveBeenCalledTimes(2);
    expect(fileStore.remove).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(fileStore.remove).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
  });

  it('kills only the sessions living inside the ticket workspace', async () => {
    vi.mocked(sessionStore.getAll).mockResolvedValue([
      { id: 's-inside', cwd: `${WORKSPACE}/repo` },
      { id: 's-elsewhere', cwd: '/somewhere/else' },
    ] as never);

    await useCase.execute({ ticketId: 'T1', actor });

    expect(killSession.execute).toHaveBeenCalledTimes(1);
    expect(killSession.execute).toHaveBeenCalledWith('s-inside');
  });

  it('removes the git worktree of each linked repo and reports its branch', async () => {
    await useCase.execute({ ticketId: 'T1', actor });

    expect(git.removeWorktree).toHaveBeenCalledWith(BARE, WT_PATH);
    expect(emitted.find((e) => e.type === 'worktree.deleted')).toMatchObject({
      type: 'worktree.deleted', repoPath: BARE, worktreePath: WT_PATH, branch: 'feat/x',
    });
  });

  it('drops the workspace folder from disk', async () => {
    await useCase.execute({ ticketId: 'T1', actor });

    expect(resolver.workspacePath).toHaveBeenCalledWith(buildTicketWorkspaceId(ticket.title, ticket.id));
    expect(fsMocks.rmSync).toHaveBeenCalledWith(WORKSPACE, { recursive: true, force: true });
  });

  it('deletes the ticket even when the worktree cannot be reclaimed', async () => {
    // Cleanup is best-effort: an unreclaimable resource must never strand the
    // ticket itself in the board.
    vi.mocked(git.removeWorktree).mockRejectedValue(new Error('worktree is locked'));

    await useCase.execute({ ticketId: 'T1', actor });

    expect(logger.warn).toHaveBeenCalled();
    expect(ticketStore.removeTicket).toHaveBeenCalledWith('T1');
    expect(emitted.some((e) => e.type === 'ticket.deleted')).toBe(true);
    expect(emitted.some((e) => e.type === 'worktree.deleted')).toBe(false);
  });

  it('deletes the ticket even when file cleanup fails', async () => {
    vi.mocked(fileStore.remove).mockRejectedValue(new Error('storage down'));

    await useCase.execute({ ticketId: 'T1', actor });

    expect(ticketStore.removeTicket).toHaveBeenCalledWith('T1');
  });
});
