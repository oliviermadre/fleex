import { describe, it, expect } from 'vitest';
import { buildWorktreeRows } from './overview-helpers';

const wt = (branch: string, over = {}) => ({ path: `/wt/${branch}`, branch, isMain: false, isBare: false, ...over });
const ticket = (id: string, status: string, links: unknown[] = []) => ({ id, status, links, displayId: 1, title: 't' }) as never;

describe('buildWorktreeRows', () => {
  it('skips bare and main worktrees', () => {
    const { active, orphaned } = buildWorktreeRows(
      [wt('main', { isMain: true }), wt('x', { isBare: true })] as never, {}, undefined, [], [],
    );
    expect(active).toEqual([]);
    expect(orphaned).toEqual([]);
  });

  it('links a ticket via the session group path and buckets open tickets as active', () => {
    const group = { repositoryOrg: 'a', repositoryName: 'b', worktrees: [{ branch: 'f1', path: '/wt/f1', sessions: [], ticketId: 't1' }] } as never;
    const { active, orphaned } = buildWorktreeRows([wt('f1')] as never, { f1: { commitsAhead: 1, commitsBehind: 0, filesChanged: 0, additions: 0, deletions: 0 } }, group, [ticket('t1', 'doing')], []);
    expect(active).toHaveLength(1);
    expect(orphaned).toHaveLength(0);
    expect(active[0]!.ticket).not.toBeNull();
    expect(active[0]!.verdict).toBe('ready_to_push');
  });

  it('buckets done/missing tickets as orphaned with removable verdicts', () => {
    const { active, orphaned } = buildWorktreeRows(
      [wt('f1'), wt('f2')] as never, {}, undefined,
      [ticket('t1', 'done', [{ type: 'worktree', ref: '/wt/f1' }])], [],
    );
    expect(active).toHaveLength(0);
    expect(orphaned.map((r) => r.worktree.branch).sort()).toEqual(['f1', 'f2']);
    expect(orphaned.every((r) => r.verdict === 'stale_removable')).toBe(true);
  });

  it('attaches the matching PR and lets merged win', () => {
    const pr = { number: 9, headRefName: 'f1', state: 'merged' } as never;
    const group = { worktrees: [{ path: '/wt/f1', ticketId: 't1', sessions: [] }] } as never;
    const { active } = buildWorktreeRows([wt('f1')] as never, {}, group, [ticket('t1', 'doing')], [pr]);
    expect(active[0]!.pr).toBe(pr);
    expect(active[0]!.verdict).toBe('merged_removable');
  });
});
