import { describe, it, expect } from 'vitest';
import { parseUrl, storeToUrl, historyActionForNav } from './RouterSync';

describe('parseUrl', () => {
  it('redirects / to /tickets (Kanban is the default view)', () => {
    const result = parseUrl('/', '');
    expect(result.redirect).toBe('/tickets');
    expect(result.panel).toBe('tickets');
  });

  it('parses /sessions', () => {
    const result = parseUrl('/sessions', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionId).toBeNull();
    expect(result.splitId).toBeNull();
  });

  it('parses /sessions/:ticketId', () => {
    const result = parseUrl('/sessions/abc123', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionTicketId).toBe('abc123');
    expect(result.sessionTabKey).toBeNull();
  });

  it('parses /sessions/:ticketId/:tabKey', () => {
    const result = parseUrl('/sessions/abc123/s%3Adef456', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionTicketId).toBe('abc123');
    expect(result.sessionTabKey).toBe('s:def456');
  });

  it('parses /sessions/system', () => {
    const result = parseUrl('/sessions/system', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionTicketId).toBe('system');
    expect(result.sessionTabKey).toBeNull();
  });

  it('parses /sessions/system/:tabKey', () => {
    const result = parseUrl('/sessions/system/s%3Aabc123', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionTicketId).toBe('system');
    expect(result.sessionTabKey).toBe('s:abc123');
  });

  it('parses /repositories', () => {
    const result = parseUrl('/repositories', '');
    expect(result.panel).toBe('repositories');
    expect(result.repoKey).toBeNull();
  });

  it('parses /repositories/:org/:name', () => {
    const result = parseUrl('/repositories/myorg/myrepo', '');
    expect(result.panel).toBe('repositories');
    expect(result.repoKey).toBe('myorg/myrepo');
  });

  it('parses /tickets', () => {
    const result = parseUrl('/tickets', '');
    expect(result.panel).toBe('tickets');
    expect(result.boardId).toBeUndefined();
  });

  it('parses /tickets/board/all', () => {
    const result = parseUrl('/tickets/board/all', '');
    expect(result.panel).toBe('tickets');
    expect(result.boardId).toBeNull();
  });

  it('parses /tickets/board/:boardId', () => {
    const result = parseUrl('/tickets/board/board-123', '');
    expect(result.panel).toBe('tickets');
    expect(result.boardId).toBe('board-123');
    expect(result.ticketId).toBeNull();
  });

  it('parses /tickets/board/:boardId/ticket/:ticketId', () => {
    const result = parseUrl('/tickets/board/board-123/ticket/ticket-456', '');
    expect(result.panel).toBe('tickets');
    expect(result.boardId).toBe('board-123');
    expect(result.ticketId).toBe('ticket-456');
  });

  it('parses /claude-config', () => {
    const result = parseUrl('/claude-config', '');
    expect(result.panel).toBe('claude-config');
  });

  it('parses /cluster', () => {
    const result = parseUrl('/cluster', '');
    expect(result.panel).toBe('cluster');
  });

  it('parses /scratchpads', () => {
    const result = parseUrl('/scratchpads', '');
    expect(result.panel).toBe('scratchpads');
    expect(result.scratchpadKey).toBeNull();
  });

  it('parses /scratchpads/global', () => {
    const result = parseUrl('/scratchpads/global', '');
    expect(result.panel).toBe('scratchpads');
    expect(result.scratchpadKey).toBe('__global__');
  });

  it('parses /scratchpads/:org/:name', () => {
    const result = parseUrl('/scratchpads/myorg/myrepo', '');
    expect(result.panel).toBe('scratchpads');
    expect(result.scratchpadKey).toBe('myorg/myrepo');
  });

  it('parses /settings', () => {
    const result = parseUrl('/settings', '');
    expect(result.panel).toBe('settings');
    expect(result.settingsTab).toBeNull();
  });

  it('parses /settings/:tab', () => {
    const result = parseUrl('/settings/appearance', '');
    expect(result.panel).toBe('settings');
    expect(result.settingsTab).toBe('appearance');
  });

  it('redirects unknown /settings/:tab to /settings', () => {
    const result = parseUrl('/settings/invalid-tab', '');
    expect(result.redirect).toBe('/settings');
  });

  it('parses /agents', () => {
    const result = parseUrl('/agents', '');
    expect(result.panel).toBe('agents');
    expect(result.personaId).toBeNull();
    expect(result.personaTab).toBeNull();
  });

  it('parses /agents/:id', () => {
    const result = parseUrl('/agents/persona-123', '');
    expect(result.panel).toBe('agents');
    expect(result.personaId).toBe('persona-123');
    expect(result.personaTab).toBe('config');
  });

  it('parses /agents/:id/:tab', () => {
    const result = parseUrl('/agents/persona-123/soul', '');
    expect(result.panel).toBe('agents');
    expect(result.personaId).toBe('persona-123');
    expect(result.personaTab).toBe('soul');
  });

  it('defaults invalid agent tab to config', () => {
    const result = parseUrl('/agents/persona-123/invalid', '');
    expect(result.panel).toBe('agents');
    expect(result.personaId).toBe('persona-123');
    expect(result.personaTab).toBe('config');
  });

  it('parses /sessions/agent/:ticketId', () => {
    const result = parseUrl('/sessions/agent/ticket-123', '');
    expect(result.panel).toBe('sessions');
    expect(result.agentWorktreeTicketId).toBe('ticket-123');
    expect(result.sessionId).toBeNull();
  });

  it('redirects unknown routes to /tickets (never to the hidden Dashboard)', () => {
    const result = parseUrl('/unknown-route', '');
    expect(result.redirect).toBe('/tickets');
    expect(result.panel).toBe('tickets');
  });
});

