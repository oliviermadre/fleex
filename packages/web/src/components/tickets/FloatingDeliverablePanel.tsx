import { memo, useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TicketDeliverable } from '@fleex/shared';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';

const MIN_WIDTH = 400;
const MIN_HEIGHT = 250;
const DEFAULT_WIDTH = 650;
const DEFAULT_HEIGHT = 500;

function clampPosition(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, window.innerWidth - w)),
    y: Math.max(0, Math.min(y, window.innerHeight - h)),
  };
}

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

function typeIcon(type: string): string {
  switch (type) {
    case 'prd': return 'PRD';
    case 'spec': return 'SPEC';
    case 'url': return 'URL';
    case 'pr': return 'PR';
    case 'plan': return 'PLAN';
    default: return type.toUpperCase().slice(0, 4);
  }
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
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const resizeRef = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

  // Center on first render (with cascade offset)
  useEffect(() => {
    if (position !== null) return;
    const rawX = (window.innerWidth - DEFAULT_WIDTH) / 2 + initialOffset;
    const rawY = (window.innerHeight - DEFAULT_HEIGHT) / 2 - 40 + initialOffset;
    setPosition(clampPosition(rawX, rawY, DEFAULT_WIDTH, DEFAULT_HEIGHT));
  }, [position, initialOffset]);

  const effectivePos = position ?? { x: 0, y: 0 };

  // Re-clamp on window resize
  useEffect(() => {
    function handleWindowResize() {
      setPosition((prev) => prev ? clampPosition(prev.x, prev.y, size.width, size.height) : prev);
    }
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [size.width, size.height]);

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
  }, [effectivePos, size]);

  // Resize handlers
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      resizing: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };
    const handleMove = (me: MouseEvent) => {
      if (!resizeRef.current.resizing) return;
      const rawW = Math.max(MIN_WIDTH, resizeRef.current.startW + (me.clientX - resizeRef.current.startX));
      const rawH = Math.max(MIN_HEIGHT, resizeRef.current.startH + (me.clientY - resizeRef.current.startY));
      const newW = Math.min(rawW, window.innerWidth);
      const newH = Math.min(rawH, window.innerHeight);
      setSize({ width: newW, height: newH });
      setPosition((prev) => prev ? clampPosition(prev.x, prev.y, newW, newH) : prev);
    };
    const handleUp = () => {
      resizeRef.current.resizing = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size]);

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
            ? '1px solid rgba(255, 255, 255, 0.3)'
            : '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: isFocused
            ? '0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(59, 130, 246, 0.3), 0 0 40px rgba(59, 130, 246, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
            : '0 24px 80px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
          transition: 'border 0.15s ease, box-shadow 0.15s ease',
          background: 'rgba(10, 10, 15, 0.45)',
          backdropFilter: 'blur(32px) saturate(1.8) brightness(1.1)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.8) brightness(1.1)',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'grab',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(255, 255, 255, 0.08)',
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
              backgroundColor: 'var(--theme-accent-muted)',
              color: 'var(--theme-accent)',
              flexShrink: 0,
            }}
          >
            {typeIcon(deliverable.type)}
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
                borderRadius: 9999,
                backgroundColor: 'rgba(234, 179, 8, 0.15)',
                color: '#facc15',
                flexShrink: 0,
              }}
            >
              draft
            </span>
          )}

          <div style={{ flex: 1 }} />

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
              (e.currentTarget as HTMLElement).style.color = '#ef4444';
              (e.currentTarget as HTMLElement).style.background = 'rgba(239, 68, 68, 0.15)';
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
        <div
          className="deliverable-overlay-content"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}
        >
          <MarkdownRenderer content={deliverable.content} onToggleCheckbox={noopToggle} />
        </div>

        {/* Status bar */}
        <div
          style={{
            height: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(255, 255, 255, 0.08)',
            fontSize: 10,
            color: 'var(--theme-text-muted)',
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#c084fc' }}>{deliverable.agentName}</span>
          <span>&middot;</span>
          <span>{relativeTime(deliverable.createdAt)}</span>
        </div>

        {/* Resize handle */}
        <div
          style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, cursor: 'se-resize' }}
          onMouseDown={handleResizeMouseDown}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{ position: 'absolute', bottom: 3, right: 3 }}
          >
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="var(--theme-border)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  );
});
