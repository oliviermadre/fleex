import { describe, it, expect } from 'vitest';
import { decodeWikiTarget, preprocessWikiLinks, WIKI_LINK_HREF_PREFIX } from './wiki';

describe('preprocessWikiLinks', () => {
  it('encodes a ticket reference', () => {
    expect(preprocessWikiLinks('see [[#42]]')).toBe('see [#42](#fleex-wiki:%2342)');
  });

  it('encodes a repo note', () => {
    // The slash is escaped: an unencoded one is legal in a destination, but
    // encoding uniformly keeps the decode side a single rule.
    expect(preprocessWikiLinks('[[org/app]]')).toBe('[org/app](#fleex-wiki:org%2Fapp)');
  });

  it('normalises the global note to its key', () => {
    const out = preprocessWikiLinks('[[global]]');
    expect(decodeWikiTarget(out.slice(out.indexOf(WIKI_LINK_HREF_PREFIX), out.length - 1))).toBe('__global__');
  });

  it('keeps the alias as the label and the target in the href', () => {
    expect(preprocessWikiLinks('[[#42|the login bug]]')).toBe('[the login bug](#fleex-wiki:%2342)');
  });

  it('leaves an unresolvable target verbatim', () => {
    // Deciding what an arbitrary phrase points at needs the database; a chip that
    // leads nowhere is worse than the brackets the author typed.
    expect(preprocessWikiLinks('[[the auth module]]')).toBe('[[the auth module]]');
  });

  it('returns the input untouched when there is nothing to encode', () => {
    const text = 'plain prose with [a link](https://example.com)';
    expect(preprocessWikiLinks(text)).toBe(text);
  });

  it('encodes several links in one document', () => {
    expect(preprocessWikiLinks('[[#1]] and [[#2]]'))
      .toBe('[#1](#fleex-wiki:%231) and [#2](#fleex-wiki:%232)');
  });

  it('leaves links inside an inline code span alone', () => {
    expect(preprocessWikiLinks('type `[[#42]]` to link')).toBe('type `[[#42]]` to link');
  });

  it('leaves links inside a fenced block alone', () => {
    const text = '```\n[[org/app]]\n```';
    expect(preprocessWikiLinks(text)).toBe(text);
  });

  it('encodes a link outside a code span in the same line', () => {
    expect(preprocessWikiLinks('`[[#1]]` but [[#2]]'))
      .toBe('`[[#1]]` but [#2](#fleex-wiki:%232)');
  });

  it('escapes a bracket in a label so it cannot open a nested link', () => {
    // The shared parser rejects `]` inside an alias, so `[` is the only bracket
    // that can reach the encoder — and unescaped it would swallow the destination.
    expect(preprocessWikiLinks('[[#42|a [draft fix]]'))
      .toBe('[a \\[draft fix](#fleex-wiki:%2342)');
  });

  it('adds no lines, so checkbox indices stay valid', () => {
    const text = '- [ ] check [[#42]]\n- [ ] and [[org/app]]';
    expect(preprocessWikiLinks(text).split('\n')).toHaveLength(2);
  });

  it('lowercases a repo key the way the note list does', () => {
    expect(preprocessWikiLinks('[[Org/App]]')).toBe('[Org/App](#fleex-wiki:org%2Fapp)');
  });
});

describe('decodeWikiTarget', () => {
  it('round-trips a repo key', () => {
    expect(decodeWikiTarget(`${WIKI_LINK_HREF_PREFIX}org%2Fapp`)).toBe('org/app');
  });

  it('round-trips a ticket reference', () => {
    expect(decodeWikiTarget(`${WIKI_LINK_HREF_PREFIX}%2342`)).toBe('#42');
  });
});
