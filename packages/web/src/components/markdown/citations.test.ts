import { describe, it, expect } from 'vitest';
import {
  CITATION_HREF_PREFIX,
  decodeCitation,
  linkifyCitations,
  sourceLabel,
} from './citations';

describe('linkifyCitations', () => {
  it('links a single citation', () => {
    expect(linkifyCitations('as decided [3].', 5))
      .toBe(`as decided [\\[3\\]](${CITATION_HREF_PREFIX}3).`);
  });

  it('splits a grouped citation into one link per source', () => {
    // The model writes `[1, 3]` when two sources support a claim. One link cannot
    // lead to both, so each number becomes its own target.
    expect(linkifyCitations('no feedback channel [1, 3]:', 5))
      .toBe(`no feedback channel [\\[1\\]](${CITATION_HREF_PREFIX}1)[\\[3\\]](${CITATION_HREF_PREFIX}3):`);
  });

  it('accepts a group written without spaces', () => {
    expect(linkifyCitations('[2,4]', 5)).toContain(`${CITATION_HREF_PREFIX}2`);
    expect(linkifyCitations('[2,4]', 5)).toContain(`${CITATION_HREF_PREFIX}4`);
  });

  it('leaves a number with no source behind it as text', () => {
    // Otherwise every array index in an answer becomes a dead link.
    expect(linkifyCitations('see [9] and [12]', 3)).toBe('see [9] and [12]');
  });

  it('drops only the out-of-range members of a group', () => {
    expect(linkifyCitations('[1, 99]', 3)).toBe(`[\\[1\\]](${CITATION_HREF_PREFIX}1)`);
  });

  it('leaves an index inside inline code alone', () => {
    expect(linkifyCitations('use `items[1]` here [1]', 3))
      .toBe(`use \`items[1]\` here [\\[1\\]](${CITATION_HREF_PREFIX}1)`);
  });

  it('leaves indices inside a fenced block alone', () => {
    const text = '```js\nconst a = xs[1];\n```\nand [1]';
    expect(linkifyCitations(text, 3)).toBe(`\`\`\`js\nconst a = xs[1];\n\`\`\`\nand [\\[1\\]](${CITATION_HREF_PREFIX}1)`);
  });

  it('rewrites every citation in a long answer', () => {
    const answer = 'one [1] two [2] three [3]';
    const out = linkifyCitations(answer, 3);
    expect(out.match(new RegExp(CITATION_HREF_PREFIX.replace('#', '#'), 'g'))).toHaveLength(3);
  });

  it('returns the answer untouched when there are no sources', () => {
    expect(linkifyCitations('plain answer [1]', 0)).toBe('plain answer [1]');
  });

  it('leaves an answer with no citations untouched', () => {
    expect(linkifyCitations('nothing to cite here', 5)).toBe('nothing to cite here');
  });
});

describe('decodeCitation', () => {
  it('reads the number back', () => {
    expect(decodeCitation(`${CITATION_HREF_PREFIX}7`)).toBe(7);
  });

  it('returns null for a href that carries no number', () => {
    expect(decodeCitation(`${CITATION_HREF_PREFIX}abc`)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('drops the chunk counter, which says nothing to a reader', () => {
    expect(sourceLabel('Routines — 5 axes d’évolution (3/13)')).toBe('Routines — 5 axes d’évolution');
  });

  it('keeps a parenthetical that is part of the title', () => {
    expect(sourceLabel('Code Review — PR #269 (Lot 1)')).toBe('Code Review — PR #269 (Lot 1)');
  });

  it('leaves a plain title alone', () => {
    expect(sourceLabel('Ticket #539: idées d’évolutions')).toBe('Ticket #539: idées d’évolutions');
  });
});
