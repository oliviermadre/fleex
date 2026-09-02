import { useCallback, useRef, type RefObject } from 'react';

/**
 * Click-outside-to-dismiss that survives a text selection.
 *
 * A `click` fires on the nearest common ancestor of where the press started and
 * where it ended. Selecting the text of a dialog and releasing past its edge
 * therefore produces a click whose target is the backdrop — indistinguishable, to
 * a click handler, from someone clicking outside to dismiss. Every overlay built
 * that way closed itself when its own text was selected, discarding the
 * selection and, in the case of an answer panel, the answer.
 *
 * Dismissal takes both ends of the gesture: press and release must both land on
 * the backdrop. A drag out of the panel keeps it open, and so does a press on the
 * backdrop that releases inside — half a dismissal gesture is not a dismissal.
 *
 * @param backdropRef the element that *is* the backdrop; anything nested inside
 * it counts as the panel.
 */
export function useBackdropDismiss(
  backdropRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
} {
  const pressedBackdrop = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pressedBackdrop.current = e.target === backdropRef.current;
  }, [backdropRef]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const dismiss = pressedBackdrop.current && e.target === backdropRef.current;
    // Cleared unconditionally, so a gesture that ended somewhere we never heard
    // about — off-window, say — cannot arm the next one.
    pressedBackdrop.current = false;
    if (dismiss) onDismiss();
  }, [backdropRef, onDismiss]);

  return { onPointerDown, onPointerUp };
}
