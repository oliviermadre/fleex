import { describe, it, expect } from 'vitest';
import { sessionIdFromTmuxName } from '../../src/domain/services/session-id.js';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';

describe('sessionIdFromTmuxName', () => {
  it('is deterministic: same tmux name always yields the same id', () => {
    const name = 'fleex_claude_org_repo_main_claude';
    expect(sessionIdFromTmuxName(name)).toBe(sessionIdFromTmuxName(name));
  });

  it('yields different ids for different tmux names', () => {
    expect(sessionIdFromTmuxName('fleex_claude_a')).not.toBe(
      sessionIdFromTmuxName('fleex_claude_b'),
    );
  });

  it('returns a canonical RFC 4122 v5 UUID (lowercase, hyphenated)', () => {
    const id = sessionIdFromTmuxName('fleex_shell_org_repo_main_shell');
    // version nibble = 5, variant nibble ∈ {8,9,a,b}
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is recoverable from a sidebar tmux name via parseSidebarParentId', () => {
    // The derived id is embedded in a sidebar's tmux name at creation time and
    // must be parseable back out — otherwise the reaper cannot match a sidebar
    // to its (re-discovered) parent and would kill it while the parent is alive.
    const naming = new SessionNamingService();
    const parentId = sessionIdFromTmuxName('fleex_claude_org_repo_main_claude');
    const sidebarName = naming.buildSidebarTmuxName({
      ticketDisplayId: 244,
      parentSessionId: parentId,
      shortSuffix: 'abcde',
    });
    expect(naming.parseSidebarParentId(sidebarName)).toBe(parentId);
  });
});
