import { describe, it, expect } from 'vitest';

import { DiscoverExistingSessionsUseCase } from '../../src/application/use-cases/discover-existing-sessions.js';
import { GetSessionGroupsUseCase } from '../../src/application/use-cases/get-session-groups.js';
import { SessionGroupingService } from '../../src/domain/services/session-grouping.js';
import { sessionIdFromTmuxName } from '../../src/domain/services/session-id.js';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';
import { FakeTmuxPort, FakeSessionStore, FakeLoggerPort } from '../helpers/fakes.js';

/**
 * Regression test for the bug where a sidebar terminal was reaped even though its
 * tmux parent was still alive.
 *
 * Chain: a sidebar encodes its parent's session id inside its tmux name. When the
 * parent session is evicted from the store (multi-instance race on a shared store)
 * and then re-discovered, `randomUUID()` gave it a NEW id, so the id encoded in the
 * sidebar name no longer matched any live session and `reapOrphanedSidebarSessions`
 * killed the sidebar. Deriving the id deterministically from the tmux name makes the
 * re-discovered parent reappear under the SAME id, so the sidebar survives.
 */
describe('GetSessionGroupsUseCase — sidebar reaping vs re-discovered parent', () => {
  it('does NOT reap a sidebar whose tmux parent is alive but was re-discovered', async () => {
    const naming = new SessionNamingService();
    const tmux = new FakeTmuxPort();
    const store = new FakeSessionStore();
    const logger = new FakeLoggerPort();

    // Parent claude session is alive in tmux. The id encoded in the sidebar name
    // is the parent's deterministic id (what create-session stamps at creation).
    const parentTmuxName = 'fleex_claude_org_repo_main_claude';
    const parentId = sessionIdFromTmuxName(parentTmuxName);

    const sidebarTmuxName = naming.buildSidebarTmuxName({
      ticketDisplayId: 244,
      parentSessionId: parentId,
      shortSuffix: 'abcde',
    });

    await tmux.createSession({ name: parentTmuxName, cwd: '/projects/org/repo' });
    await tmux.createSession({ name: sidebarTmuxName, cwd: '/projects/org/repo' });
    // Store starts EMPTY: both sessions were evicted and must be re-discovered.

    const discover = new DiscoverExistingSessionsUseCase(tmux, store, naming, logger);

    const useCase = new GetSessionGroupsUseCase(
      store,
      tmux,
      new SessionGroupingService(),
      logger,
      undefined, // enrichClaudeActivity
      discover, // discoverSessions
      undefined, // ticketStore
      undefined, // personaStore
      undefined, // agentEventStore
      undefined, // reconcileWorktree
      undefined, // hostFs
      undefined, // config
      naming, // namingService — enables the reaper
    );

    await useCase.execute();

    // The sidebar's parent tmux session is alive → the sidebar must survive.
    expect(await tmux.hasSession(sidebarTmuxName)).toBe(true);
    expect(store.getByTmuxName(sidebarTmuxName)).not.toBeNull();
    // And the reaper must not have logged a kill for it.
    expect(logger.logs.some((l) => l.msg === 'Reaped orphaned sidebar session')).toBe(false);
  });
});
