import { describe, it, expect, vi } from 'vitest';
import type { FocusItem, Session, SessionGroup } from '@fleex/shared';
import { aggregateSignal, applyCliSessions, sessionSignal } from './focusSessions';
import { focusActions, focusSummary } from './focusModel';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1', tmuxName: 'fleex_claude_s1', type: 'claude', status: 'running', cwd: '/wt', createdAt: '2026-09-29T08:00:00Z',
  lastAttachedAt: null, repositoryOrg: 'o', repositoryName: 'r', worktreeBranch: 'b', gitRemote: null, displayName: 's1',
  foregroundProcess: '2.1.0', hookStatusUpdatedAt: '2026-09-29T09:00:00Z',
  ...over,
});
const groups = (sessions: Session[], ticketId = 'T1'): SessionGroup[] => [
  { repositoryOrg: 'o', repositoryName: 'r', worktrees: [{ branch: 'b', path: '/wt', sessions, ticketId }] },
];
const idle: FocusItem = {
  key: 'idle:T1', kind: 'idle', ticketId: 'T1', since: '2026-09-28T10:00:00Z', workflow: null, gate: null, question: null,
  error: null, idle: { lastActivityAt: null, lastAgentName: null, lastAgentDisplayName: null }, lastAgentComment: null, costUsd: 0,
};

describe('sessionSignal', () => {
  it('reads the hook status', () => {
    expect(sessionSignal(session({ hookStatus: 'working' }))).toMatchObject({ state: 'busy' });
    expect(sessionSignal(session({ hookStatus: 'waiting', hookWaitingReason: 'permission', hookLastMessage: 'Bash' })))
      .toMatchObject({ state: 'waiting', reason: 'permission', sessionId: 's1', message: 'Bash' });
    expect(sessionSignal(session({ hookStatus: 'waiting', hookWaitingReason: 'idle' }))).toMatchObject({ state: 'rest' });
    expect(sessionSignal(session({ hookStatus: 'complete' }))).toMatchObject({ state: 'rest', since: '2026-09-29T09:00:00Z' });
  });

  it('ignores dead sessions and sessions with no signal', () => {
    expect(sessionSignal(session({ hookStatus: 'working', status: 'dead' }))).toBeNull();
    expect(sessionSignal(session({ hookStatus: 'unknown' }))).toBeNull();
    expect(sessionSignal(session({ type: 'shell', foregroundProcess: 'bun' }))).toBeNull(); // a dev server is not Claude
  });

  it('reads a stale "working" as rest once a claude pane is back to the shell', () => {
    expect(sessionSignal(session({ hookStatus: 'working', foregroundProcess: 'zsh' }))).toMatchObject({ state: 'rest' });
    // A shell session only mirrors the hooks of a Claude running elsewhere in its cwd: its prompt proves nothing.
    expect(sessionSignal(session({ type: 'shell', hookStatus: 'working', foregroundProcess: 'zsh' }))).toMatchObject({ state: 'busy' });
  });

  it('falls back to the legacy activity without hooks', () => {
    expect(sessionSignal(session({ claudeActivity: 'executing' }))).toMatchObject({ state: 'busy' });
    expect(sessionSignal(session({ claudeActivity: 'waiting_user_choice' }))).toMatchObject({ state: 'waiting', reason: 'question' });
  });
});

describe('aggregateSignal', () => {
  it('lets the most demanding session win', () => {
    const working = session({ id: 'a', hookStatus: 'working' });
    const waiting = session({ id: 'b', hookStatus: 'waiting', hookWaitingReason: 'question' });
    const done = session({ id: 'c', hookStatus: 'complete' });
    expect(aggregateSignal([done, working])).toMatchObject({ state: 'busy' });
    expect(aggregateSignal([working, waiting, done])).toMatchObject({ state: 'waiting', sessionId: 'b' });
    expect(aggregateSignal([])).toBeNull();
  });

  it('on a tie, points at the terminal running Claude, not a sibling shell with the same fanned-out status', () => {
    const at = { hookStatusUpdatedAt: '2026-09-29T09:00:00Z' };
    const shell = session({ id: 'shell', type: 'shell', foregroundProcess: 'zsh', hookStatus: 'complete', ...at });
    const claude = session({ id: 'claude', type: 'shell', foregroundProcess: '2.1.284', hookStatus: 'complete', ...at });
    expect(aggregateSignal([shell, claude])).toMatchObject({ state: 'rest', sessionId: 'claude' });
    const ask = { hookStatus: 'waiting' as const, hookWaitingReason: 'permission' as const, ...at };
    expect(aggregateSignal([{ ...shell, ...ask }, { ...claude, ...ask }])).toMatchObject({ state: 'waiting', sessionId: 'claude' });
    const server = session({ id: 'server', type: 'shell', foregroundProcess: 'bun', hookStatus: 'complete', ...at });
    expect(aggregateSignal([server, claude])).toMatchObject({ sessionId: 'claude' });
  });
});

describe('applyCliSessions', () => {
  it('drops an idle ticket whose CLI session is working', () => {
    const res = applyCliSessions([idle], [], groups([session({ hookStatus: 'working' })]));
    expect(res.items).toEqual([]);
    expect(res.running).toEqual([{
      ticketId: 'T1', source: 'cli', label: 'Claude (terminal)', since: '2026-09-29T09:00:00Z',
      executionId: null, workflow: null, sessionId: 's1', costUsd: 0,
    }]);
  });

  it('turns it into a session question when Claude waits on a permission', async () => {
    const [item] = applyCliSessions([idle], [], groups([session({ hookStatus: 'waiting', hookWaitingReason: 'permission' })])).items;
    expect(item).toMatchObject({
      kind: 'question', key: 'session:s1:2026-09-29T09:00:00Z', since: '2026-09-29T09:00:00Z',
      question: { source: 'session', sessionId: 's1', sessionWait: 'permission' },
    });
    const open = vi.fn();
    const [action] = focusActions(item!, { ticket: { id: 'T1', displayId: 1, status: 'doing' }, moveTicket: vi.fn(), openSession: open });
    expect(action).toMatchObject({ id: 'open-session', immediate: true, primary: true });
    await action!.run();
    expect(open).toHaveBeenCalledWith('s1');
  });

  it('keeps it idle when the session rests, waiting since the end of its turn', () => {
    const [item] = applyCliSessions([idle], [], groups([session({ hookStatus: 'complete' })])).items;
    expect(item).toMatchObject({ kind: 'idle', since: '2026-09-29T09:00:00Z', idle: { cliRestAt: '2026-09-29T09:00:00Z', cliSessionId: 's1' } });
    expect(focusSummary(item!)).toMatch(/Session Claude au repos/);
    const actions = focusActions(item!, { ticket: { id: 'T1', displayId: 1, status: 'doing' }, moveTicket: vi.fn(), openSession: vi.fn() });
    expect(actions.map((a) => [a.id, !!a.primary])).toEqual([['open-session', true], ['advance', false]]);
  });

  it('leaves other kinds and other tickets alone', () => {
    const gate: FocusItem = { ...idle, key: 'gate:x', kind: 'gate', idle: null };
    const res = applyCliSessions([gate, idle], [], groups([session({ hookStatus: 'working' })], 'OTHER'));
    expect(res.items).toEqual([gate, idle]);
  });
});
