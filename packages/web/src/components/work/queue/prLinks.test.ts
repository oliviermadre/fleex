import { describe, it, expect } from 'vitest';
import type { TicketLink } from '@fleex/shared';
import { aggregatePrState, prLinksFor, toWorkPrState } from './prLinks';

const link = (ref: string, type: TicketLink['type'] = 'github_pr', url: string | null = null): TicketLink => ({
  id: ref, type, ref, label: ref, url, createdAt: 'now',
});

const details = (state: string, isDraft = false) => ({
  state, isDraft, title: 'Dispatcher admin UI', additions: 2331, deletions: 140, url: 'https://github.com/o/front/pull/1887',
});

describe('toWorkPrState', () => {
  it("maps GitHub's state and draft flag to the glyph's state", () => {
    expect(toWorkPrState(details('OPEN'))).toBe('open');
    expect(toWorkPrState(details('OPEN', true))).toBe('draft');
    expect(toWorkPrState(details('MERGED'))).toBe('merged');
    expect(toWorkPrState(details('CLOSED'))).toBe('closed');
    expect(toWorkPrState(undefined)).toBeNull();
  });
});

describe('prLinksFor', () => {
  it('keeps only well-formed github_pr links, in link order, merged with their details', () => {
    const links = [
      link('o/front#1887'),
      link('o/front', 'repository'),
      link('not-a-pr-ref'),
      link('o/back#412'),
    ];
    const prs = prLinksFor(links, { 'o/front#1887': details('OPEN') });

    expect(prs.map((p) => p.label)).toEqual(['front#1887', 'back#412']);
    expect(prs[0]).toMatchObject({ state: 'open', title: 'Dispatcher admin UI', additions: 2331, deletions: 140 });
    expect(prs[1]).toMatchObject({ state: null, title: null, additions: null });
  });

  it("opens the link's own URL first, then GitHub's, then a URL built from the ref", () => {
    expect(prLinksFor([link('o/front#1', 'github_pr', 'https://pasted')], { 'o/front#1': details('OPEN') })[0]!.url)
      .toBe('https://pasted');
    expect(prLinksFor([link('o/front#1887')], { 'o/front#1887': details('OPEN') })[0]!.url)
      .toBe('https://github.com/o/front/pull/1887');
    expect(prLinksFor([link('o/back#412')], {})[0]!.url).toBe('https://github.com/o/back/pull/412');
  });
});

describe('aggregatePrState', () => {
  it('shows the most actionable state: open, then draft, then merged, then closed', () => {
    expect(aggregatePrState([{ state: 'merged' }, { state: 'open' }])).toBe('open');
    expect(aggregatePrState([{ state: 'closed' }, { state: 'merged' }, { state: 'draft' }])).toBe('draft');
    expect(aggregatePrState([{ state: 'closed' }, { state: 'merged' }])).toBe('merged');
    expect(aggregatePrState([{ state: 'closed' }])).toBe('closed');
  });

  it('is unknown while no state has loaded', () => {
    expect(aggregatePrState([{ state: null }, { state: null }])).toBeNull();
  });
});
