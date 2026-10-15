import { describe, it, expect } from 'vitest';
import { computeThreadStats } from './threadStats';

const c = (id: string, threadId: string | null) => ({ id, threadId });
const m = (id: string, commentId: string) => ({ id, commentId });
const x = (mentionId: string, status: string) => ({ mentionId, status }) as { mentionId: string; status: 'running' };

describe('computeThreadStats', () => {
  const comments = [c('c0', null), c('c1', 't1'), c('c2', 't1'), c('c3', 't2')];
  const mentions = [m('m0', 'c0'), m('m1', 'c1'), m('m2', 'c3')];

  it('counts the messages of a thread: only comments carrying its id, not the main stream', () => {
    const s = computeThreadStats(comments, mentions, []);
    expect(s.get('t1')?.messages).toBe(2);
    expect(s.get('t2')?.messages).toBe(1);
  });

  it('counts runs through mention → comment → thread, and the ones executing now', () => {
    const s = computeThreadStats(comments, mentions, [x('m1', 'completed'), x('m1', 'running'), x('m2', 'failed')]);
    expect(s.get('t1')).toEqual({ messages: 2, runs: 2, activeRuns: 1 });
    expect(s.get('t2')).toEqual({ messages: 1, runs: 1, activeRuns: 0 });
  });

  it('ignores runs of mentions raised outside any thread (main stream, assistant)', () => {
    const s = computeThreadStats(comments, mentions, [x('m0', 'running'), x('assistant:abc', 'running')]);
    expect(s.get('t1')?.runs).toBe(0);
    expect(s.get('t1')?.activeRuns).toBe(0);
  });

  it('knows nothing of a thread without messages (the caller falls back to zero)', () => {
    expect(computeThreadStats([], [], []).size).toBe(0);
  });
});
