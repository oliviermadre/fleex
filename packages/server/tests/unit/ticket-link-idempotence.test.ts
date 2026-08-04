import { describe, it, expect } from 'vitest';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

function ticket(): TicketEntity {
  return TicketEntity.create({ id: 'T1', boardId: 'B1', displayId: 1, title: 'Test' });
}

const PR = 'oliviermadre/fleex#265';
const PR_URL = 'https://github.com/oliviermadre/fleex/pull/265';

describe('TicketEntity.addLink — idempotence on (type, ref)', () => {
  it('does not create a second row when the same PR is linked twice', () => {
    // The real-world trigger: a caller cannot see the link it just wrote (stale
    // client, failed read), assumes the write was lost, and retries. The retry
    // must be a no-op, not a duplicate — a ticket showing the same PR twice is
    // the visible symptom users report.
    const t = ticket();
    t.addLink('github_pr', PR, `#265`, PR_URL, 'link-1');
    t.addLink('github_pr', PR, `#265`, PR_URL, 'link-2');

    expect(t.links).toHaveLength(1);
    expect(t.links[0]!.id).toBe('link-1');
  });

  it('returns the pre-existing link, so a caller can tell a create from a no-op', () => {
    // The route relies on this to decide whether to emit an event and write an
    // activity entry. Returning a fresh object here would make every retry look
    // like a real write in the audit trail.
    const t = ticket();
    const first = t.addLink('github_pr', PR, '#265', PR_URL, 'link-1');
    const second = t.addLink('github_pr', PR, '#265', PR_URL, 'link-2');

    expect(second).toBe(first);
    expect(second.id).toBe('link-1');
  });

  it('leaves updatedAt untouched on a duplicate', async () => {
    // A write with no effect must stay invisible: bumping the clock would sort
    // the ticket to the top of "recently modified" for nothing.
    const t = ticket();
    t.addLink('github_pr', PR, '#265', PR_URL, 'link-1');
    const after = t.updatedAt.getTime();

    await new Promise((r) => setTimeout(r, 2));
    t.addLink('github_pr', PR, '#265', PR_URL, 'link-2');

    expect(t.updatedAt.getTime()).toBe(after);
  });

  it('still adds a link that differs by ref or by type', () => {
    // Idempotence keys on the pair, not on either half: two PRs from the same
    // repo, and a repo link next to a PR link, are all distinct links.
    const t = ticket();
    t.addLink('github_pr', PR, '#265', PR_URL, 'l1');
    t.addLink('github_pr', 'oliviermadre/fleex#266', '#266', null, 'l2');
    t.addLink('github_issue', PR, '#265', null, 'l3');
    t.addLink('repository', 'oliviermadre/fleex', 'fleex', null, 'l4');

    expect(t.links.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it('keeps the original label and url rather than overwriting them', () => {
    // A retry often carries a thinner payload than the first call. Silently
    // downgrading a good label to a worse one would be a second no-op bug.
    const t = ticket();
    t.addLink('github_pr', PR, 'PR #265 — parity fix', PR_URL, 'l1');
    t.addLink('github_pr', PR, PR, null, 'l2');

    expect(t.links).toHaveLength(1);
    expect(t.links[0]!.label).toBe('PR #265 — parity fix');
    expect(t.links[0]!.url).toBe(PR_URL);
  });
});

describe('TicketEntity.findLink', () => {
  it('finds by the identity pair and ignores near-misses', () => {
    const t = ticket();
    t.addLink('github_pr', PR, '#265', PR_URL, 'l1');

    expect(t.findLink('github_pr', PR)?.id).toBe('l1');
    expect(t.findLink('github_issue', PR)).toBeUndefined();
    expect(t.findLink('github_pr', 'oliviermadre/fleex#999')).toBeUndefined();
  });
});
