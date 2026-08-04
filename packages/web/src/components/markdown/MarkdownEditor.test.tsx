import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { readMarkdownMode } from './useMarkdownMode';

/**
 * Viewport width decides whether `split` is offered at all, and jsdom's own
 * `matchMedia` answers `false` to everything — so every test states the width
 * it means to exercise.
 */
function mockViewport(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: wide,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

/** Uncontrolled editor: the component owns the mode, the test owns the value. */
function Harness(props: { surfaceKind: string; initial?: string } & Record<string, unknown>) {
  const { surfaceKind, initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <MarkdownEditor surfaceKind={surfaceKind} value={value} onChange={setValue} {...rest} />;
}

beforeEach(() => {
  localStorage.clear();
  mockViewport(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The mode is the one piece of state a user re-sets on every single markdown
 * surface if we get it wrong: it must survive a remount (tab switch, ticket
 * change) and be shared by every editor of the same *kind*, not per entity.
 */
describe('MarkdownEditor — mode cycling and persistence', () => {
  it('persists the mode chosen from the toggle under the surface kind', () => {
    render(<Harness surfaceKind="unit_panel" initial="hello" />);

    fireEvent.click(screen.getByLabelText('Preview'));

    expect(readMarkdownMode('unit_panel')).toBe('preview');
  });

  it('restores the persisted mode on remount instead of the default', () => {
    const { container, unmount } = render(<Harness surfaceKind="unit_panel" initial="hello" />);
    fireEvent.click(screen.getByLabelText('Preview'));
    unmount();

    const second = render(<Harness surfaceKind="unit_panel" initial="hello" />);

    // Preview mode replaces the textarea — its absence is the observable proof.
    expect(container.querySelector('textarea')).toBeNull();
    expect(second.container.querySelector('textarea')).toBeNull();
  });

  it('cycles write → preview → split on ⌘⇧P', () => {
    const { container } = render(
      <Harness surfaceKind="unit_cycle" initial="hello" defaultMode="write" />,
    );
    const press = () =>
      fireEvent.keyDown(container.querySelector('textarea') ?? container.firstChild!, {
        key: 'P',
        metaKey: true,
        shiftKey: true,
      });

    press();
    expect(readMarkdownMode('unit_cycle')).toBe('preview');
    press();
    expect(readMarkdownMode('unit_cycle')).toBe('split');
    press();
    expect(readMarkdownMode('unit_cycle')).toBe('write');
  });
});

/**
 * Regression: the comment composer used to re-open at one line after a tab
 * switch, because the height was only recomputed on keystroke. A draft restored
 * at mount must already be at its full height — i.e. the resize runs on value,
 * not on typing.
 */
describe('MarkdownEditor — composer auto-resize', () => {
  it('treats a pre-filled multi-line draft as grown at mount, with no keystroke', () => {
    render(
      <Harness
        surfaceKind="unit_composer"
        variant="composer"
        initial={'line one\nline two\nline three'}
      />,
    );

    // The toggle only shows once the field has grown past a single line, so its
    // presence at mount means the resize pass ran without any input event.
    expect(screen.getByRole('group', { name: 'Markdown view mode' })).toBeTruthy();
  });

  it('keeps the toggle hidden while the draft is a single line', () => {
    render(<Harness surfaceKind="unit_composer_empty" variant="composer" initial="" />);

    expect(screen.queryByRole('group', { name: 'Markdown view mode' })).toBeNull();
  });
});

/**
 * Below 640px a side-by-side split is unreadable. It degrades to preview
 * *without* overwriting the stored preference, so going back to a wide screen
 * restores the split the user actually asked for.
 */
describe('MarkdownEditor — narrow viewport', () => {
  it('renders a persisted split as preview and hides the split segment', () => {
    localStorage.setItem('md_mode_unit_narrow', 'split');
    mockViewport(false);

    const { container } = render(<Harness surfaceKind="unit_narrow" initial="hello" />);

    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByLabelText('Split')).toBeNull();
    expect(readMarkdownMode('unit_narrow')).toBe('split');
  });
});
