import { lazy, Suspense } from 'react';
import type { MarkdownCoreProps } from './MarkdownCore';

const MarkdownCore = lazy(() => import('./MarkdownCore'));

/**
 * Shared lazy boundary in front of the markdown pipeline (react-markdown +
 * highlight.js, ~157 kB gzip). Use this everywhere; never import MarkdownCore
 * directly.
 *
 * The fallback renders the raw source in the same container instead of a
 * spinner: the text stays readable while the chunk arrives and there is no
 * layout jump when it swaps in. Paired with warmMarkdown() below, it is normally
 * invisible — it only shows on a degraded network.
 */
export function LazyMarkdown(props: MarkdownCoreProps) {
  return (
    <Suspense
      fallback={<div className="whitespace-pre-wrap break-words">{props.content}</div>}
    >
      <MarkdownCore {...props} />
    </Suspense>
  );
}

/**
 * Prefetch the markdown chunk during idle time. Called once by each app shell
 * on mount — by the time a user opens a ticket, the chunk is already there.
 * No-op if the module is already loaded (dynamic imports are cached).
 */
export function warmMarkdown(): void {
  const warm = () => {
    void import('./MarkdownCore');
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warm);
  } else {
    setTimeout(warm, 1);
  }
}
