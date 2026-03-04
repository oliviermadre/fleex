import { describe, it, expect } from 'vitest';
import { parseUrl, storeToUrl } from './RouterSync';

describe('parseUrl', () => {
  it('redirects / to /sessions', () => {
    const result = parseUrl('/', '');
    expect(result.redirect).toBe('/sessions');
    expect(result.panel).toBe('sessions');
  });

  it('parses /sessions', () => {
    const result = parseUrl('/sessions', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionId).toBeNull();
    expect(result.splitId).toBeNull();
  });

  it('parses /sessions/:id', () => {
    const result = parseUrl('/sessions/abc123', '');
    expect(result.panel).toBe('sessions');
    expect(result.sessionId).toBe('abc123');
    expect(result.splitId).toBeNull();
  });

  it('parses /sessions/:id?split=:splitId', () => {
    const result = parseUrl('/sessions/abc123', '?split=def456');
    expect(result.panel).toBe('sessions');
    expect(result.sessionId).toBe('abc123');
    expect(result.splitId).toBe('def456');
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

  it('redirects unknown routes to /sessions', () => {
    const result = parseUrl('/unknown-route', '');
    expect(result.redirect).toBe('/sessions');
    expect(result.panel).toBe('sessions');
  });
});

describe('storeToUrl', () => {
  it('generates /sessions when no session selected', () => {
    const url = storeToUrl('sessions', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/sessions');
    expect(url.search).toBe('');
  });

  it('generates /sessions/:id when session selected', () => {
    const url = storeToUrl('sessions', 'abc123', null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/sessions/abc123');
    expect(url.search).toBe('');
  });

  it('generates /sessions/:id?split=:splitId when split active', () => {
    const url = storeToUrl('sessions', 'abc123', 'def456', null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/sessions/abc123');
    expect(url.search).toBe('?split=def456');
  });

  it('generates /repositories when no repo selected', () => {
    const url = storeToUrl('repositories', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/repositories');
  });

  it('generates /repositories/:key when repo selected', () => {
    const url = storeToUrl('repositories', null, null, null, 'myorg/myrepo', null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/repositories/myorg/myrepo');
  });

  it('generates /tickets/board/all when all boards', () => {
    const url = storeToUrl('tickets', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/all');
  });

  it('generates /tickets/board/:id when board selected', () => {
    const url = storeToUrl('tickets', null, null, null, null, 'board-123', null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/board-123');
  });

  it('generates /tickets/board/:boardId/ticket/:ticketId when ticket selected', () => {
    const url = storeToUrl('tickets', null, null, null, null, 'board-123', 'ticket-456', null, null, 'config', 'general');
    expect(url.pathname).toBe('/tickets/board/board-123/ticket/ticket-456');
  });

  it('generates /agents when no persona selected', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, null, null, 'config', 'general');
    expect(url.pathname).toBe('/agents');
  });

  it('generates /agents/:id when persona selected', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, null, 'persona-123', 'config', 'general');
    expect(url.pathname).toBe('/agents/persona-123');
  });

  it('generates /agents/:id/:tab when non-config tab active', () => {
    const url = storeToUrl('agents', null, null, null, null, null, null, null, 'persona-123', 'soul', 'general');
    expect(url.pathname).toBe('/agents/persona-123/soul');
  });

  it('generates /scratchpads/global for global scratchpad', () => {
    const url = storeToUrl('scratchpads', null, null, null, null, null, null, '__global__', null, 'config', 'general');
    expect(url.pathname).toBe('/scratchpads/global');
  });

  it('generates /scratchpads/:org/:name for repo scratchpad', () => {
    const url = storeToUrl('scratchpads', null, null, null, null, null, null, 'myorg/myrepo', null, 'config', 'general');
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

  it('prefers session over agent worktree when both set', () => {
    const url = storeToUrl('sessions', 'abc123', null, null, null, null, null, null, null, 'config', 'general', 'ticket-123');
    expect(url.pathname).toBe('/sessions/abc123');
  });
});
