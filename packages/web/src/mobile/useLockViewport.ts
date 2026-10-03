import { useEffect } from 'react';

const LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

/**
 * Lock the page scale on the phone: no zoom-on-focus when an input is tapped
 * (which pushes the send button out of the viewport) and no pinch / double-tap
 * zoom. `maximum-scale=1` stops the focus zoom; iOS Safari ignores
 * `user-scalable=no` for pinch since iOS 10, hence the `gesture*` listeners
 * plus `touch-action: pan-x pan-y`.
 * Scoped to the mobile shell: the desktop view keeps the original viewport.
 */
export function useLockViewport(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const original = meta?.content;
    if (meta) meta.content = LOCKED;

    const block = (e: Event) => e.preventDefault();
    // Safari-only pinch events; harmless elsewhere.
    document.addEventListener('gesturestart', block);
    document.addEventListener('gesturechange', block);
    // `manipulation` still allows pinch-zoom; only pan-x/pan-y forbids it.
    // touch-action intersects down the tree, so html + body cover every child.
    document.documentElement.style.touchAction = 'pan-x pan-y';
    document.body.style.touchAction = 'pan-x pan-y';

    return () => {
      if (meta && original !== undefined) meta.content = original;
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      document.documentElement.style.touchAction = '';
      document.body.style.touchAction = '';
    };
  }, []);
}
