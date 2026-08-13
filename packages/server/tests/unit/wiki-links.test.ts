import { describe, it, expect } from 'vitest';
import { parseWikiLinks, collectWikiLinkTargets, linksTo } from '@fleex/shared';

describe('parseWikiLinks', () => {
  it('finds a plain link', () => {
    const [link] = parseWikiLinks('see [[#42]] for context');
    expect(link).toMatchObject({ target: '#42', label: '#42', kind: 'ticket', ticketDisplayId: 42 });
  });

  it('uses the alias as the label when one is given', () => {
    const [link] = parseWikiLinks('see [[#42|the login bug]]');
    expect(link).toMatchObject({ target: '#42', label: 'the login bug', kind: 'ticket' });
  });

  it('classifies a repo reference as a scratchpad', () => {
    const [link] = parseWikiLinks('notes in [[org/app]]');
    expect(link).toMatchObject({ kind: 'scratchpad', scratchpadKey: 'org/app' });
  });

  it('lowercases a repo key so links match however they were typed', () => {
    const [link] = parseWikiLinks('[[Org/App]]');
    expect(link?.scratchpadKey).toBe('org/app');
  });

  it('recognises the global note', () => {
    expect(parseWikiLinks('[[global]]')[0]).toMatchObject({ kind: 'scratchpad', scratchpadKey: '__global__' });
    expect(parseWikiLinks('[[Global]]')[0]?.scratchpadKey).toBe('__global__');
  });

  it('marks anything else unresolved rather than guessing', () => {
    // Deciding what an arbitrary phrase refers to needs the database, so the
    // parser declines instead of inventing a target.
    expect(parseWikiLinks('[[some idea]]')[0]).toMatchObject({ kind: 'unresolved' });
  });

  it('reports offsets so a renderer can splice the source', () => {
    const text = 'before [[#7]] after';
    const [link] = parseWikiLinks(text);
    expect(text.slice(link!.start, link!.end)).toBe('[[#7]]');
  });

  it('finds every link in a document', () => {
    const links = parseWikiLinks('[[#1]] and [[org/app]] and [[global]]');
    expect(links.map((l) => l.kind)).toEqual(['ticket', 'scratchpad', 'scratchpad']);
  });

  it('is stateless across calls', () => {
    // A shared global regex would carry lastIndex and skip matches on the second
    // document it saw.
    const text = '[[#1]] [[#2]]';
    expect(parseWikiLinks(text)).toHaveLength(2);
    expect(parseWikiLinks(text)).toHaveLength(2);
  });

  it('ignores an unclosed bracket instead of swallowing the rest', () => {
    expect(parseWikiLinks('[[unclosed\nnext line [[#5]]').map((l) => l.target)).toEqual(['#5']);
  });

  it('ignores an empty target', () => {
    expect(parseWikiLinks('[[]] and [[   ]]')).toEqual([]);
  });

  it('returns nothing for text with no links', () => {
    expect(parseWikiLinks('just prose')).toEqual([]);
  });
});

describe('collectWikiLinkTargets', () => {
  it('normalises targets and drops duplicates', () => {
    expect(collectWikiLinkTargets('[[#42]] [[#42|again]] [[Org/App]] [[org/app]]'))
      .toEqual(['#42', 'org/app']);
  });

  it('omits unresolved links, which point at nothing to index', () => {
    expect(collectWikiLinkTargets('[[#1]] [[a vague idea]]')).toEqual(['#1']);
  });
});

describe('linksTo', () => {
  it('is true when the document links to the target', () => {
    expect(linksTo('see [[#42]]', '#42')).toBe(true);
    expect(linksTo('see [[org/app]]', 'org/app')).toBe(true);
  });

  it('matches a repo link however it was capitalised', () => {
    expect(linksTo('see [[Org/App]]', 'org/app')).toBe(true);
  });

  it('is false for a mere textual mention', () => {
    // A backlink must come from an actual link, or the graph fills with noise.
    expect(linksTo('this is about #42', '#42')).toBe(false);
  });

  it('is false for a different target', () => {
    expect(linksTo('see [[#41]]', '#42')).toBe(false);
  });
});
