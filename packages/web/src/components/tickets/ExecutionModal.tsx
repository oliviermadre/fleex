import { memo, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { EXECUTION_STATES, type ExecutionState } from '@fleex/shared';

import { useFloatingResize, clampPosition } from '../../hooks/useFloatingResize';
import { cancelExecution } from '../../services/api';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { AgentEventStream } from '../main-panel/AgentEventStream';

const MIN_WIDTH = 480;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 480;

export const FloatingExecutionPanel = memo(function FloatingExecutionPanel({
  executionId,
  title,
  onClose,
}: {
  executionId: string;
  title: string;
  onClose: () => void;
}) {
  const { size, effectivePos, setPosition, handleResizeMouseDown } = useFloatingResize({
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    initialOffset: 0,
  });

  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  // --- Terminate button state ---
  const isRunning = useAgentEventStore((s) => {
    if (!s.streamingExecutionIds[executionId]) return false;
    const events = s.eventsByExecution[executionId] ?? [];
    return !events.some((e) => e.eventType === 'execution_end');
  });

  const [terminateState, setTerminateState] = useState<ExecutionState>(EXECUTION_STATES.IDLE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTerminate = useCallback(async () => {
    if (terminateState === EXECUTION_STATES.IDLE) {
      setTerminateState(EXECUTION_STATES.CONFIRMING);
      timerRef.current = setTimeout(() => setTerminateState(EXECUTION_STATES.IDLE), 1500);
    } else if (terminateState === EXECUTION_STATES.CONFIRMING) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setTerminateState(EXECUTION_STATES.TERMINATING);
      try {
        await cancelExecution(executionId);
        setTerminateState(EXECUTION_STATES.DONE);
      } catch {
        setTerminateState(EXECUTION_STATES.ERROR);
        setTimeout(() => setTerminateState(EXECUTION_STATES.IDLE), 2000);
      }
    }
  }, [terminateState, executionId]);

  const showTerminate = isRunning && terminateState !== EXECUTION_STATES.DONE;
  // --- End terminate button state ---

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [effectivePos, size, setPosition],
  );

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 55, pointerEvents: 'none' }}>
      {/* Floating panel */}
      <div
        data-floating-panel
        style={{
          position: 'absolute',
          left: effectivePos.x,
          top: effectivePos.y,
          width: size.width,
          height: size.height,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          overflow: 'hidden',
          pointerEvents: 'auto',
          border: '1px solid var(--theme-border)',
          boxShadow:
            '0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--theme-accent), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          background: 'var(--theme-glass-overlay)',
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
            background: 'var(--theme-bg-hover)',
            flexShrink: 0,
            userSelect: 'none',
          }}
          onMouseDown={handleTitleMouseDown}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--theme-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>

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
            {title}
          </span>

          <span
            style={{
              fontSize: 9,
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: 'var(--theme-bg-hover)',
              color: 'var(--theme-text-faint)',
              fontFamily: 'monospace',
              flexShrink: 0,
            }}
          >
            {executionId.slice(0, 8)}
          </span>

          <div style={{ flex: 1 }} />

          {/* Terminate button */}
          {showTerminate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTerminate();
              }}
              disabled={terminateState === EXECUTION_STATES.TERMINATING}
              title="Stop agent execution"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 4,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: terminateState === EXECUTION_STATES.TERMINATING ? 'wait' : 'pointer',
                background:
                  terminateState === EXECUTION_STATES.CONFIRMING
                    ? 'var(--theme-danger)'
                    : 'rgba(255, 80, 80, 0.15)',
                color:
                  terminateState === EXECUTION_STATES.CONFIRMING ? '#fff' : 'var(--theme-danger)',
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
              </svg>
              {terminateState === EXECUTION_STATES.IDLE && 'Terminate'}
              {terminateState === EXECUTION_STATES.CONFIRMING && 'Confirm kill?'}
              {terminateState === EXECUTION_STATES.TERMINATING && 'Stopping\u2026'}
              {terminateState === EXECUTION_STATES.ERROR && 'Failed'}
            </button>
          )}
          {terminateState === EXECUTION_STATES.DONE && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--theme-text-muted)',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Terminated
            </span>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
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
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>

        {/* Event stream */}
        <AgentEventStream executionId={executionId} />
      </div>

      {/* Edge resize handles */}
      <div
        style={{
          position: 'absolute',
          top: effectivePos.y - 3,
          left: effectivePos.x + 8,
          width: size.width - 16,
          height: 6,
          cursor: 'n-resize',
          pointerEvents: 'auto',
        }}
        onMouseDown={handleResizeMouseDown('n')}
      />
      <div
        style={{
          position: 'absolute',
          top: effectivePos.y + size.height - 3,
          left: effectivePos.x + 8,
          width: size.width - 16,
          height: 6,
          cursor: 's-resize',
          pointerEvents: 'auto',
        }}
        onMouseDown={handleResizeMouseDown('s')}
      />
      <div
        style={{
          position: 'absolute',
          top: effectivePos.y + 8,
          left: effectivePos.x - 3,
          width: 6,
          height: size.height - 16,
          cursor: 'w-resize',
          pointerEvents: 'auto',
        }}
        onMouseDown={handleResizeMouseDown('w')}
      />
      <div
        style={{
          position: 'absolute',
          top: effectivePos.y + 8,
          left: effectivePos.x + size.width - 3,
          width: 6,
          height: size.height - 16,
          cursor: 'e-resize',
          pointerEvents: 'auto',
        }}
        onMouseDown={handleResizeMouseDown('e')}
      />

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
              <path
                d="M9 1L1 9M9 5L5 9M9 9L9 9"
                stroke="var(--theme-border)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
});

// Re-export for backwards compatibility with existing imports
export { FloatingExecutionPanel as ExecutionModal };
