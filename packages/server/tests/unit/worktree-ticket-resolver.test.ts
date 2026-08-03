import { describe, it, expect } from 'vitest';

import { parseTicketBranch } from '../../src/domain/services/worktree-ticket-resolver.js';

describe('parseTicketBranch', () => {
  it('extracts the 6-hex id prefix from a ticket/ branch', () => {
    expect(parseTicketBranch('ticket/f0d211-from-362-r-duire-la-quadruple-duplicatio')).toEqual({
      idPrefix: 'f0d211',
    });
  });

  it('lowercases the id prefix', () => {
    expect(parseTicketBranch('ticket/9F2303-refonte-de-la-config')).toEqual({ idPrefix: '9f2303' });
  });

  it('extracts the display id from an agent/ branch', () => {
    expect(parseTicketBranch('agent/381-activit-sur-un-ticket')).toEqual({ displayId: 381 });
  });

  it('handles multi-digit display ids', () => {
    expect(parseTicketBranch('agent/404-co-t-cumul-des-tickets')).toEqual({ displayId: 404 });
  });

  it('returns null for the default branch', () => {
    expect(parseTicketBranch('main')).toBeNull();
  });

  it('returns null for a non-conventional branch', () => {
    expect(parseTicketBranch('feature/some-manual-branch')).toBeNull();
  });

  it('does not match a ticket/ branch whose segment is shorter than 6 hex chars', () => {
    expect(parseTicketBranch('ticket/abc-too-short')).toBeNull();
  });
});