describe('storeToUrl', () => {
  it('generates /sessions when nothing selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/sessions');
    expect(url.search).toBe('');
  });

  it('generates /sessions/:ticketId when ticket selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general', undefined, undefined, undefined, undefined, 'ticket-abc', null);
    expect(url.pathname).toBe('/sessions/ticket-abc');
  });

  it('generates /sessions/:ticketId/:tabKey when ticket and tab selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general', undefined, undefined, undefined, undefined, 'ticket-abc', 's:session-123');
    expect(url.pathname).toBe('/sessions/ticket-abc/s%3Asession-123');
  });

  it('generates /sessions/system when system shells selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general', undefined, undefined, undefined, undefined, 'system', null);
    expect(url.pathname).toBe('/sessions/system');
  });

  it('generates /repositories when no repo selected', () => {
    const url = storeToUrl('repositories', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/repositories');
  });

  it('generates /repositories/:key when repo selected', () => {
    const url = storeToUrl('repositories', null, null, 'myorg/myrepo', null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/repositories/myorg/myrepo');
  });

  it('generates /tickets/board/all when all boards', () => {
    const url = storeToUrl('tickets', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/all');
  });

  it('generates /tickets/board/:id when board selected', () => {
    const url = storeToUrl('tickets', null, null, null, 'board-123', null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/board-123');
  });

  it('generates /tickets/board/:boardId/ticket/:ticketId when ticket selected', () => {
    const url = storeToUrl('tickets', null, null, null, 'board-123', 'ticket-456', null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/board-123/ticket/ticket-456');
  });

  it('generates /agents when no persona selected', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/agents');
  });

  it('generates /agents/:id when persona selected', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, 'persona-123', null, 'config', 'general');
    expect(url.pathname).toBe('/agents/persona-123');
  });

  it('generates /agents/:id/:tab when non-config tab active', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, 'persona-123', null, 'soul', 'general');
    expect(url.pathname).toBe('/agents/persona-123/soul');
  });

  it('generates /scratchpads/global for global scratchpad', () => {
    const url = storeToUrl('scratchpads', null, null, null, null, null, '__global__', null, null, 'config', 'general');
    expect(url.pathname).toBe('/scratchpads/global');
  });

  it('generates /scratchpads/:org/:name for repo scratchpad', () => {
    const url = storeToUrl('scratchpads', null, null, null, null, null, 'myorg/myrepo', null, null, 'config', 'general');
    expect(url.pathname).toBe('/scratchpads/myorg/myrepo');
  });

  it('generates /settings/:tab', () => {
    const url = storeToUrl('settings', null, null, null, null, null, null, null, null, 'config', 'appearance');
    expect(url.pathname).toBe('/settings/appearance');
  });

  it('generates /claude-config', () => {
    const url = storeToUrl('claude-config', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/claude-config');
  });

  it('generates /cluster', () => {
    const url = storeToUrl('cluster', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/cluster');
  });

  it('generates /sessions/agent/:ticketId when agent worktree selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general', 'ticket-123');
    expect(url.pathname).toBe('/sessions/agent/ticket-123');
  });

  it('prefers ticket over agent worktree when both set', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general', 'ticket-123', undefined, undefined, undefined, 'ticket-abc', null);
    expect(url.pathname).toBe('/sessions/ticket-abc');
  });
});

