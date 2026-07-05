import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import { resolveRunId, resolveStepRunId, type RunDetail } from '../../src/commands/workflow/_shared.ts';

// A full-UUID ticket makes resolveTicketId short-circuit (no /api/tickets fetch),
// so the only apiGet call under test is the ticket-scoped run list.
const TICKET = 'ffffffff-1111-2222-3333-444444444444';

const RUNS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'running', templateSnapshot: { name: 'alpha' } },
  { id: 'aaaaaaaa-9999-8888-7777-666666666666', status: 'done', templateSnapshot: { name: 'alpha-2' } },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', status: 'running', templateSnapshot: { name: 'beta' } },
];

describe('resolveRunId', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(RUNS);
  });

  it('returns a full UUID as-is without any lookup (no ticket needed)', async () => {
    const id = await resolveRunId('bbbbbbbb-1111-2222-3333-444444444444');
    expect(id).toBe('bbbbbbbb-1111-2222-3333-444444444444');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('exits on a short prefix when no --ticket is given (nothing to match against)', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveRunId('bbbbbbbb')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('resolves a full UUID via the ticket-scoped list', async () => {
    const id = await resolveRunId('bbbbbbbb-1111-2222-3333-444444444444', TICKET);
    expect(id).toBe('bbbbbbbb-1111-2222-3333-444444444444');
  });

  it('resolves a unique 8-char prefix within a ticket', async () => {
    const id = await resolveRunId('bbbbbbbb', TICKET);
    expect(id).toBe('bbbbbbbb-1111-2222-3333-444444444444');
  });

  it('tolerates a leading "#" copied from list output', async () => {
    const id = await resolveRunId('#bbbbbbbb', TICKET);
    expect(id).toBe('bbbbbbbb-1111-2222-3333-444444444444');
  });

  it('exits on an ambiguous prefix instead of guessing the first match', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Both alpha runs share the "aaaaaaaa" prefix — cancelling either would be wrong.
    await expect(resolveRunId('aaaaaaaa', TICKET)).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('exits when nothing matches within the ticket', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveRunId('zzzz', TICKET)).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('resolveStepRunId', () => {
  const DETAIL: RunDetail = {
    run: { id: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'running' },
    stepRuns: [
      { id: 'cccccccc-1111-2222-3333-444444444444', stepId: 'gate', attempt: 1, status: 'waiting' },
      { id: 'cccccccc-9999-8888-7777-666666666666', stepId: 'gate2', attempt: 1, status: 'waiting' },
      { id: 'dddddddd-1111-2222-3333-444444444444', stepId: 'run', attempt: 1, status: 'failed' },
    ],
  };

  it('resolves a full step-run UUID', () => {
    expect(resolveStepRunId(DETAIL, 'dddddddd-1111-2222-3333-444444444444'))
      .toBe('dddddddd-1111-2222-3333-444444444444');
  });

  it('resolves a unique 8-char prefix', () => {
    expect(resolveStepRunId(DETAIL, 'dddddddd')).toBe('dddddddd-1111-2222-3333-444444444444');
  });

  it('exits on an ambiguous prefix instead of guessing', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => resolveStepRunId(DETAIL, 'cccccccc')).toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('exits when nothing matches', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => resolveStepRunId(DETAIL, 'zzzz')).toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});
