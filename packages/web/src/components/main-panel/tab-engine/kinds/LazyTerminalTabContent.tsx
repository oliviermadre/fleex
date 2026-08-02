import { lazy, Suspense } from 'react';
import type { TabContentProps } from '../types';

/**
 * Lazy boundary for xterm.js. Both session-backed tab kinds (shell, claude)
 * register this instead of TerminalTabContent, so @xterm/xterm and its addons
 * only load when a terminal tab is actually rendered.
 *
 * Fallback is a bare surface in the base background rather than a spinner: a
 * terminal that is about to be black should not flash something else first.
 */
const TerminalTabContent = lazy(() =>
  import('./TerminalTabContent').then((m) => ({ default: m.TerminalTabContent }))
);

export function LazyTerminalTabContent(props: TabContentProps) {
  return (
    <Suspense fallback={<div className="flex-1 bg-[var(--theme-bg-base)]" />}>
      <TerminalTabContent {...props} />
    </Suspense>
  );
}
