import { describe, it, expect } from 'vitest';
import { find, finderActive, finderCount, matches, NO_FINDER, stateOf, type Finder } from './finder';
import type { FactoryTicket, FactoryTicketInfo } from './types';

const ticket = (displayId: number, title: string, over: Partial<FactoryTicketInfo> = {}, phase: FactoryTicket['phase'] = 'belt'): FactoryTicket => ({
  ticketId: `t${displayId}`, machineId: 'm', x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '',
  info: { id: `t${displayId}`, displayId, title, type: 'build', priority: 'medium', status: 'todo', tags: [], boardId: 'core', complexity: null, favorite: false, ...over },
});
const waits = (t: FactoryTicket) => t.phase === 'review';
const all = [
  ticket(101, 'Implement jev as a native workflow step', { favorite: true, tags: ['workflows'] }),
  ticket(102, 'CSV export truncated', { type: 'fix', priority: 'urgent', boardId: 'support' }),
  ticket(210, 'Pricing: per seat or usage?', { type: '', priority: 'none', boardId: 'support' }, 'review'),
  ticket(11, 'Workflow editor crashes on paste', { type: 'fix', priority: 'high' }),
];
const ids = (f: Partial<Finder>) => find(all, { ...NO_FINDER, ...f }, waits)?.map((t) => t.info!.displayId);

describe('factory finder', () => {
  it('is off until something is asked for', () => {
    expect(finderActive(NO_FINDER)).toBe(false);
    expect(finderActive({ ...NO_FINDER, q: '  ' })).toBe(false);
    expect(ids({})).toBeUndefined();
    expect(matches(all[0]!, NO_FINDER, waits)).toBe(true);
  });

  it('finds by words of the title, by tag and by number', () => {
    expect(ids({ q: 'jev native' })).toEqual([101]);
    expect(ids({ q: 'WORKFLOW' })).toEqual([101, 11]);   // the favourite first, then by number
    expect(ids({ q: '#102' })).toEqual([102]);
    expect(ids({ q: '10' })).toEqual([101, 102, 210]);
    expect(ids({ q: 'nothing like it' })).toEqual([]);
  });

  it('filters by board, type, priority, favourite and who waits for a human, all together', () => {
    expect(ids({ boards: ['support'] })).toEqual([102, 210]);
    expect(ids({ types: ['fix'] })).toEqual([11, 102]);
    expect(ids({ types: ['none'] })).toEqual([210]);
    expect(ids({ priorities: ['urgent', 'high'] })).toEqual([11, 102]);
    expect(ids({ favorite: true })).toEqual([101]);
    expect(ids({ waiting: true })).toEqual([210]);
    expect(ids({ boards: ['support'], types: ['fix'], q: 'csv' })).toEqual([102]);
    expect(ids({ boards: ['core'], priorities: ['urgent'] })).toEqual([]);
  });

  it('filters by status, by the machine a ticket is in, and by where it stands', () => {
    const here = [
      { ...ticket(1, 'On a belt'), machineId: 'belt-1' }, { ...ticket(2, 'Queueing', { status: 'doing' }, 'wait'), machineId: 'spec' },
      { ...ticket(3, 'At the gate', { status: 'reviewing' }, 'review'), machineId: 'gate' }, { ...ticket(4, 'Failed', {}, 'failed'), machineId: 'spec' },
      { ...ticket(5, 'In a zone', {}, 'zone'), machineId: 'todo' },
    ];
    const got = (f: Partial<Finder>) => find(here, { ...NO_FINDER, ...f }, waits)!.map((t) => t.info!.displayId);
    expect(here.map(stateOf)).toEqual(['moving', 'queue', 'human', 'human', 'zone']);
    expect(got({ statuses: ['doing', 'reviewing'] })).toEqual([2, 3]);
    expect(got({ machines: ['spec'] })).toEqual([2, 4]);
    expect(got({ states: ['human'] })).toEqual([3, 4]);
    expect(got({ states: ['moving', 'zone'] })).toEqual([1, 5]);
    expect(got({ machines: ['spec'], states: ['human'] })).toEqual([4]);
  });

  it('filters by a range of complexity, with or without what is not estimated, and by what is blocked', () => {
    const sized = [ticket(1, 'tiny', { complexity: '1' }), ticket(2, 'medium', { complexity: '5' }), ticket(3, 'huge', { complexity: 'inf' }), ticket(4, 'unknown', { complexity: null }), ticket(5, 'stuck', { complexity: '5', blocked: true })];
    const got = (f: Partial<Finder>) => find(sized, { ...NO_FINDER, ...f }, waits)!.map((t) => t.info!.displayId);
    expect(got({ complexityMin: '3' })).toEqual([2, 3, 5]);
    expect(got({ complexityMax: '5' })).toEqual([1, 2, 5]);
    expect(got({ complexityMin: '2', complexityMax: '8' })).toEqual([2, 5]);
    expect(got({ unestimated: true })).toEqual([4]);
    expect(got({ complexityMin: '8', unestimated: true })).toEqual([3, 4]);
    expect(got({ blocked: true })).toEqual([5]);
  });

  it('counts the criteria that are set, the search aside', () => {
    expect(finderCount(NO_FINDER)).toBe(0);
    expect(finderCount({ ...NO_FINDER, q: 'x' })).toBe(0);
    expect(finderCount({ ...NO_FINDER, boards: ['a', 'b'], states: ['human'], complexityMin: '3', complexityMax: '8', blocked: true })).toBe(4);
    expect(finderActive({ ...NO_FINDER, unestimated: true })).toBe(true);
  });

  it('a ticket whose details are not loaded matches nothing', () => {
    const blank = { ...ticket(1, 'x'), info: null };
    expect(matches(blank, NO_FINDER, waits)).toBe(true);
    expect(matches(blank, { ...NO_FINDER, favorite: true }, waits)).toBe(false);
  });
});
