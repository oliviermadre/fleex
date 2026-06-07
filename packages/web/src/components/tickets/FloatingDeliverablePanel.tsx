import { memo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TicketDeliverable } from '@fleex/shared';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useFloatingResize, clampPosition } from '../../hooks/useFloatingResize';
import { TITLE_BAR_HEIGHT, PILL_BORDER_RADIUS } from '../../lib/constants';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';
import * as api from '../../services/api';

const MIN_WIDTH = 400;
const MIN_HEIGHT = 250;
const DEFAULT_WIDTH = 650;
const DEFAULT_HEIGHT = 500;
const HTML_DEFAULT_WIDTH = 900;
const HTML_DEFAULT_HEIGHT = 700;

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

export const FloatingDeliverablePanel = memo(function FloatingDeliverablePanel({
  deliverable,
  onClose,
  zIndex = 45,
  initialOffset = 0,
  onFocus,
  isFocused = false,
}: {
  deliverable: TicketDeliverable;
  onClose: () => void;
  zIndex?: number;
  initialOffset?: number;
  onFocus?: () => void;
  isFocused?: boolean;
}) {
  const types = useDeliverableTypesStore((s) => s.types);
  const renderer = useDeliverableTypesStore((s) => s.rendererFor)(deliverable.type);
  const typeLabel = useDeliverableTypesStore((s) => s.labelFor)(deliverable.type);
  const typeColor = useDeliverableTypesStore((s) => s.colorFor)(deliverable.type);
  const isHtml = renderer === 'html';

  // Build the type options for the unitary type-change control. Include the
  // current type even if it's a system/legacy value so the select reflects it.
  const typeOptions = types.filter((t) => !t.system || t.id === deliverable.type);
  if (!typeOptions.some((t) => t.id === deliverable.type)) {
    typeOptions.push({ id: deliverable.type, label: deliverable.type, description: '', renderer });
  }

  const handleChangeType = useCallback(async (newType: string) => {
    if (newType === deliverable.type) return;
    try {
      const updated = await api.changeDeliverableType(deliverable.id, newType);
      useUIStore.getState().openDeliverableOverlay(updated);
      // Refresh the Documents list if it has loaded data.
      const docs = useDocumentsStore.getState();
      if (docs.deliverables.length > 0) docs.fetchAll();
      // Refresh usage counts for the backoffice.
      useDeliverableTypesStore.getState().load();
      useToastStore.getState().addToast('success', `Type changed to ${newType}`);
    } catch {
      // error toast handled by api.ts
    }
  }, [deliverable.id, deliverable.type]);

  const { size, effectivePos, setPosition, handleResizeMouseDown } = useFloatingResize({
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    defaultWidth: isHtml ? HTML_DEFAULT_WIDTH : DEFAULT_WIDTH,
    defaultHeight: isHtml ? HTML_DEFAULT_HEIGHT : DEFAULT_HEIGHT,
    initialOffset,
  });

  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  // Drag handlers
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: effectivePos.x,
      startPosY: effectivePos.y,
    };
    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const rawX = dragRef.current.startPosX + (me.clientX - dragRef.current.startX);
      const rawY = dragRef.current.startPosY + (me.clientY - dragRef.current.startY);
      setPosition(clampPosition(rawX, rawY, size.width, size.height));
    };
    const handleUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [effectivePos, size, setPosition]);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: 'none' }}>
      <div
        data-floating-panel
        onMouseDown={onFocus}
        style={{
          position: 'absolute',
          left: effectivePos.x,
          top: effectivePos.y,
          width: size.width,
          height: size.height,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          overflow: 'hidden',
          pointerEvents: 'auto',
          border: isFocused
            ? '1px solid var(--theme-border)'
            : '1px solid var(--theme-border-subtle)',
          boxShadow: isFocused
            ? '0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 2px var(--theme-accent), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
            : '0 24px 80px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
          transition: 'border 0.15s ease, box-shadow 0.15s ease',
          background: 'var(--theme-glass-overlay)',
          backdropFilter: 'blur(32px) saturate(1.8) brightness(1.1)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.8) brightness(1.1)',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: TITLE_BAR_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'grab',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'var(--theme-bg-hover)',
            flexShrink: 0,
            userSelect: 'none',
          }}
          onMouseDown={handleTitleMouseDown}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: typeColor?.bg ?? 'var(--theme-accent-muted)',
              color: typeColor?.text ?? 'var(--theme-accent)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
            }}
          >
            {typeLabel}
          </span>

          <span
            style={{
              color: 'var(--theme-text-primary)',
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {deliverable.title}
          </span>

          {deliverable.version > 1 && (
            <span style={{ fontSize: 10, color: 'var(--theme-text-faint)', flexShrink: 0 }}>
              v{deliverable.version}
            </span>
          )}
          {deliverable.status === 'draft' && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                padding: '0 6px',
                borderRadius: PILL_BORDER_RADIUS,
                backgroundColor: 'var(--theme-warning)/15',
                color: 'var(--theme-warning)',
                flexShrink: 0,
              }}
            >
              draft
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Unitary type change */}
          <select
            value={deliverable.type}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); handleChangeType(e.target.value); }}
            title="Change deliverable type"
            style={{
              fontSize: 10,
              padding: '1px 4px',
              borderRadius: 4,
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-bg-input)',
              color: 'var(--theme-text-secondary)',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            {typeOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>

          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'var(--theme-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 14,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--theme-danger)';
              (e.currentTarget as HTMLElement).style.background = 'var(--theme-danger)/15';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-muted)';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            title="Close floating deliverable"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        {isHtml ? (
          <iframe
            srcDoc={deliverable.content.replace(/<\\\/script\s*>/gi, '</script>')}
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              border: 'none',
              borderRadius: 0,
              background: '#fff',
            }}
            title={deliverable.title}
          />
        ) : (
          <div
            className="deliverable-overlay-content"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}
          >
            <MarkdownRenderer content={deliverable.content} onToggleCheckbox={noopToggle} />
          </div>
        )}

        {/* Status bar */}
        <div
          style={{
            height: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'var(--theme-bg-hover)',
            fontSize: 10,
            color: 'var(--theme-text-muted)',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--theme-accent)' }}>{deliverable.agentName}</span>
          <span>&middot;</span>
          <span>{relativeTime(deliverable.createdAt)}</span>
        </div>

      </div>

      {/* Edge resize handles */}
      <div style={{ position: 'absolute', top: effectivePos.y - 3, left: effectivePos.x + 8, width: size.width - 16, height: 6, cursor: 'n-resize', pointerEvents: 'auto' }} onMouseDown={handleResizeMouseDown('n')} />
      <div style={{ position: 'absolute', top: effectivePos.y + size.height - 3, left: effectivePos.x + 8, width: size.width - 16, height: 6, cursor: 's-resize', pointerEvents: 'auto' }} onMouseDown={handleResizeMouseDown('s')} />
      <div style={{ position: 'absolute', top: effectivePos.y + 8, left: effectivePos.x - 3, width: 6, height: size.height - 16, cursor: 'w-resize', pointerEvents: 'auto' }} onMouseDown={handleResizeMouseDown('w')} />
      <div style={{ position: 'absolute', top: effectivePos.y + 8, left: effectivePos.x + size.width - 3, width: 6, height: size.height - 16, cursor: 'e-resize', pointerEvents: 'auto' }} onMouseDown={handleResizeMouseDown('e')} />

      {/* Corner resize handles */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <div
          key={corner}
          style={{
            position: 'absolute',
            top: corner.includes('n') ? effectivePos.y - 4 : effectivePos.y + size.height - 8,
            left: corner.includes('w') ? effectivePos.x - 4 : effectivePos.x + size.width - 8,
            width: 12,
            height: 12,
            cursor: `${corner}-resize`,
            pointerEvents: 'auto',
          }}
          onMouseDown={handleResizeMouseDown(corner)}
        >
          {corner === 'se' && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              style={{ position: 'absolute', bottom: 1, right: 1 }}
            >
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="var(--theme-border)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
});
