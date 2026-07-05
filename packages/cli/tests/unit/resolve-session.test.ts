import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveSession, assertValidSessionType } from '../../src/commands/session/_shared.ts';

const SESSIONS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', type: 'shell', status: 'running', cwd: '/a', displayName: 'build' },
  { id: 'aaaaaaaa-9999-8888-7777-666666666666', type: 'claude', status: 'running', cwd: '/b', displayName: 'review' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', type: 'shell', status: 'dead', cwd: '/c', displayName: 'logs' },
];

describe('resolveSession', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(SESSIONS);
  });

  it('resolves a unique 8-char id prefix', async () => {
    const s = await resolveSession('bbbbbbbb');
    expect(s.displayName).toBe('logs');
  });

  it('falls back to an exact (case-insensitive) display name', async () => {
    const s = await resolveSession('REVIEW');
    expect(s.id).toBe('aaaaaaaa-9999-8888-7777-666666666666');
  });

  it('prefers an id prefix and exits when it is ambiguous (never guesses)', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Both "aaaaaaaa" sessions share the prefix — killing either would be wrong.
    await expect(resolveSession('aaaaaaaa')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('exits when nothing matches by id or name', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveSession('nope')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('assertValidSessionType', () => {
  it('accepts shell and claude', () => {
    expect(() => assertValidSessionType('shell')).not.toThrow();
    expect(() => assertValidSessionType('claude')).not.toThrow();
  });

  it('rejects anything else', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => assertValidSessionType('tmux')).toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});
