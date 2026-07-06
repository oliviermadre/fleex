import { useConfirmStore } from '../../stores/confirmStore';

/**
 * Returns a promise-based `confirm(options)` that renders a styled modal
 * (via `<ConfirmModalHost />`) instead of the native `window.confirm`.
 * The returned function identity is stable across renders.
 */
export function useConfirm() {
  return useConfirmStore((s) => s.confirm);
}
