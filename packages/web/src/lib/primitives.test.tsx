import { render, cleanup, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { MentionTypeIcon } from './primitives';

/**
 * `MentionTypeIcon` is what the @mention autocompletes render per suggestion. It
 * MUST show the canonical primitive glyph (an <svg>, same as the sidebar / palette
 * / workflow steps) — never the type's mnemonic letter — for the four launchable
 * primitives, so the iconography stays coherent app-wide. `human` and `ticket`
 * aren't primitives, so they intentionally keep the lettered fallback badge.
 */

afterEach(cleanup);

describe('MentionTypeIcon', () => {
  it.each(['agent', 'skill', 'panel', 'workflow'] as const)(
    'renders the primitive glyph (not a letter) for %s',
    (type) => {
      render(<MentionTypeIcon type={type} />);
      const el = screen.getByTitle(type);
      // A glyph, not the letter mnemonic: the icon carries an <svg> and no text.
      expect(el.querySelector('svg')).not.toBeNull();
      expect(el.textContent).toBe('');
    },
  );

  it.each([
    ['human', 'H'],
    ['ticket', 'T'],
  ] as const)('falls back to the lettered badge for non-primitive %s', (type, letter) => {
    render(<MentionTypeIcon type={type} />);
    const el = screen.getByTitle(type);
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe(letter);
  });
});
