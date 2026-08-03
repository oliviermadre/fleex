import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert branching without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveAnyTicketUuid, resolveTicketId } from '../../src/commands/ticket/_shared.ts';
import { resetBoardCache } from '../../src/commands/board/_shared.ts';

const UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const BOARD_UUID = 'dddddddd-1111-2222-3333-444444444444';

describe('resolveAnyTicketUuid', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('returns a full UUID unchanged, without calling the API', async () => {
    expect(await resolveAnyTicketUuid(UUID)).toBe(UUID);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('strips a leading "#" from a UUID', async () => {
    expect(await resolveAnyTicketUuid(`#${UUID}`)).toBe(UUID);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('resolves a display id through GET /api/tickets/:id (spans archived)', async () => {
    apiGet.mockResolvedValue({ id: 'resolved-uuid' });
    const result = await resolveAnyTicketUuid('42');
    expect(result).toBe('resolved-uuid');
    expect(apiGet).toHaveBeenCalledWith('http://localhost:9999/api/tickets/42');
  });

  it('strips a leading "#" from a display id before resolving', async () => {
    apiGet.mockResolvedValue({ id: 'resolved-uuid' });
    await resolveAnyTicketUuid('#42');
    expect(apiGet).toHaveBeenCalledWith('http://localhost:9999/api/tickets/42');
  });

  it('dies on input that is neither a UUID nor a display id', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveAnyTicketUuid('not-an-id')).rejects.toThrow('exit');
    expect(apiGet).not.toHaveBeenCalled();
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('resolveTicketId --board handling', () => {
  beforeEach(() => {
    apiGet.mockReset();
    resetBoardCache();
  });

  it('resolves a board name/prefix to a UUID before filtering tickets', async () => {
    // The API only understands full board UUIDs — passing through the 8-char id
    // shown by `board list` is what produced "Board not found: dddddddd".
    apiGet.mockImplementation(async (url: string) => {
      if (url.includes('/api/boards')) return [{ id: BOARD_UUID, name: 'Roadmap' }];
      return [{ id: UUID, displayId: 42, title: 't', boardId: BOARD_UUID }];
    });

    expect(await resolveTicketId('42', 'dddddddd')).toBe(UUID);
    const ticketsUrl = apiGet.mock.calls.map((c) => c[0] as string).find((u) => u.includes('/api/tickets'));
    expect(ticketsUrl).toContain(`boardId=${BOARD_UUID}`);
  });

  it('accepts a board name just like the epic commands do', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.includes('/api/boards')) return [{ id: BOARD_UUID, name: 'Roadmap' }];
      return [{ id: UUID, displayId: 42, title: 't', boardId: BOARD_UUID }];
    });

    await resolveTicketId('42', 'roadmap');
    const ticketsUrl = apiGet.mock.calls.map((c) => c[0] as string).find((u) => u.includes('/api/tickets'));
    expect(ticketsUrl).toContain(`boardId=${BOARD_UUID}`);
  });

  it('does not fetch boards when the ticket is already a UUID', async () => {
    // The UUID short-circuit must stay ahead of board resolution: no wasted call.
    expect(await resolveTicketId(UUID, 'dddddddd')).toBe(UUID);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