// The whole point of these: Back/Forward must retain intermediate views. A
// store-driven URL change should PUSH a new entry when the primary view changes
// (panel, selected ticket/epic/persona/repo, roadmap toggle, session/settings
// section) and REPLACE only when it's a detail-tab switch or URL normalisation —
// otherwise clicking around tabs of one ticket spams history, and the previous
// unconditional `replace` erased intermediate views entirely.
describe('historyActionForNav', () => {
  const action = (from: string, to: string) => historyActionForNav(from, '', to, '');

  it('pushes when selecting a ticket from the board (the reported bug)', () => {
    // Kanban → ticket detail must leave the kanban entry reachable via Back.
    expect(action('/tickets/board/all', '/tickets/board/all/ticket/t1')).toBe('push');
  });

  it('replaces when the store normalises /tickets to /tickets/board/all', () => {
    // Same view (board, nothing selected) — must not create a spurious entry.
    expect(action('/tickets', '/tickets/board/all')).toBe('replace');
  });

  it('pushes when switching tabs within the same ticket detail', () => {
    // Switching a detail tab is a real navigation: Back must return to the
    // previous tab, not skip past the whole ticket to the board.
    expect(action('/tickets/board/all/ticket/t1', '/tickets/board/all/ticket/t1/comments')).toBe('push');
  });

  it('replaces when the store normalises the default (description) ticket tab', () => {
    // storeToUrl omits the default tab, so the shorthand and the explicit
    // /description form are the same view — no spurious entry.
    expect(action('/tickets/board/all/ticket/t1', '/tickets/board/all/ticket/t1/description')).toBe('replace');
  });

  it('pushes when switching tabs within the same epic detail', () => {
    expect(action('/tickets/board/all/epic/e1', '/tickets/board/all/epic/e1/deliverables')).toBe('push');
  });

  it('pushes when switching tabs within the same persona', () => {
    expect(action('/agents/p1', '/agents/p1/soul')).toBe('push');
  });

  it('replaces when the store normalises the default (config) persona tab', () => {
    // Bare /agents/p1 parses as the config tab, same as the explicit form.
    expect(action('/agents/p1', '/agents/p1/config')).toBe('replace');
  });

  it('replays the reported tab scenario: comments → deliverables keeps comments', () => {
    // NaS: on a ticket detail, going comments → deliverables then Back must
    // land on comments, not jump straight to the board.
    expect(action('/tickets/board/all/ticket/t1', '/tickets/board/all/ticket/t1/comments')).toBe('push');
    expect(action('/tickets/board/all/ticket/t1/comments', '/tickets/board/all/ticket/t1/deliverables')).toBe('push');
  });

  it('replaces when the store normalises bare /settings to /settings/general', () => {
    // Bare /settings resolves to the general section — same view, no entry.
    expect(action('/settings', '/settings/general')).toBe('replace');
  });

  it('pushes when toggling between board and roadmap view', () => {
    expect(action('/tickets/board/all', '/tickets/board/all/roadmap')).toBe('push');
  });

  it('pushes when selecting an epic from the board', () => {
    expect(action('/tickets/board/all', '/tickets/board/all/epic/e1')).toBe('push');
  });

  it('pushes when switching top-level panels', () => {
    expect(action('/sessions', '/tickets/board/all')).toBe('push');
    expect(action('/tickets/board/all/ticket/t1', '/repositories')).toBe('push');
  });

  it('pushes when selecting a repository', () => {
    expect(action('/repositories', '/repositories/myorg/myrepo')).toBe('push');
  });

  it('pushes when selecting a persona', () => {
    expect(action('/agents', '/agents/p1')).toBe('push');
  });

  it('pushes when changing settings section', () => {
    expect(action('/settings/general', '/settings/appearance')).toBe('push');
  });

  it('pushes when switching between session terminals', () => {
    expect(action('/sessions/ticket-abc/s%3Aone', '/sessions/ticket-abc/s%3Atwo')).toBe('push');
  });

  it('replays the reported scenario: sessions → kanban → ticket → repos keeps every step', () => {
    // Each hop is the URL the store lands on; assert the history action so that
    // Back walks repos → ticket → kanban → sessions (ticket detail retained).
    expect(action('/sessions', '/tickets/board/all')).toBe('push'); // sessions → kanban
    expect(action('/tickets/board/all', '/tickets/board/all/ticket/t1')).toBe('push'); // kanban → ticket
    expect(action('/tickets/board/all/ticket/t1', '/repositories')).toBe('push'); // ticket → repos
  });
});
