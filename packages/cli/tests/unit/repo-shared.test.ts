import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseRepo } from '../../src/commands/repo/_shared.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseRepo', () => {
  it('parses a valid org/name reference', () => {
    expect(parseRepo('oliviermadre/fleex')).toEqual({
      org: 'oliviermadre',
      name: 'fleex',
      slug: 'oliviermadre/fleex',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseRepo('  org/name  ').slug).toBe('org/name');
  });

  it('rejects a bare name without org', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseRepo('fleex')).toThrow();
  });

  it('rejects a three-part path', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseRepo('a/b/c')).toThrow();
  });
});
