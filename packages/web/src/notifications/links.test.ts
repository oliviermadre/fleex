import { describe, it, expect } from 'vitest';
import { ticketLink } from './links';
import { parseUrl } from '../router/RouterSync';

// Notification and "open this ticket" links land in the Work view (the
// ticket-detail screen is retired), on the panel the old tab now lives in.
describe('ticketLink', () => {
  it('maps each former ticket-detail tab to its place in the Work view', () => {
    expect(ticketLink('t1')).toBe('/work/t1');
    expect(ticketLink('t1', 'comments')).toBe('/work/t1');
    expect(ticketLink('t1', 'deliverables')).toBe('/work/t1?panel=deliv');
    expect(ticketLink('t1', 'mentions')).toBe('/work/t1?panel=mentions');
    expect(ticketLink('t1', 'workflow')).toBe('/work/t1/workflow');
    expect(ticketLink('t1', 'activity')).toBe('/work/t1?panel=timeline');
  });

  it('produces URLs the router understands (a deliverable notification opens the deliverables panel)', () => {
    const [path, search] = ticketLink('t1', 'deliverables').split('?');
    expect(parseUrl(path!, `?${search}`).work).toEqual({ view: 'task', ticketId: 't1', mode: 'chat', panel: 'deliv' });
  });
});
