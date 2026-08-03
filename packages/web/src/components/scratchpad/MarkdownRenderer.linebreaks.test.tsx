import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

afterEach(cleanup);

const noop = () => {};

function renderMd(content: string) {
  return render(<MarkdownRenderer content={content} onToggleCheckbox={noop} />);
}

/**
 * Every surface backed by this renderer (ticket description, scratchpad,
 * deliverables, assistant transcript) is fed from a textarea or from LLM chat
 * output. Users expect WYSIWYG line breaks, not the CommonMark soft break that
 * collapses `a\nb` onto a single line — that mismatch is the bug this covers.
 */
describe('MarkdownRenderer — line breaks (user profile)', () => {
  it('renders a lone newline as a <br> inside a single paragraph', () => {
    const { container } = renderMd('TOTO\nTITY');

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.querySelectorAll('br')).toHaveLength(1);
  });

  it('renders a blank line as two distinct paragraphs, not a <br>', () => {
    const { container } = renderMd('TOTO\n\nTITY');

    // The paragraph break must stay structurally different from a <br>,
    // otherwise the user loses the distinction they just gained.
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });

  it('keeps the CommonMark soft break with the doc profile', () => {
    // Authored markdown is hand-wrapped at ~80 columns: turning those wraps
    // into <br> would render it as a staircase.
    const { container } = render(
      <MarkdownRenderer content={'TOTO\nTITY'} profile="doc" onToggleCheckbox={noop} />,
    );
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });

  it('does not inject <br> inside a fenced code block', () => {
    const { container } = renderMd('```\nconst a = 1;\nconst b = 2;\n```');

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    // A <br> here would corrupt the user's code on copy-paste.
    expect(pre!.querySelectorAll('br')).toHaveLength(0);
    expect(pre!.textContent).toContain('const a = 1;');
    expect(pre!.textContent).toContain('const b = 2;');
  });

  it('does not inject <br> inside a GFM table', () => {
    const { container } = renderMd('| a | b |\n| - | - |\n| 1 | 2 |');

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });

  it('keeps a list tight — no <p> wrapper per item', () => {
    const { container } = renderMd('- one\n- two\n- three');

    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(3);
    // A loose list would wrap each item in a <p> and add per-item margins.
    for (const li of items) expect(li.querySelector('p')).toBeNull();
  });

  it('applies the same profile to the content of a nested toggle block', () => {
    const { container, getByText } = renderMd('>>> Details\nTOTO\nTITY\n<<<');

    // Toggle blocks are collapsed by default — expand to render their content,
    // which goes through a recursive MarkdownRenderer call.
    fireEvent.click(getByText('Details'));
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });
});

/**
 * Checkbox toggling maps a rendered <input> back to a line index in the raw
 * content. `remark-breaks` adds no line, but this is the one thing that would
 * silently break if line breaks were ever handled by rewriting the source.
 */
describe('MarkdownRenderer — checkbox line indices survive soft breaks', () => {
  it('toggles the line actually clicked, after intervening soft breaks', () => {
    const onToggle = vi.fn();
    // line 0: prose, line 1: soft-broken prose, lines 3-4: the two checkboxes
    const { getByText } = render(
      <MarkdownRenderer
        content={'TOTO\nTITY\n\n- [ ] first\n- [x] second'}
        onToggleCheckbox={onToggle}
      />,
    );

    fireEvent.click(getByText('second'));
    expect(onToggle).toHaveBeenCalledWith(4);
  });

  it('offsets toggle-block checkboxes by the block start line', () => {
    const onToggle = vi.fn();
    // line 0: `>>> Details`, lines 1-2: soft-broken prose, line 4: the checkbox
    const { getByText } = render(
      <MarkdownRenderer
        content={'>>> Details\nTOTO\nTITY\n\n- [ ] inside\n<<<'}
        onToggleCheckbox={onToggle}
      />,
    );

    fireEvent.click(getByText('Details'));
    fireEvent.click(getByText('inside'));
    expect(onToggle).toHaveBeenCalledWith(4);
  });
});
