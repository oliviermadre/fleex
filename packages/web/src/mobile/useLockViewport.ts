import { useEffect } from 'react';

const LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

/**
 * Lock the page scale on the phone: no zoom-on-focus when an input is tapped
 * (which pushes the send button out of the viewport) and no pinch / double-tap
 * zoom. `maximum-scale=1` stops the focus zoom; iOS Safari ignores
 * `user-scalable=no` for pinch since iOS 10, hence the `gesture*` listeners.
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
    document.documentElement.style.touchAction = 'manipulation';

    return () => {
      if (meta && original !== undefined) meta.content = original;
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      document.documentElement.style.touchAction = '';
    };
  }, []);
}
