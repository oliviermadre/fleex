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

/** The mode currently shown as active by the toggle. */
function activeMode(): string | null {
  const pressed = screen
    .getByRole('group', { name: 'Markdown view mode' })
    .querySelector('[aria-pressed="true"]');
  return pressed?.getAttribute('aria-label') ?? null;
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
    const { unmount } = render(<Harness surfaceKind="unit_panel" initial="hello" />);
    fireEvent.click(screen.getByLabelText('Preview'));
    unmount();

    render(<Harness surfaceKind="unit_panel" initial="hello" />);

    expect(activeMode()).toBe('Preview');
  });

  /**
   * Unmounting the field on every preview would drop the caret and, worse, skip
   * the `onBlur` some callers save on (SkillEditor). Preview hides it instead.
   */
  it('keeps the textarea mounted in preview mode', () => {
    const { container } = render(<Harness surfaceKind="unit_panel" initial="hello" />);
    const before = container.querySelector('textarea');

    fireEvent.click(screen.getByLabelText('Preview'));

    expect(container.querySelector('textarea')).toBe(before);
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
 * Previewing a message is a transient "check my formatting" gesture, not a
 * setting. Persisting it would reopen every later thread — every ticket, every
 * conversation — showing a rendered pane and no field to type in.
 */
describe('MarkdownEditor — composer preview is not a durable preference', () => {
  it('does not persist preview, and reopens in the previous durable mode', () => {
    render(
      <Harness surfaceKind="unit_no_persist" variant="composer" initial={'a\nb'} defaultMode="write" />,
    );

    fireEvent.click(screen.getByLabelText('Preview'));
    expect(activeMode()).toBe('Preview');
    expect(readMarkdownMode('unit_no_persist')).toBeNull();

    cleanup();
    render(<Harness surfaceKind="unit_no_persist" variant="composer" initial={'a\nb'} defaultMode="write" />);

    expect(activeMode()).toBe('Write');
  });

  it('ignores a preview left in storage by an older build', () => {
    localStorage.setItem('md_mode_unit_stale', 'preview');

    render(
      <Harness surfaceKind="unit_stale" variant="composer" initial={'a\nb'} defaultMode="write" />,
    );

    expect(activeMode()).toBe('Write');
  });

  it('still persists split, which keeps the input reachable', () => {
    render(
      <Harness surfaceKind="unit_split_ok" variant="composer" initial={'a\nb'} defaultMode="write" />,
    );

    fireEvent.click(screen.getByLabelText('Split'));

    expect(readMarkdownMode('unit_split_ok')).toBe('split');
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

    render(<Harness surfaceKind="unit_narrow" initial="hello" />);

    expect(activeMode()).toBe('Preview');
    expect(screen.queryByLabelText('Split')).toBeNull();
    expect(readMarkdownMode('unit_narrow')).toBe('split');
  });
});
