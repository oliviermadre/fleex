import { describe, it, expect } from 'vitest';
import { slugify, slugifyOr, assignSlugs } from '../../src/scripts/okf/slugify.js';

describe('slugify', () => {
  it('lowercases, strips diacritics and replaces non-alphanumerics with dashes', () => {
    expect(slugify('Créer un Ticket génial!')).toBe('creer-un-ticket-genial');
  });

  it('trims and collapses dashes', () => {
    expect(slugify('  --Hello---World--  ')).toBe('hello-world');
  });

  it('is deterministic for identical input', () => {
    const s = 'Export de la knowledge Fleex → OKF';
    expect(slugify(s)).toBe(slugify(s));
  });

  it('truncates to 60 chars without leaving a trailing dash', () => {
    const long = 'a'.repeat(58) + ' bbbbb';
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-')).toBe(false);
  });

  it('returns empty string when nothing remains, fallback fills it', () => {
    expect(slugify('🚀🚀🚀')).toBe('');
    expect(slugifyOr('🚀🚀🚀')).toBe('untitled');
  });
});

describe('assignSlugs', () => {
  it('keeps bare slugs when there is no collision', () => {
    const items = [
      { id: 'a1', name: 'Alpha' },
      { id: 'b2', name: 'Beta' },
    ];
    const map = assignSlugs(items, (i) => i.id, (i) => i.name);
    expect(map.get('a1')).toBe('alpha');
    expect(map.get('b2')).toBe('beta');
  });

  it('disambiguates ALL colliding slugs with the id prefix (order-independent)', () => {
    const items = [
      { id: 'deadbeef-1', name: 'Same Name' },
      { id: 'feedface-2', name: 'Same Name' },
    ];
    const map = assignSlugs(items, (i) => i.id, (i) => i.name);
    expect(map.get('deadbeef-1')).toBe('same-name-deadbeef');
    expect(map.get('feedface-2')).toBe('same-name-feedface');
  });
});
