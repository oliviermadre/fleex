import { describe, it, expect } from 'vitest';
import type { TicketGroup, TicketGroupStatus } from '@fleex/shared';
import { epicOptions, repoOptions } from './draftOptions';

describe('repoOptions', () => {
  const repos = ['acme/api', 'acme/docs', 'acme/infra', 'acme/mobile', 'acme/web'];

  it("lists the board's top three repos first, under Suggested, without repeating them below", () => {
    const options = repoOptions(repos, ['acme/web', 'acme/api', 'acme/infra', 'acme/docs']);

    expect(options.map((o) => [o.group, o.value])).toEqual([
      ['Suggested', 'acme/web'],
      ['Suggested', 'acme/api'],
      ['Suggested', 'acme/infra'],
      ['All repos', 'acme/docs'],
      ['All repos', 'acme/mobile'],
    ]);
  });

  it('skips ranked repos that are no longer configured', () => {
    const options = repoOptions(repos, ['gone/repo', 'acme/web']);

    expect(options.filter((o) => o.group === 'Suggested').map((o) => o.value)).toEqual(['acme/web']);
  });

  it('lists the repos without sections when the board has no repo history', () => {
    const options = repoOptions(repos, []);

    expect(options.map((o) => o.value)).toEqual(repos);
    expect(options.every((o) => o.group === undefined)).toBe(true);
  });
});

describe('epicOptions', () => {
  it('offers only the active epics, with their emoji', () => {
    const options = epicOptions([
      epic('e1', 'Checkout', 'active'),
      epic('e2', 'Old launch', 'done'),
      epic('e3', 'Dropped', 'cancelled'),
      epic('e4', 'Archived', 'archived'),
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ value: 'e1', label: 'Checkout' });
    expect(options[0]!.icon).toBeTruthy();
  });
});

function epic(id: string, name: string, groupStatus: TicketGroupStatus): TicketGroup {
  return {
    id,
    boardIds: ['b1'],
    name,
    emoji: '🚀',
    color: 'blue',
    description: '',
    timeframe: 'now',
    groupStatus,
    blocked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
