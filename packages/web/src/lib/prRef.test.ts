import { describe, it, expect } from 'vitest';
import { comparePrs, parseGithubPrRef, sortPrLinks } from './prRef';

describe('parseGithubPrRef', () => {
  it('parses the canonical org/name#number ref', () => {
    expect(parseGithubPrRef('oliviermadre/fleex#204')).toEqual({ org: 'oliviermadre', name: 'fleex', number: 204 });
  });

  it('handles a ref with no org (name#number)', () => {
    expect(parseGithubPrRef('fleex#215')).toEqual({ org: '', name: 'fleex', number: 215 });
  });

  it('returns null when there is no number', () => {
    expect(parseGithubPrRef('oliviermadre/fleex')).toBeNull();
  });

  it('returns null for a non-numeric suffix', () => {
    expect(parseGithubPrRef('oliviermadre/fleex#abc')).toBeNull();
  });

  it('uses the last # so branch names with # do not break parsing', () => {
    expect(parseGithubPrRef('org/name#12')).toEqual({ org: 'org', name: 'name', number: 12 });
  });
});

describe('PR order', () => {
  it('sorts by org/repo (case-insensitive), then PR number — not as text', () => {
    const prs = [
      { org: 'acme', name: 'web', number: 3 },
      { org: 'Acme', name: 'api', number: 12 },
      { org: 'acme', name: 'api', number: 9 },
      { org: 'zeta', name: 'app', number: 1 },
      { org: 'acme', name: 'web', number: 100 },
    ];
    expect([...prs].sort(comparePrs).map((p) => `${p.org}/${p.name}#${p.number}`)).toEqual([
      'acme/api#9', 'Acme/api#12', 'acme/web#3', 'acme/web#100', 'zeta/app#1',
    ]);
  });

  it('sorts links the same way, unparsable refs last', () => {
    const links = [{ ref: 'acme/web#2' }, { ref: 'garbage' }, { ref: 'acme/api#10' }, { ref: 'acme/api#2' }];
    expect(sortPrLinks(links).map((l) => l.ref)).toEqual(['acme/api#2', 'acme/api#10', 'acme/web#2', 'garbage']);
  });
});
