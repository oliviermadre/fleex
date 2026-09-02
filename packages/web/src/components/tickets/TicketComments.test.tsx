import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { CommentMarkdown } from './TicketComments';

/**
 * Comment bodies chip every actionable mention type with the same hue system as
 * the MentionTypeBadge mnemonic (agent=accent/purple, panel=blue, skill=green,
 * workflow=orange). The launcher and autocompletes teach `@workflow:slug` as the
 * invocation syntax — a comment must render it as a chip like the other types,
 * never as a plain link to a `#fleex-…` href.
 */

afterEach(cleanup);

function renderBody(
  body: string,
  opts: {
    mentionLookup?: Map<string, Map<string, string>>;
    onRemoveMention?: (id: string) => void;
  } = {},
) {
  return render(
    <CommentMarkdown
      body={body}
      commentId="c1"
      mentionLookup={opts.mentionLookup ?? new Map()}
      onRemoveMention={opts.onRemoveMention ?? vi.fn()}
    />,
  );
}

describe('CommentMarkdown — mention chips', () => {
  it('renders a @workflow:slug mention as a chip, not a link', () => {
    renderBody('run @workflow:deploy please');
    const chip = screen.getByText('@workflow:deploy');
    // A chip is a span — an <a> would navigate to a dead #fleex-… href.
    expect(chip.closest('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a @skill:name mention as a chip, not a link (existing types intact)', () => {
    renderBody('run @skill:review please');
    const chip = screen.getByText('@skill:review');
    expect(chip.closest('a')).toBeNull();
  });

  it('renders a @scratchpad: reference as a chip, not a link', () => {
    renderBody('conventions in @scratchpad:acme/app');
    const chip = screen.getByText('@scratchpad:acme/app');
    expect(chip.closest('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('labels the global note reference Global', () => {
    renderBody('see @scratchpad:global');
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

/**
 * The agent/panel/skill/workflow/human chips are ACTIONABLE: unlike
 * `PrimitiveRefChip` (a pure pointer used everywhere else), each one carries a
 * `mentionId` and a remove control that cancels the dispatched run behind it.
 * This is the affordance that makes the two components not interchangeable —
 * pin it here so a well-meaning cleanup that swaps one in for the other fails
 * a test instead of silently deleting run cancellation.
 */
describe('CommentMarkdown — cancel affordance', () => {
  it('clicking the remove control on an actionable mention calls onRemoveMention', () => {
    const onRemoveMention = vi.fn();
    const mentionLookup = new Map([['c1', new Map([['@agent:catalyst', 'm1']])]]);
    renderBody('run @agent:catalyst please', { mentionLookup, onRemoveMention });

    fireEvent.click(screen.getByTitle('Remove mention'));

    expect(onRemoveMention).toHaveBeenCalledWith('m1');
  });
});

/**
 * Comments are typed in a textarea where Shift+Enter inserts a newline. Under
 * strict CommonMark that newline collapses to a space and the comment comes
 * back as one long line — the stored body is never rewritten to compensate,
 * the renderer is what carries the behaviour.
 */
describe('CommentMarkdown — line breaks', () => {
  it('renders a lone newline as a <br> inside a single paragraph', () => {
    const { container } = renderBody('TOTO\nTITY');

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.querySelectorAll('br')).toHaveLength(1);
  });

  it('renders a blank line as two distinct paragraphs, not a <br>', () => {
    const { container } = renderBody('TOTO\n\nTITY');

    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });

  it('does not inject <br> inside a fenced code block', () => {
    const { container } = renderBody('```\nconst a = 1;\nconst b = 2;\n```');

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.querySelectorAll('br')).toHaveLength(0);
  });
});
