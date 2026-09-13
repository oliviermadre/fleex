import { describe, it, expect } from 'vitest';
import { partitionQueue, parseInlineOptions, suggestionsFor, type QueueItem } from './selectors';

function item(over: Partial<QueueItem> & Pick<QueueItem, 'id' | 'activity'>): QueueItem {
  return {
    title: over.id,
    boardId: null,
    boardName: null,
    since: null,
    lastActivityAt: null,
    ...over,
  };
}

describe('partitionQueue', () => {
  it('splits tasks into needs / running / idle by activity', () => {
    const { needs, running, idle } = partitionQueue([
      item({ id: 'a', activity: 'waiting' }),
      item({ id: 'b', activity: 'running' }),
      item({ id: 'c', activity: 'idle' }),
      item({ id: 'd', activity: 'waiting' }),
    ]);
    expect(needs.map((t) => t.id)).toEqual(['a', 'd']);
    expect(running.map((t) => t.id)).toEqual(['b']);
    expect(idle.map((t) => t.id)).toEqual(['c']);
  });

  it('puts each task in exactly one section', () => {
    const tasks = [
      item({ id: 'a', activity: 'waiting' }),
      item({ id: 'b', activity: 'running' }),
      item({ id: 'c', activity: 'idle' }),
    ];
    const { needs, running, idle } = partitionQueue(tasks);
    expect(needs.length + running.length + idle.length).toBe(tasks.length);
  });

  it('orders NEEDS YOU oldest question first (since ascending)', () => {
    const { needs } = partitionQueue([
      item({ id: 'new', activity: 'waiting', since: 300 }),
      item({ id: 'old', activity: 'waiting', since: 100 }),
      item({ id: 'mid', activity: 'waiting', since: 200 }),
    ]);
    expect(needs.map((t) => t.id)).toEqual(['old', 'mid', 'new']);
  });

  it('orders RUNNING most recently started first (since descending)', () => {
    const { running } = partitionQueue([
      item({ id: 'early', activity: 'running', since: 100 }),
      item({ id: 'late', activity: 'running', since: 300 }),
    ]);
    expect(running.map((t) => t.id)).toEqual(['late', 'early']);
  });

  it('orders IDLE most recently active first (lastActivityAt descending)', () => {
    const { idle } = partitionQueue([
      item({ id: 'stale', activity: 'idle', lastActivityAt: 100 }),
      item({ id: 'fresh', activity: 'idle', lastActivityAt: 900 }),
    ]);
    expect(idle.map((t) => t.id)).toEqual(['fresh', 'stale']);
  });

  it('returns empty sections for an empty list', () => {
    expect(partitionQueue([])).toEqual({ needs: [], running: [], idle: [] });
  });
});

describe('suggestionsFor', () => {
  it('offers Move to Reviewing for a doing task', () => {
    const ids = suggestionsFor({ status: 'doing', type: 'build', hasPR: false }).map((s) => s.id);
    expect(ids).toContain('move-reviewing');
    expect(ids).not.toContain('mark-done');
  });

  it('offers Mark done for a reviewing task', () => {
    const ids = suggestionsFor({ status: 'reviewing', type: 'build', hasPR: false }).map((s) => s.id);
    expect(ids).toContain('mark-done');
    expect(ids).not.toContain('move-reviewing');
  });

  it('the status move is the first chip when present', () => {
    expect(suggestionsFor({ status: 'doing', type: 'build', hasPR: true })[0]?.id).toBe('move-reviewing');
  });

  it('adds the PM persona only for think tasks', () => {
    expect(suggestionsFor({ status: 'doing', type: 'think', hasPR: false }).map((s) => s.id)).toContain('see-with-pm');
    expect(suggestionsFor({ status: 'doing', type: 'build', hasPR: false }).map((s) => s.id)).not.toContain('see-with-pm');
  });

  it('a move chip carries its target status, a persona chip carries a mention', () => {
    const chips = suggestionsFor({ status: 'reviewing', type: 'build', hasPR: false });
    expect(chips.find((s) => s.id === 'mark-done')?.moveTo).toBe('done');
    expect(chips.find((s) => s.id === 'see-with-dev')?.mention).toBe('@agent:builder ');
  });
});

describe('parseInlineOptions', () => {
  it('parses inline lettered options', () => {
    expect(parseInlineOptions('a) Run now b) Wait')).toEqual(['Run now', 'Wait']);
  });

  it('parses lettered options with a dot', () => {
    expect(parseInlineOptions('A. Approve B. Read first')).toEqual(['Approve', 'Read first']);
  });

  it('parses inline numbered options', () => {
    expect(parseInlineOptions('1. Push it 2. Hold')).toEqual(['Push it', 'Hold']);
  });

  it('parses numbered options with a paren', () => {
    expect(parseInlineOptions('1) Run now 2) Wait 3) Cancel')).toEqual(['Run now', 'Wait', 'Cancel']);
  });

  it('parses a bulleted list across lines', () => {
    expect(parseInlineOptions('Choose:\n- Run now\n- Wait for rotation')).toEqual([
      'Run now',
      'Wait for rotation',
    ]);
  });

  it('parses bullets with • and *', () => {
    expect(parseInlineOptions('• Yes\n* No')).toEqual(['Yes', 'No']);
  });

  it('returns [] when there is no option list', () => {
    expect(parseInlineOptions('Should I run the migration on staging now?')).toEqual([]);
  });

  it('returns [] for a single option (needs at least two)', () => {
    expect(parseInlineOptions('a) Just do it')).toEqual([]);
  });

  it('returns [] for empty text', () => {
    expect(parseInlineOptions('')).toEqual([]);
  });

  it('does not treat a decimal number in prose as an option marker', () => {
    expect(parseInlineOptions('The budget is 1. something and 2. another thing?')).toBeInstanceOf(Array);
  });
});
