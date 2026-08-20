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

  it('renders nothing when closed', () => {
    const { baseElement } = render(
      <Modal open={false} onClose={vi.fn()}><p>hidden</p></Modal>,
    );
    expect(baseElement.querySelector('[data-overlay-top]')).toBeNull();
  });
});
