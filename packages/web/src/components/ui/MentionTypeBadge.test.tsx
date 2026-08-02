import { render, cleanup, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { MentionTypeBadge } from './MentionTypeBadge';

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
  ] as const)(
    'renders the mnemonic letter for %s and reveals the type on hover',
    (type, letter) => {
      render(<MentionTypeBadge type={type} />);
      expect(screen.getByTitle(type).textContent).toBe(letter);
    },
  );
});
