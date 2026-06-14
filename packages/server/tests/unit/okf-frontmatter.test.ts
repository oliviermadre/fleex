import { describe, it, expect } from 'vitest';
import { frontmatter } from '../../src/scripts/okf/frontmatter.js';

describe('frontmatter', () => {
  it('emits keys in the exact order given, never object-insertion order', () => {
    const out = frontmatter([
      ['type', 'Fleex Ticket'],
      ['title', 'Hello'],
      ['fleex_id', 'abc'],
    ]);
    expect(out).toBe('---\ntype: Fleex Ticket\ntitle: Hello\nfleex_id: abc\n---');
  });

  it('omits undefined keys but keeps explicit null', () => {
    const out = frontmatter([
      ['a', undefined],
      ['b', null],
      ['c', 'x'],
    ]);
    expect(out).toBe('---\nb: null\nc: x\n---');
  });

  it('quotes strings that would otherwise be misparsed', () => {
    expect(frontmatter([['t', '🔨 The Builder']])).toBe('---\nt: "🔨 The Builder"\n---');
    expect(frontmatter([['t', 'has: colon']])).toBe('---\nt: "has: colon"\n---');
    expect(frontmatter([['t', 'true']])).toBe('---\nt: "true"\n---');
    expect(frontmatter([['t', '42']])).toBe('---\nt: "42"\n---');
    expect(frontmatter([['t', '']])).toBe('---\nt: ""\n---');
  });

  it('renders booleans, numbers and flow lists', () => {
    expect(frontmatter([['b', true]])).toBe('---\nb: true\n---');
    expect(frontmatter([['n', 7]])).toBe('---\nn: 7\n---');
    expect(frontmatter([['tags', ['ticket', 'doing', 'high']]])).toBe(
      '---\ntags: [ticket, doing, high]\n---',
    );
    expect(frontmatter([['tags', []]])).toBe('---\ntags: []\n---');
  });

  it('escapes quotes and newlines inside quoted strings', () => {
    expect(frontmatter([['t', 'a "b"\nc']])).toBe('---\nt: "a \\"b\\"\\nc"\n---');
  });
});
