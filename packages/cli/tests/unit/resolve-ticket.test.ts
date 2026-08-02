import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert branching without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveAnyTicketUuid } from '../../src/commands/ticket/_shared.ts';

const UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

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
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveAnyTicketUuid('not-an-id')).rejects.toThrow('exit');
    expect(apiGet).not.toHaveBeenCalled();
    exit.mockRestore();
    stderr.mockRestore();
  });
});
