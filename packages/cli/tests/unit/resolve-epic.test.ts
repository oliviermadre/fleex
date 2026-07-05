import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveEpic, resolveEpicId } from '../../src/commands/epic/_shared.ts';

const EPICS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'alpha', emoji: '🅰️' },
  { id: 'aaaaaaaa-9999-8888-7777-666666666666', name: 'alpha-2' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'beta' },
];

describe('resolveEpic', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(EPICS);
  });

  it('resolves a full UUID to its record', async () => {
    const e = await resolveEpic('bbbbbbbb-1111-2222-3333-444444444444');
    expect(e.name).toBe('beta');
  });

  it('resolves a unique 8-char prefix', async () => {
    const e = await resolveEpic('bbbbbbbb');
    expect(e.name).toBe('beta');
  });

  it('tolerates a leading "#" copied from list output', async () => {
    const e = await resolveEpic('#bbbbbbbb');
    expect(e.name).toBe('beta');
  });

  it('exits on an ambiguous prefix instead of guessing the first match', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Both alpha epics share the "aaaaaaaa" prefix — mutating either would be wrong.
    await expect(resolveEpic('aaaaaaaa')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('exits when nothing matches', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveEpic('zzzz')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('resolveEpicId returns just the UUID', async () => {
    expect(await resolveEpicId('bbbbbbbb')).toBe('bbbbbbbb-1111-2222-3333-444444444444');
  });
});
