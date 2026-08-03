import { render, cleanup, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { CommentMarkdown } from './TicketComments';

/**
 * Comment bodies chip every actionable mention type with the same hue system as
 * the MentionTypeBadge mnemonic (agent=accent/purple, panel=blue, skill=green,
 * workflow=orange). The launcher and autocompletes teach `@workflow:slug` as the
 * invocation syntax — a comment must render it as a chip like the other types,
 * never as a plain link to a `#fleex-…` href.
 */

afterEach(cleanup);

function renderBody(body: string) {
  return render(
    <CommentMarkdown
      body={body}
      commentId="c1"
      mentionLookup={new Map()}
      onRemoveMention={vi.fn()}
    />,
  );
}

// The markdown pipeline is lazy, so the chip only exists after its chunk
// resolves — findBy* rather than getBy*.
describe('CommentMarkdown — mention chips', () => {
  it('renders a @workflow:slug mention as a chip, not a link', async () => {
    renderBody('run @workflow:deploy please');
    const chip = await screen.findByText('@workflow:deploy');
    // A chip is a span — an <a> would navigate to a dead #fleex-… href.
    expect(chip.closest('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a @skill:name mention as a chip, not a link (existing types intact)', async () => {
    renderBody('run @skill:review please');
    const chip = await screen.findByText('@skill:review');
    expect(chip.closest('a')).toBeNull();
  });
});
