import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MentionTypeBadge, MENTION_TYPE_META } from './MentionTypeBadge';

/**
 * The badge is THE per-type visual mnemonic across Fleex (mention autocompletes,
 * launcher favourites…): a letter identifies the mention target type at a
 * glance, and the full type name is revealed on hover (title). If the letters
 * drifted per surface the mnemonic would stop working, so the mapping is pinned.
 */

afterEach(cleanup);

describe('MentionTypeBadge', () => {
  it.each([
    ['skill', 'S'],
    ['workflow', 'W'],
    ['panel', 'P'],
    ['agent', 'A'],
    ['ticket', 'T'],
    ['human', 'H'],
  ] as const)('renders the mnemonic letter for %s and reveals the type on hover', (type, letter) => {
    render(<MentionTypeBadge type={type} />);
    expect(screen.getByTitle(type).textContent).toBe(letter);
  });

  it('renders a routine badge with its own letter and hue', () => {
    // A routine is not a launchable primitive, so it has no glyph — the lettered
    // badge is its identity, and it must not collide with another type's hue.
    const { container } = render(<MentionTypeBadge type="routine" />);
    expect(container.textContent).toBe('R');
  });

  it('gives every mention type a distinct letter', () => {
    const letters = Object.values(MENTION_TYPE_META).map((m) => m.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it('gives every mention type a distinct hue', () => {
    const hues = Object.values(MENTION_TYPE_META).map((m) => m.hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
});
