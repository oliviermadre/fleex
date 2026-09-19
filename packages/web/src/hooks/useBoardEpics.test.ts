import { describe, it, expect } from 'vitest';
import type { TicketGroup } from '@fleex/shared';
import { mergeBoardEpics } from './useBoardEpics';

// The board's epics are fetched once; live (WebSocket) updates land in the
// shared store, which may also hold other boards' epics.
describe('mergeBoardEpics', () => {
  it("takes the live version of a fetched epic and adds new ones of the board, ignoring other boards'", () => {
    const fetched = [epic('e1', 'Checkout', ['b1'])];
    const store = [epic('e1', 'Checkout v2', ['b1']), epic('e2', 'Search', ['b1']), epic('e3', 'Other', ['b2'])];

    expect(mergeBoardEpics(fetched, store, 'b1').map((g) => [g.id, g.name])).toEqual([
      ['e1', 'Checkout v2'],
      ['e2', 'Search'],
    ]);
  });
});

function epic(id: string, name: string, boardIds: string[]): TicketGroup {
  return {
    id,
    boardIds,
    name,
    emoji: '🚀',
    color: 'blue',
    description: '',
    timeframe: 'now',
    groupStatus: 'active',
    blocked: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
