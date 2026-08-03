import { describe, it, expect } from 'vitest';
import { BoardNotFoundError } from '../../src/domain/errors.ts';

describe('BoardNotFoundError', () => {
  it('hints at the reference shape when the id is not a full UUID', () => {
    // Listings show 8-char ids, so callers paste them back into the API and get
    // a 404 that reads like the board is gone. Say what actually went wrong,
    // otherwise agents retry the same broken call.
    const e = new BoardNotFoundError('aad33682');
    expect(e.message).toContain('Board not found: aad33682');
    expect(e.message).toContain('not a full board UUID');
    expect(e.code).toBe('BOARD_NOT_FOUND');
  });

  it('hints for a board name too', () => {
    expect(new BoardNotFoundError('Fleex').message).toContain('not a full board UUID');
  });

  it('stays terse for a well-formed UUID — there the board really is absent', () => {
    const e = new BoardNotFoundError('aad33682-bcf2-4112-9060-1a4522a8f1d6');
    expect(e.message).toBe('Board not found: aad33682-bcf2-4112-9060-1a4522a8f1d6');
  });
});
