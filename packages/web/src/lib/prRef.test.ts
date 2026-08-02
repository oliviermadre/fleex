import { describe, it, expect } from 'vitest';

import { parseGithubPrRef } from './prRef';

describe('parseGithubPrRef', () => {
  it('parses the canonical org/name#number ref', () => {
    expect(parseGithubPrRef('oliviermadre/fleex#204')).toEqual({
      org: 'oliviermadre',
      name: 'fleex',
      number: 204,
    });
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
