import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AgentEventStream } from '../main-panel/AgentEventStream';
import { tintClasses } from '../../lib/tints';

interface Props {
  /** Execution whose SDK turns are streamed. */
  executionId: string;
  /** Step name, shown in the title bar so the popup is self-describing. */
  stepName: string;
  /** True while the step is still running — the stream keeps appending turns. */
  live: boolean;
  onClose: () => void;
}

/**
 * Floating popup over the workflow DAG showing the turns of the Claude SDK
 * session a step ran.
 *
 * It reuses <AgentEventStream> verbatim: that component already fetches the
 * event history, subscribes to the `agent-events` websocket channel and sticks
 * to the bottom, so a step still in flight streams live here with no extra
 * plumbing. It only needs a height-constrained flex parent for its own
 * `flex-1 overflow-y-auto` to resolve — hence the fixed 80vh panel.
 */
export function StepSessionOverlay({ executionId, stepName, live, onClose }: Props) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Yield to any modal stacked above us (same guard as the deliverable
        // overlay), otherwise ESC would close both at once.
        if (document.querySelector('[data-overlay-top]')) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [handleEsc]);

  return createPortal(
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center backdrop-blur-[4px]"
      style={{ background: 'var(--theme-glass-overlay)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl border border-[var(--theme-border)] shadow-2xl"
        style={{
          width: 'calc(100vw - 160px)',
          maxWidth: 1000,
          height: '80vh',
          background: 'var(--theme-bg-surface)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--theme-border)] px-5 py-3"
          style={{ background: 'var(--theme-bg-hover)' }}
        >
          <span className="flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent)]">
            SDK session
          </span>
          <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {stepName}
          </span>
          {live && (
            <span
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-px text-[10px] font-medium ${tintClasses('blue').bg} ${tintClasses('blue').text}`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              live
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-danger)]/15 hover:text-[var(--theme-danger)]"
            style={{ fontSize: 16, lineHeight: 1 }}
            aria-label="Close SDK session"
          >
            &times;
          </button>
        </div>

        {/* Turns — AgentEventStream is itself `flex-1 overflow-y-auto` */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentEventStream executionId={executionId} />
        </div>

        {/* Footer */}
        <div
          className="flex flex-shrink-0 items-center gap-2 border-t border-[var(--theme-border)] px-5 py-2 text-[10px] text-[var(--theme-text-faint)]"
          style={{ background: 'var(--theme-bg-hover)' }}
        >
          <span className="font-mono">{executionId}</span>
          <div className="flex-1" />
          <span className="opacity-50">Press ESC to close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
