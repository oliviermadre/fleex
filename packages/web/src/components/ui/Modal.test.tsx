import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

afterEach(cleanup);

function setup(onClose = vi.fn()) {
  const { baseElement } = render(
    <Modal open onClose={onClose}>
      <p>Selectable answer text</p>
    </Modal>,
  );
  const backdrop = baseElement.querySelector('[data-overlay-top]') as HTMLElement;
  const panel = backdrop.firstElementChild as HTMLElement;
  return { onClose, backdrop, panel };
}

/**
 * Dismissing by clicking outside, without breaking text selection.
 *
 * A `click` fires on the nearest common ancestor of where the press started and
 * where it ended. Selecting the text of a dialog and releasing past its edge
 * therefore produced a click on the backdrop, indistinguishable from clicking
 * outside — so selecting text closed the dialog and lost the selection.
 */
/**
 * Replay a full gesture the way a browser does.
 *
 * The trailing `click` is the part that matters and the part jsdom will not add
 * for you: a real browser dispatches it on the nearest common ancestor of the
 * press and the release. Omitting it makes every test here pass against the
 * broken implementation, for the wrong reason.
 */
function gesture(from: HTMLElement, to: HTMLElement, commonAncestor: HTMLElement) {
  fireEvent.pointerDown(from);
  fireEvent.pointerUp(to);
  fireEvent.click(commonAncestor);
}

describe('Modal dismissal', () => {
  it('closes when a press and a release both land on the backdrop', () => {
    const { onClose, backdrop } = setup();
    gesture(backdrop, backdrop, backdrop);
    // Once, not twice: the release closes it and the click that follows must not
    // count as a second dismissal.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when a selection drag ends past its edge', () => {
    // The reported bug. Press on the text, drag left, release outside — and the
    // browser reports a click on the backdrop, because that is the pair's nearest
    // common ancestor.
    const { onClose, backdrop, panel } = setup();
    gesture(panel, backdrop, backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a press on the backdrop releases inside', () => {
    // The mirror case. Half a dismissal gesture is not a dismissal.
    const { onClose, backdrop, panel } = setup();
    gesture(backdrop, panel, backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open on a press and release inside', () => {
    const { onClose, panel } = setup();
    gesture(panel, panel, panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not carry a half-finished gesture into the next one', () => {
    // Press on the backdrop, release somewhere that never reports back — outside
    // the window, say. The next gesture must be judged on its own.
    const { onClose, backdrop, panel } = setup();
    fireEvent.pointerDown(backdrop);

    gesture(panel, backdrop, backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a popover opened from the dialog: the popover closes, not the dialog', () => {
    const { onClose } = setup();
    /* a drop-down of the dialog lives in a floating portal, outside the dialog's own markup */
    const portal = document.createElement('div');
    portal.setAttribute('data-floating-ui-portal', '');
    const option = document.createElement('button');
    portal.appendChild(option); document.body.appendChild(portal);
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    portal.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guarded: Escape typed in a field stays in the field, and closes from anywhere else', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<Modal open onClose={onClose} guardEscape><input aria-label="Name" /><button type="button">Go</button></Modal>);
    fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(getByRole('button'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guarded: Escape is for what is opened over the dialog, not for the dialog under it', () => {
    const under = vi.fn(), over = vi.fn();
    render(<Modal open onClose={under} guardEscape><p>A working surface</p><Modal open onClose={over}><p>Opened over it</p></Modal></Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(under).not.toHaveBeenCalled();
    expect(over).toHaveBeenCalledTimes(1);
  });

  it('glass: an opaque dialog over a backdrop that blurs nothing, and nothing blurred behind the dialog either (it opens over a page that moves); flush: no padding', () => {
    const { baseElement } = render(<Modal open onClose={vi.fn()} variant="glass" flush><p>Over the floor</p></Modal>);
    const backdrop = baseElement.querySelector('[data-overlay-top]') as HTMLElement, panel = backdrop.firstElementChild as HTMLElement;
    expect(backdrop.className).not.toContain('backdrop-blur');
    expect(panel.style.backdropFilter ?? '').toBe('');
    expect(panel.style.background).not.toContain('transparent');
    expect(panel.style.background).toContain('--theme-bg-surface');
    expect(panel.className).not.toContain('p-6');
    cleanup();
    const solid = setup();
    expect(solid.backdrop.className).toContain('backdrop-blur-sm');
    expect(solid.panel.className).toContain('p-6');
    expect(solid.panel.style.background).toBe('');
  });

  it('renders nothing when closed', () => {
    const { baseElement } = render(
      <Modal open={false} onClose={vi.fn()}><p>hidden</p></Modal>,
    );
    expect(baseElement.querySelector('[data-overlay-top]')).toBeNull();
  });
});
