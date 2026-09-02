import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { linkifyCitations } from '../markdown/citations';

afterEach(cleanup);

const noop = () => {};

/**
 * The renderer is where a citation stops being text. These cover what the reader
 * sees — `[3]` as something clickable, with the brackets intact — and what happens
 * when nobody is listening for citations.
 */
describe('MarkdownRenderer — citations', () => {
  it('renders a citation as a clickable chip, brackets included', () => {
    const onCitation = vi.fn();
    const { getByRole } = render(
      <MarkdownRenderer
        content={linkifyCitations('no feedback channel [3].', 5)}
        onToggleCheckbox={noop}
        onCitation={onCitation}
      />,
    );

    const chip = getByRole('button');
    expect(chip.textContent).toBe('[3]');

    fireEvent.click(chip);
    expect(onCitation).toHaveBeenCalledWith(3);
  });

  it('renders one chip per source in a grouped citation', () => {
    const onCitation = vi.fn();
    const { getAllByRole } = render(
      <MarkdownRenderer
        content={linkifyCitations('two sources agree [1, 3].', 5)}
        onToggleCheckbox={noop}
        onCitation={onCitation}
      />,
    );

    const chips = getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['[1]', '[3]']);

    fireEvent.click(chips[1]!);
    expect(onCitation).toHaveBeenCalledWith(3);
  });

  it('still renders the surrounding markdown', () => {
    // The reason this went through the shared renderer at all: the answer is
    // markdown, and a reader should not be shown `**bold**`.
    const { container } = render(
      <MarkdownRenderer
        content={linkifyCitations('**Three gaps** identified [1].', 3)}
        onToggleCheckbox={noop}
        onCitation={vi.fn()}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Three gaps');
    expect(container.textContent).not.toContain('**');
  });

  it('leaves a citation as plain text when no handler is given', () => {
    // Every other markdown surface renders the same content; none of them owns a
    // source list, so a chip there would lead nowhere.
    const { container } = render(
      <MarkdownRenderer
        content={linkifyCitations('cited [1].', 3)}
        onToggleCheckbox={noop}
      />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('[1]');
  });
});
