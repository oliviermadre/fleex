import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseGithubPrUrl,
  resolvePrRef,
  resolveIssueRef,
} from '../../src/commands/ticket/_shared.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseGithubPrUrl', () => {
  it('parses a canonical PR URL into org/name/number and a ref', () => {
    const r = parseGithubPrUrl('https://github.com/ODYS-TRAVEL/agentic-dmc/pull/100');
    expect(r).toEqual({
      org: 'ODYS-TRAVEL',
      name: 'agentic-dmc',
      number: 100,
      ref: 'ODYS-TRAVEL/agentic-dmc#100',
      url: 'https://github.com/ODYS-TRAVEL/agentic-dmc/pull/100',
    });
  });

  it('accepts http and a trailing slash', () => {
    const r = parseGithubPrUrl('http://github.com/org/name/pull/9/');
    expect(r.org).toBe('org');
    expect(r.name).toBe('name');
    expect(r.number).toBe(9);
    // canonical url is normalized (https, no trailing slash)
    expect(r.url).toBe('https://github.com/org/name/pull/9');
  });

  it('ignores a query string or fragment', () => {
    const r = parseGithubPrUrl('https://github.com/org/name/pull/42?foo=bar#issuecomment-1');
    expect(r.number).toBe(42);
    expect(r.ref).toBe('org/name#42');
  });

  it('rejects an issue URL (not a pull request)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubPrUrl('https://github.com/org/name/issues/42')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a non-github URL', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubPrUrl('https://gitlab.com/org/name/pull/42')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a malformed string', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseGithubPrUrl('not a url')).toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('resolvePrRef', () => {
  it('accepts a full PR URL (natural gh output)', () => {
    const r = resolvePrRef('https://github.com/oliviermadre/fleex/pull/12');
    expect(r.ref).toBe('oliviermadre/fleex#12');
    expect(r.url).toBe('https://github.com/oliviermadre/fleex/pull/12');
  });

  it('still accepts the org/name#N shortcut (no regression)', () => {
    const r = resolvePrRef('oliviermadre/fleex#12');
    expect(r.ref).toBe('oliviermadre/fleex#12');
    expect(r.url).toBe('https://github.com/oliviermadre/fleex/pull/12');
  });

  it('produces the same canonical ref from URL and shortcut (unlink symmetry)', () => {
    expect(resolvePrRef('https://github.com/o/r/pull/7').ref).toBe(resolvePrRef('o/r#7').ref);
  });
});

describe('resolveIssueRef', () => {
  it('accepts a full issue URL', () => {
    const r = resolveIssueRef('https://github.com/org/name/issues/45');
    expect(r.ref).toBe('org/name#45');
    expect(r.url).toBe('https://github.com/org/name/issues/45');
  });

  it('still accepts the org/name#N shortcut (no regression)', () => {
    const r = resolveIssueRef('org/name#45');
    expect(r.ref).toBe('org/name#45');
    expect(r.url).toBe('https://github.com/org/name/issues/45');
  });
});
