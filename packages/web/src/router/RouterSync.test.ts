import { describe, it, expect } from 'vitest';
import { parseUrl, storeToUrl, historyActionForNav } from './RouterSync';

describe('parseUrl', () => {
  it('redirects / to /tickets (Kanban is the default view)', () => {
    const result = parseUrl('/', '');
    expect(result.redirect).toBe('/tickets');
    expect(result.panel).toBe('tickets');
  });

  it('parses /focus', () => {
    expect(parseUrl('/focus', '').panel).toBe('focus');
  });

  it('parses bare /work as "no task stated" (the store keeps its selection)', () => {
    const result = parseUrl('/work', '');
    expect(result.panel).toBe('work');
    expect(result.work).toEqual({ view: 'task', mode: 'chat' });
    expect(result.work?.ticketId).toBeUndefined();
  });

  it('parses /work/new as the new-task composer', () => {
    const result = parseUrl('/work/new', '');
    expect(result.panel).toBe('work');
    expect(result.work?.view).toBe('new');
  });

  it('parses /work/:ticketId as that task in chat mode', () => {
    const result = parseUrl('/work/t1', '');
    expect(result.work).toEqual({ view: 'task', ticketId: 't1', mode: 'chat' });
    expect(result.redirect).toBeUndefined();
  });

  it('parses /work/:ticketId/:mode for every non-chat center mode', () => {
    for (const mode of ['code', 'shell', 'workflow'] as const) {
      const result = parseUrl(`/work/t1/${mode}`, '');
      expect(result.work, `/work/t1/${mode}`).toEqual({ view: 'task', ticketId: 't1', mode });
    }
  });

  it('redirects an unknown /work/:ticketId/:mode to the task itself', () => {
    const result = parseUrl('/work/t1/nope', '');
    expect(result.redirect).toBe('/work/t1');
  });

  it('sends the retired Sessions, Cockpit and Dashboard URLs to /tickets', () => {
    // Old bookmarks / Electron history must land somewhere real, never on a
    // view that no longer exists.
    for (const url of ['/sessions', '/sessions/abc', '/sessions/abc/s%3A1', '/sessions/system', '/sessions/system/s%3A1', '/sessions/agent/t1', '/list-focus', '/dashboard']) {
      const result = parseUrl(url, '');
      expect(result.redirect, url).toBe('/tickets');
      expect(result.panel, url).toBe('tickets');
    }
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

  it('parses every tab the settings nav can navigate to', () => {
    // The nav is route-driven: it calls navigate(`/settings/<tab>`), so a tab the
    // parser does not know is a menu entry that does nothing when clicked, with no
    // error to notice. That shipped once, for `memory`.
    const navigable = [
      'general', 'appearance',
      'agent-tokens', 'deliverable-types', 'memory',
    ];
    for (const tab of navigable) {
      const result = parseUrl(`/settings/${tab}`, '');
      expect(result.settingsTab, `/settings/${tab} should be routable`).toBe(tab);
      expect(result.redirect, `/settings/${tab} should not redirect`).toBeUndefined();
    }
  });

  it('round-trips every settings tab through a url', () => {
    // What the store holds has to survive being turned into a url and read back,
    // or the nav highlight and the panel disagree about which tab is open.
    for (const tab of ['general', 'memory', 'deliverable-types'] as const) {
      const url = storeToUrl({ activePanel: 'settings', settingsTab: tab });
      expect(parseUrl(url.pathname, url.search).settingsTab).toBe(tab);
    }
  });

  it('routes Settings › Actions to a scope list and to one action detail', () => {
    // The nav links to /settings/actions/<scope>; a detail is /settings/actions/<scope>/<id>,
    // which is what the button context menu's "Edit…" opens.
    expect(parseUrl('/settings/actions/pinned', '')).toMatchObject({ settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: null } });
    expect(parseUrl('/settings/actions/ticket/abc-1', '')).toMatchObject({ settingsTab: 'actions', actionsRoute: { scope: 'ticket', id: 'abc-1' } });
    expect(parseUrl('/settings/actions', '').redirect).toBe('/settings/actions/pinned');

    const url = storeToUrl({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope: 'pinned', id: 'gh' } });
    expect(url.pathname).toBe('/settings/actions/pinned/gh');
    expect(parseUrl(url.pathname, '').actionsRoute).toEqual({ scope: 'pinned', id: 'gh' });
  });

  it('redirects the two retired tabs to their Actions scope, so old links keep working', () => {
    expect(parseUrl('/settings/pinned-icons', '').redirect).toBe('/settings/actions/pinned');
    expect(parseUrl('/settings/workspace-actions', '').redirect).toBe('/settings/actions/ticket');
  });

  it('treats opening another action detail as a navigation (Back returns to the list)', () => {
    expect(historyActionForNav('/settings/actions/pinned', '', '/settings/actions/pinned/gh', '')).toBe('push');
  });

  it('redirects unknown /settings/:tab to /settings', () => {
    const result = parseUrl('/settings/invalid-tab', '');
    expect(result.redirect).toBe('/settings');
  });

  it('redirects legacy /settings/repositories to the Repos view', () => {
    const result = parseUrl('/settings/repositories', '');
    expect(result.panel).toBe('repositories');
    expect(result.redirect).toBeUndefined();
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

  it('redirects unknown routes to /tickets', () => {
    const result = parseUrl('/unknown-route', '');
    expect(result.redirect).toBe('/tickets');
    expect(result.panel).toBe('tickets');
  });
});

describe('storeToUrl', () => {
  it('generates /focus for the focus panel', () => {
    const url = storeToUrl({ activePanel: 'focus' });
    expect(url.pathname).toBe('/focus');
    expect(url.search).toBe('');
  });

  it('generates /work when no task is selected', () => {
    const url = storeToUrl({ activePanel: 'work' });
    expect(url.pathname).toBe('/work');
    expect(url.search).toBe('');
  });

  it('generates /work/:ticketId for a task in chat mode (the default mode is implicit)', () => {
    expect(storeToUrl({ activePanel: 'work', workTicketId: 't1' }).pathname).toBe('/work/t1');
    expect(storeToUrl({ activePanel: 'work', workTicketId: 't1', workMode: 'chat' }).pathname).toBe('/work/t1');
  });

  it('generates /work/:ticketId/:mode for a task in code / shell / workflow mode', () => {
    expect(storeToUrl({ activePanel: 'work', workTicketId: 't1', workMode: 'shell' }).pathname).toBe('/work/t1/shell');
    expect(storeToUrl({ activePanel: 'work', workTicketId: 't1', workMode: 'code' }).pathname).toBe('/work/t1/code');
  });

  it('generates /work/new for the new-task composer, whatever task is selected', () => {
    expect(storeToUrl({ activePanel: 'work', workView: 'new', workTicketId: 't1', workMode: 'shell' }).pathname).toBe('/work/new');
  });

  it('round-trips every Work view state through a url', () => {
    // What the store holds must survive the url and back, or a reload / a copied
    // link would open another task or another mode than the one on screen.
    for (const workMode of ['chat', 'code', 'shell', 'workflow'] as const) {
      const url = storeToUrl({ activePanel: 'work', workTicketId: 't1', workMode });
      expect(parseUrl(url.pathname, url.search).work).toEqual({ view: 'task', ticketId: 't1', mode: workMode });
    }
    const newUrl = storeToUrl({ activePanel: 'work', workView: 'new' });
    expect(parseUrl(newUrl.pathname, newUrl.search).work?.view).toBe('new');
  });

  it('generates /repositories when no repo selected', () => {
    const url = storeToUrl({ activePanel: 'repositories' });
    expect(url.pathname).toBe('/repositories');
  });

  it('generates /repositories/:key when repo selected', () => {
    const url = storeToUrl({ activePanel: 'repositories', selectedRepoKey: 'myorg/myrepo' });
    expect(url.pathname).toBe('/repositories/myorg/myrepo');
  });

  it('generates /tickets/board/all when all boards', () => {
    const url = storeToUrl({ activePanel: 'tickets' });
    expect(url.pathname).toBe('/tickets/board/all');
  });

  it('generates /tickets/board/:id when board selected', () => {
    const url = storeToUrl({ activePanel: 'tickets', selectedBoardId: 'board-123' });
    expect(url.pathname).toBe('/tickets/board/board-123');
  });

  it('generates /tickets/board/:boardId/ticket/:ticketId when ticket selected', () => {
    const url = storeToUrl({ activePanel: 'tickets', selectedBoardId: 'board-123', selectedTicketId: 'ticket-456' });
    expect(url.pathname).toBe('/tickets/board/board-123/ticket/ticket-456');
  });

  it('generates /agents when no persona selected', () => {
    const url = storeToUrl({ activePanel: 'agents' });
    expect(url.pathname).toBe('/agents');
  });

  it('generates /agents/:id when persona selected', () => {
    const url = storeToUrl({ activePanel: 'agents', selectedPersonaId: 'persona-123' });
    expect(url.pathname).toBe('/agents/persona-123');
  });

  it('generates /agents/:id/:tab when non-config tab active', () => {
    const url = storeToUrl({ activePanel: 'agents', selectedPersonaId: 'persona-123', personaTab: 'soul' });
    expect(url.pathname).toBe('/agents/persona-123/soul');
  });

  it('generates /scratchpads/global for global scratchpad', () => {
    const url = storeToUrl({ activePanel: 'scratchpads', selectedScratchpadKey: '__global__' });
    expect(url.pathname).toBe('/scratchpads/global');
  });

  it('generates /scratchpads/:org/:name for repo scratchpad', () => {
    const url = storeToUrl({ activePanel: 'scratchpads', selectedScratchpadKey: 'myorg/myrepo' });
    expect(url.pathname).toBe('/scratchpads/myorg/myrepo');
  });

  it('generates /settings/:tab', () => {
    const url = storeToUrl({ activePanel: 'settings', settingsTab: 'appearance' });
    expect(url.pathname).toBe('/settings/appearance');
  });

  it('generates /claude-config', () => {
    const url = storeToUrl({ activePanel: 'claude-config' });
    expect(url.pathname).toBe('/claude-config');
  });

  it('generates /cluster', () => {
    const url = storeToUrl({ activePanel: 'cluster' });
    expect(url.pathname).toBe('/cluster');
  });

});

// The whole point of these: Back/Forward must retain intermediate views. A
// store-driven URL change should PUSH a new entry when the primary view changes
// (panel, selected ticket/epic/persona/repo/task, roadmap toggle, Work center
// mode, settings section) and REPLACE only when it's a detail-tab switch or URL normalisation —
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
    expect(action('/work/t1', '/tickets/board/all')).toBe('push');
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

  it('pushes when selecting another task in the Work view', () => {
    expect(action('/work/t1', '/work/t2')).toBe('push');
  });

  it('pushes when switching the center mode of a task', () => {
    // Like a detail tab: Back from the shell returns to the chat.
    expect(action('/work/t1', '/work/t1/shell')).toBe('push');
  });

  it('pushes when opening the new-task composer', () => {
    expect(action('/work/t1', '/work/new')).toBe('push');
  });

  it('replaces when the store fills bare /work in with the remembered task', () => {
    // Bare /work states no task: naming the one on screen is normalisation, and
    // must not leave a dead /work entry behind for Back to stop on.
    expect(action('/work', '/work/t1')).toBe('replace');
    expect(action('/work', '/work/t1/shell')).toBe('replace');
  });

  it('replays the reported scenario: tasks → kanban → ticket → repos keeps every step', () => {
    // Each hop is the URL the store lands on; assert the history action so that
    // Back walks repos → ticket → kanban → tasks (ticket detail retained).
    expect(action('/work/t1', '/tickets/board/all')).toBe('push'); // tasks → kanban
    expect(action('/tickets/board/all', '/tickets/board/all/ticket/t1')).toBe('push'); // kanban → ticket
    expect(action('/tickets/board/all/ticket/t1', '/repositories')).toBe('push'); // ticket → repos
  });
});
