import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveToken } from '../../src/commands/token/_shared.ts';

const TOKENS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'ci-bot', prefix: 'flx_aaa' },
  { id: 'aaaaaaaa-9999-8888-7777-666666666666', name: 'deploy-bot', prefix: 'flx_bbb' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'release-bot', prefix: 'flx_ccc' },
];

describe('resolveToken', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(TOKENS);
  });

  it('resolves a full UUID to its record', async () => {
    const t = await resolveToken('bbbbbbbb-1111-2222-3333-444444444444');
    expect(t.name).toBe('release-bot');
  });

  it('resolves a unique 8-char prefix', async () => {
    const t = await resolveToken('bbbbbbbb');
    expect(t.name).toBe('release-bot');
  });

  it('tolerates a leading "#" copied from list output', async () => {
    const t = await resolveToken('#bbbbbbbb');
    expect(t.name).toBe('release-bot');
  });

  it('falls back to a case-insensitive exact name match', async () => {
    const t = await resolveToken('CI-BOT');
    expect(t.id).toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('exits on an ambiguous id prefix instead of guessing', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Both bots share the "aaaaaaaa" prefix — revoking either would be wrong.
    await expect(resolveToken('aaaaaaaa')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('exits when nothing matches', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveToken('nope')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});
