import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseGithubIssueUrl } from '../../src/commands/ticket/_shared.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseGithubIssueUrl', () => {
  it('parses a canonical issue URL into org/name/number and a ref', () => {
    const r = parseGithubIssueUrl('https://github.com/oliviermadre/fleex/issues/174');
    expect(r).toEqual({
      org: 'oliviermadre',
      name: 'fleex',
      number: 174,
      ref: 'oliviermadre/fleex#174',
      url: 'https://github.com/oliviermadre/fleex/issues/174',
    });
  });

  it('accepts http and a trailing slash', () => {
    const r = parseGithubIssueUrl('http://github.com/org/name/issues/9/');
    expect(r.org).toBe('org');
    expect(r.name).toBe('name');
    expect(r.number).toBe(9);
    // canonical url is normalized (https, no trailing slash)
    expect(r.url).toBe('https://github.com/org/name/issues/9');
  });

  it('ignores a query string or fragment', () => {
    const r = parseGithubIssueUrl('https://github.com/org/name/issues/42?foo=bar#comment-1');
    expect(r.number).toBe(42);
    expect(r.ref).toBe('org/name#42');
  });

  it('rejects a pull-request URL (not an issue)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubIssueUrl('https://github.com/org/name/pull/42')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a non-github URL', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubIssueUrl('https://gitlab.com/org/name/issues/42')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a malformed string', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubIssueUrl('not a url')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
