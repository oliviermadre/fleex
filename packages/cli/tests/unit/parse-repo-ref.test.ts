import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseRepoRef } from '../../src/commands/ticket/_shared.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseRepoRef', () => {
  it('parses a plain org/name with no base branch', () => {
    expect(parseRepoRef('evaneos/odys-front')).toEqual({
      ref: 'evaneos/odys-front',
      org: 'evaneos',
      name: 'odys-front',
    });
  });

  it('parses org/name@base into a base branch', () => {
    expect(parseRepoRef('evaneos/odys-front@feat/big-refacto')).toEqual({
      ref: 'evaneos/odys-front',
      org: 'evaneos',
      name: 'odys-front',
      baseBranch: 'feat/big-refacto',
    });
  });

  it('keeps a base branch that itself contains slashes', () => {
    expect(parseRepoRef('org/name@feat/a/b').baseBranch).toBe('feat/a/b');
  });

  it('rejects a malformed repo (no slash)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseRepoRef('notarepo')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects an @ with no branch after it', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseRepoRef('org/name@')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
