import { describe, expect, it } from 'vitest';
import type { AgentThread, TicketComment } from '@fleex/shared';
import { ELBOW, branchCaption, layoutThreadStrip, threadBranches } from './threadBranches';
import type { TimeAnchor } from './layoutAnnotations';

const T0 = Date.parse('2026-11-12T10:00:00Z');
const min = (n: number) => new Date(T0 + n * 60_000).toISOString();
// 10 px per minute, over two hours.
const anchors: TimeAnchor[] = [{ at: T0, x: 100 }, { at: T0 + 120 * 60_000, x: 1300 }];
const NOW_X = 1300;

const thread = (p: Partial<AgentThread> & { id: string }): AgentThread => ({
  ticketId: 't1', initiator: 'assistant', targetType: 'agent', personaId: 'p1', personaName: 'builder', assistantPersonaId: 'a1',
  brief: 'Build it', forwardedContext: [], status: 'running', currentMentionId: null, exchanges: 0, failures: 0, summary: null,
  createdAt: min(0), updatedAt: min(0), concludedAt: null, ...p,
});
const turn = (id: string, threadId: string | null, at: number, authorType: TicketComment['authorType']) =>
  ({ id, threadId, createdAt: min(at), authorType, authorName: authorType } as unknown as TicketComment);

const label = (t: AgentThread) => t.personaName;

describe('threadBranches', () => {
  it('keeps only the comments of each thread, and tells who spoke', () => {
    const [b] = threadBranches(
      [thread({ id: 'th1' })],
      [turn('c0', null, 1, 'user'), turn('c1', 'th1', 2, 'assistant'), turn('c2', 'th1', 5, 'agent'), turn('c3', 'th1', 6, 'user'), turn('c4', 'other', 7, 'agent')],
      label,
    );
    // The main discussion (c0) and another thread's turn (c4) are not this branch's exchanges.
    expect(b!.turns.map((t) => [t.id, t.by])).toEqual([['c1', 'assistant'], ['c2', 'target'], ['c3', 'user']]);
  });

  it('ends a branch only when the thread is concluded or failed', () => {
    const [open, done, failed] = threadBranches(
      [
        thread({ id: 'a', status: 'idle', updatedAt: min(30) }),
        thread({ id: 'b', createdAt: min(1), status: 'concluded', concludedAt: min(40) }),
        thread({ id: 'c', createdAt: min(2), status: 'failed', updatedAt: min(50) }),
      ],
      [],
      label,
    );
    // An idle thread is still alive: it must keep running to "now", not stop at its last update.
    expect(open!.endAt).toBeNull();
    expect(done!.endAt).toBe(T0 + 40 * 60_000);
    expect(failed!.endAt).toBe(T0 + 50 * 60_000);
  });
});

describe('layoutThreadStrip', () => {
  const branches = (threads: AgentThread[], comments: TicketComment[] = []) => threadBranches(threads, comments, label);

  it('draws nothing, and takes no room, without thread', () => {
    expect(layoutThreadStrip([], anchors, NOW_X)).toEqual({ branches: [], lanes: 0, height: 0 });
  });

  it('forks at the opening instant and joins back at the conclusion', () => {
    const { branches: [b] } = layoutThreadStrip(branches([thread({ id: 'a', createdAt: min(10), status: 'concluded', concludedAt: min(60) })]), anchors, NOW_X);
    expect(b!.x0).toBe(200);
    expect(b!.x1).toBe(700);
  });

  it('runs an open thread to now', () => {
    const { branches: [b] } = layoutThreadStrip(branches([thread({ id: 'a', createdAt: min(10) })]), anchors, NOW_X);
    expect(b!.x1).toBe(NOW_X);
  });

  it('gives two threads alive at the same time their own lane, and reuses a freed lane', () => {
    const strip = layoutThreadStrip(
      branches([
        thread({ id: 'a', createdAt: min(0), status: 'concluded', concludedAt: min(40) }),
        thread({ id: 'b', createdAt: min(20), status: 'concluded', concludedAt: min(50) }),
        thread({ id: 'c', createdAt: min(90) }),
      ]),
      anchors,
      NOW_X,
    );
    // a and b overlap in time: side by side they would read as one thread.
    expect(strip.branches.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(strip.lanes).toBe(2);
  });

  it('keeps a thread concluded at once wide enough to show its fork and its merge', () => {
    const { branches: [b] } = layoutThreadStrip(branches([thread({ id: 'a', status: 'concluded', concludedAt: min(0) })]), anchors, NOW_X);
    expect(b!.x1 - b!.x0).toBeGreaterThanOrEqual(2 * ELBOW);
  });

  const picto = (id: string, threadId: string, x: number) =>
    ({ event: { id, threadId }, x, width: 30, attached: false, textWidth: null }) as unknown as import('./layoutTimeline').PlacedEvent;

  it('hangs on each branch the pictos of its own thread only', () => {
    const strip = layoutThreadStrip(
      branches([thread({ id: 'a', status: 'concluded', concludedAt: min(40) }), thread({ id: 'b', createdAt: min(60) })]),
      anchors,
      NOW_X,
      [picto('c1', 'a', 150), picto('r1', 'a', 300), picto('c2', 'b', 800)],
    );
    expect(strip.branches.map((b) => b.items.map((i) => i.event.id))).toEqual([['c1', 'r1'], ['c2']]);
  });

  it('forks before the first picto and joins back after the last, never under them', () => {
    // The opening turn is posted as the thread is created, the last answer as it is concluded.
    const { branches: [b] } = layoutThreadStrip(
      branches([thread({ id: 'a', createdAt: min(10), status: 'concluded', concludedAt: min(60) })]),
      anchors,
      NOW_X,
      [picto('c1', 'a', 200), picto('c2', 'a', 700)],
    );
    expect(b!.x0).toBeLessThan(200 - ELBOW);
    expect(b!.x1).toBeGreaterThan(700 + ELBOW);
  });

  it('marks where a run was stopped on purpose, after the last picto', () => {
    const stopped = thread({ id: 'a', status: 'idle', lastStop: { by: 'user', at: min(20), reason: null, mentionId: null } });
    const { branches: [b] } = layoutThreadStrip(branches([stopped]), anchors, NOW_X, [picto('r1', 'a', 290)]);
    expect(b!.stop).toEqual({ by: 'user', at: T0 + 20 * 60_000 });
    expect(b!.stopX).toBeGreaterThan(290);
  });
});

describe('branchCaption', () => {
  it('says how many exchanges, and the state only when it calls for attention', () => {
    const turns = [{}, {}] as never[];
    expect(branchCaption({ turns, status: 'concluded' })).toBe('2 échanges');
    expect(branchCaption({ turns, status: 'waiting' })).toBe("2 échanges · t'attend");
    expect(branchCaption({ turns: [], status: 'running' })).toBe('en cours');
    // A stop by the human is the human's decision: the branch says so instead of looking idle.
    expect(branchCaption({ turns, status: 'idle', stop: { by: 'user', at: 0 } })).toBe('2 échanges · arrêté par toi');
  });
});
