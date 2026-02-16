import { useCallback, useRef } from 'react';

/**
 * Syncs scroll position from a textarea to a preview element.
 * On typing, the preview scrolls to match the textarea's position.
 * The user can scroll the preview independently; on next keystroke,
 * the preview resets to match the edit position.
 */
export function useScrollSync(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  previewRef: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  const lastManualScrollTime = useRef(0);

  const syncPreviewScroll = useCallback(() => {
    if (!active) return;
    const ta = textareaRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;

    const taMax = ta.scrollHeight - ta.clientHeight;
    if (taMax <= 0) return;

    const ratio = ta.scrollTop / taMax;
    const pvMax = pv.scrollHeight - pv.clientHeight;
    pv.scrollTop = ratio * pvMax;
  }, [active, textareaRef, previewRef]);

  const handleTyping = useCallback(() => {
    syncPreviewScroll();
  }, [syncPreviewScroll]);

  const handlePreviewScroll = useCallback(() => {
    lastManualScrollTime.current = Date.now();
  }, []);

  return { handleTyping, handlePreviewScroll };
}
