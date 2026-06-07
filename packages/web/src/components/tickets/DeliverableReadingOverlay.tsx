import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { TicketPickerModal } from './TicketPickerModal';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const noopToggle = () => {};

export function DeliverableReadingOverlay({ ticketId }: { ticketId?: string }) {
  const deliverable = useUIStore((s) => s.deliverableOverlay);
  const close = useUIStore((s) => s.closeDeliverableOverlay);
  const addFloatingDeliverable = useUIStore((s) => s.addFloatingDeliverable);
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const typeColor = useDeliverableTypesStore((s) => s.colorFor)(deliverable?.type ?? '');
  const isHtml = useDeliverableTypesStore((s) => s.rendererFor)(deliverable?.type ?? '') === 'html';
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const resolvedTicketId = ticketId ?? deliverable?.ticketId ?? '';

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't close if a child modal (lightbox or copy picker) is open above us
        if (document.querySelector('[data-overlay-top]')) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
      }
    },
    [close],
  );

  useEffect(() => {
    if (!deliverable) return;
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [deliverable, handleEsc]);

  if (!deliverable) return null;

  const handleDetach = () => {
    addFloatingDeliverable(deliverable);
    close();
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(deliverable.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('[Fleex] Copy to clipboard failed', err);
    }
  };

  return createPortal(
    <div
      className="deliverable-overlay-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="deliverable-overlay-panel" style={isHtml ? { height: '85vh' } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3" style={{ background: 'var(--theme-bg-hover)', flexShrink: 0 }}>
          <span
            className={`flex-shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${typeColor ? '' : 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'}`}
            style={typeColor ? { backgroundColor: typeColor.bg, color: typeColor.text } : undefined}
          >
            {labelForType(deliverable.type)}
          </span>

          <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {deliverable.title}
          </span>

          {deliverable.version > 1 && (
            <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">v{deliverable.version}</span>
          )}
          {deliverable.status === 'draft' && (
            <span className="flex-shrink-0 rounded-full bg-[var(--theme-warning)]/15 px-1.5 py-px text-[10px] font-medium text-[var(--theme-warning)]">draft</span>
          )}

          <div className="flex-1" />

          {/* Copy to clipboard button */}
          <button
            onClick={handleCopyToClipboard}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-[var(--theme-text-primary)]"
          >
            {copied ? (
              <>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy to clipboard
              </>
            )}
          </button>

          {/* Copy to button */}
          <button
            onClick={() => setShowCopyPicker(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-[var(--theme-text-primary)]"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Copy to…
          </button>

          {/* Detach button */}
          <button
            onClick={handleDetach}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-[var(--theme-text-primary)]"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Detach
          </button>

          {/* Close button */}
          <button
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-danger)]/15 hover:text-[var(--theme-danger)]"
            style={{ fontSize: 16, lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        {isHtml ? (
          <iframe
            srcDoc={deliverable.content.replace(/<\\\/script\s*>/gi, '</script>')}
            className="flex-1"
            style={{
              width: '100%',
              border: 'none',
              borderRadius: 0,
              background: '#fff',
              minHeight: 0,
            }}
            title={deliverable.title}
          />
        ) : (
          <div className="deliverable-overlay-content flex-1 overflow-y-auto px-6 py-5">
            <MarkdownRenderer content={deliverable.content} onToggleCheckbox={noopToggle} />
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-2 text-[10px] text-[var(--theme-text-faint)]" style={{ background: 'var(--theme-bg-hover)', flexShrink: 0 }}>
          <span className="text-[var(--theme-accent)]">{deliverable.agentName}</span>
          <span>&middot;</span>
          <span>{relativeTime(deliverable.createdAt)}</span>
          <div className="flex-1" />
          <span className="opacity-50">Press ESC to close</span>
        </div>
      </div>
      {showCopyPicker && deliverable && (
        <TicketPickerModal
          open={showCopyPicker}
          onClose={() => setShowCopyPicker(false)}
          deliverable={deliverable}
          sourceTicketId={resolvedTicketId}
        />
      )}
    </div>,
    document.body,
  );
}
