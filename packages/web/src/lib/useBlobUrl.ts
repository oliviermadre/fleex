import { useMemo, useEffect } from 'react';

/**
 * Converts an HTML string into a blob: URL for use as iframe `src`.
 *
 * Why blob: instead of srcDoc?
 * With srcDoc the document lives at about:srcdoc. Even with sandbox
 * "allow-scripts allow-same-origin", Chromium/Electron can break the
 * scope chain for inline event handlers (onclick, oninput, etc.) —
 * <script> blocks execute but inline handlers throw ReferenceError.
 *
 * A blob: URL inherits the creator's origin, giving the iframe a real
 * origin and a normal global scope. Inline handlers work as expected.
 */
export function useBlobUrl(html: string | undefined): string | undefined {
  const blobUrl = useMemo(() => {
    if (!html) return undefined;
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [html]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  return blobUrl;
}
