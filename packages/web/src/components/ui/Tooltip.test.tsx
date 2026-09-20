import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { createRef } from 'react';
import { Tooltip } from './Tooltip';

afterEach(cleanup);

function setup() {
  render(
    <Tooltip label="Open in Cursor">
      <button type="button">icon</button>
    </Tooltip>,
  );
  return screen.getByRole('button');
}

/**
 * The whole point of this component is to replace the native `title`, which the
 * browser only shows after ~1s. So "appears at once" is the behaviour under
 * test: every assertion below runs synchronously, on real timers, straight
 * after the event — a hover delay of any kind would fail them.
 */
describe('Tooltip', () => {
  it('shows nothing until the trigger is hovered', () => {
    setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the label the instant the pointer enters the trigger', () => {
    const button = setup();
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Open in Cursor');
  });

  it('hides the moment the pointer leaves the trigger', () => {
    const button = setup();
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on keyboard focus too, so it is not mouse-only', () => {
    const button = setup();
    act(() => button.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Open in Cursor');
  });

  it('closes when the trigger is pressed, like a native tooltip', () => {
    // WHY: a pinned action fires a shell command / opens another app. The
    // bubble must not linger over the bar once the user has acted.
    const button = setup();
    fireEvent.mouseEnter(button);
    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('points at the trigger with an arrow', () => {
    const button = setup();
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').querySelector('svg')).not.toBeNull();
  });

  it('describes the trigger for assistive tech while open', () => {
    const button = setup();
    fireEvent.mouseEnter(button);
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });

  it('leaves the trigger fully functional: its own handlers and ref still work', () => {
    // WHY: the tooltip clones its child to attach hover/focus handlers. If that
    // clobbered the child's onClick or its ref, wrapping an action button
    // would silently break the action.
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Tooltip label="Open in Cursor">
        <button type="button" ref={ref} onClick={onClick}>
          icon
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
