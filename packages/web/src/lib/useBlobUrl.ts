import { useRef, useEffect, useCallback } from 'react';

/**
 * Writes HTML content directly into an iframe via document.write().
 *
 * This bypasses srcDoc, blob: URLs, and sandbox entirely.
 * The iframe has no src — its document is same-origin with the parent.
 * document.write() injects content directly, so scripts execute in the
 * iframe's global scope and inline handlers (onclick, etc.) resolve
 * through the normal scope chain.
 *
 * Previous approaches that all failed in Chromium/Electron:
 * - srcDoc + allow-scripts → null origin, broken scope
 * - srcDoc + allow-scripts allow-same-origin → still broken
 * - blob: URL + sandbox → still broken
 * - blob: URL without sandbox → still broken
 */
export function useHtmlIframe(html: string | undefined) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const writtenRef = useRef<string | undefined>(undefined);

  const writeToIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    // Avoid re-writing the same content
    if (writtenRef.current === html) return;
    writtenRef.current = html;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  useEffect(() => {
    writeToIframe();
  }, [writeToIframe]);

  // Also write on iframe load (handles initial mount timing)
  const onLoad = useCallback(() => {
    writeToIframe();
  }, [writeToIframe]);

  return { iframeRef, onLoad };
}
