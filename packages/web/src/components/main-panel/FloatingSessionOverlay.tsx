import { memo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTerminal } from '../../hooks/useTerminal';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalManager } from '../../services/terminalManager';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFloatingResize, clampPosition } from '../../hooks/useFloatingResize';

const MIN_WIDTH = 480;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 500;

// Position registry for spatial keyboard navigation between floating overlays
export const floatingPositionRegistry = new Map<string, { x: number; y: number; width: number; height: number }>();

export const TerminalOverlay = memo(function TerminalOverlay({
  sessionId,
  onClose,
  zIndex = 50,
  initialOffset = 0,
  onFocus,
  isFocused = false,
}: {
  sessionId: string;
  onClose: () => void;
  zIndex?: number;
  initialOffset?: number;
  onFocus?: () => void;
  isFocused?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);

  const sessions = useSessionStore((s) => s.sessions);
  const session = sessions.find((s) => s.id === sessionId) ?? null;

  const connectionStatus = useTerminalStore(
    (s) => s.connectionStatus[sessionId] ?? 'disconnected',
  );
  const displayName = useSettingsStore(
    (s) => s.settings.sessionDisplayNames[sessionId],
  );

  // Enable floating mode (transparent bg, no WebGL) and focus terminal
  useEffect(() => {
    terminalManager.setFloatingMode(sessionId, true);
    const inst = terminalManager.get(sessionId);
    if (inst) {
      setTimeout(() => inst.terminal.focus(), 100);
    }
    return () => {
      terminalManager.setFloatingMode(sessionId, false);
    };
  }, [sessionId]);

  const onResizeMove = useCallback(() => terminalManager.resize(sessionId), [sessionId]);
  const { size, position, effectivePos, setPosition, handleResizeMouseDown } = useFloatingResize({
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    initialOffset,
    onResizeMove,
    onResizeEnd: onResizeMove,
  });

  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  // Sync position registry for spatial keyboard navigation
  useEffect(() => {
    floatingPositionRegistry.set(sessionId, {
      x: effectivePos.x,
      y: effectivePos.y,
      width: size.width,
      height: size.height,
    });
    return () => { floatingPositionRegistry.delete(sessionId); };
  }, [sessionId, effectivePos.x, effectivePos.y, size.width, size.height]);

  // Title bar drag handlers
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

  if (!session) return null;

  const isRobot = session.type === 'claude';
  const activity = session.claudeActivity ?? 'idle';

  const activityColorMap: Record<string, string> = {
    working: '#3b82f6',
    executing: '#3b82f6',
    waiting_tool_approval: '#f59e0b',
    waiting_user_choice: '#f59e0b',
    waiting_plan_approval: '#f59e0b',
    idle: '#6b7280',
    unknown: '#6b7280',
  };
  const activityColor = activityColorMap[activity] ?? '#6b7280';

  const statusDotColorMap: Record<string, string> = {
    connecting: '#f59e0b',
    connected: '#22c55e',
    disconnected: '#6b7280',
  };
  const statusDotColor = statusDotColorMap[connectionStatus] ?? '#6b7280';

  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: 'none' }}>
      {/* Floating panel */}
      <div
        ref={panelRef}
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
          borderRadius: 8,
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
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: activityColor,
              boxShadow: `0 0 4px ${activityColor}`,
              flexShrink: 0,
            }}
          />

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
            {session.worktreeBranch
              ? `${session.repositoryOrg}/${session.repositoryName} \u2192 ${session.worktreeBranch} \u2192 ${session.displayName || displayName || session.tmuxName}`
              : session.displayName || displayName || session.tmuxName}
          </span>

          <div style={{ flex: 1 }} />

          {isRobot && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 3,
                backgroundColor: `${activityColor}22`,
                color: activityColor,
                fontWeight: 600,
                textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              {activity.replace(/_/g, ' ')}
            </span>
          )}

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
            title="Close overlay — session keeps running"
          >
            &times;
          </button>
        </div>

        {/* Disconnected bar */}
        {connectionStatus === 'disconnected' && (
          <div
            style={{
              padding: '6px 12px',
              background: 'rgba(245, 158, 11, 0.12)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
              color: '#f59e0b',
              fontSize: 11,
              fontWeight: 600,
              textAlign: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onClick={() => {
              const el = containerRef.current;
              if (el) terminalManager.attach(sessionId, el);
            }}
          >
            Disconnected — click to reconnect
          </div>
        )}

        {/* Terminal area */}
        <div
          ref={containerRef}
          className="xterm-container"
          style={{ flex: 1, minHeight: 0 }}
        />

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
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'clip',
              whiteSpace: 'nowrap',
            }}
            title={session.cwd}
          >
            {cwdDisplay}
          </span>

          <div style={{ flex: 1 }} />

          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: statusDotColor,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span style={{ flexShrink: 0 }}>{connectionStatus}</span>
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

/**
 * Global floating session overlay — renders via portal so it persists across all view switches.
 * Reads `floatingSessionIds` from uiStore and renders one TerminalOverlay per id.
 */
export function FloatingSessionOverlay() {
  const floatingSessionIds = useUIStore((s) => s.floatingSessionIds);
  const floatingPanelOrder = useUIStore((s) => s.floatingPanelOrder);
  const focusedFloatingPanelId = useUIStore((s) => s.focusedFloatingPanelId);
  const removeFloatingSession = useUIStore((s) => s.removeFloatingSession);
  const bringToFront = useUIStore((s) => s.bringToFront);
  const clearFloatingPanelFocus = useUIStore((s) => s.clearFloatingPanelFocus);

  // Click-outside detection: clear focus when clicking outside all floating panels
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-floating-panel]')) {
        clearFloatingPanelFocus();
      }
    }
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [clearFloatingPanelFocus]);

  if (floatingSessionIds.length === 0) return null;

  return (
    <>
      {floatingSessionIds.map((id, index) => (
        <TerminalOverlay
          key={id}
          sessionId={id}
          onClose={() => removeFloatingSession(id)}
          zIndex={45 + Math.max(0, floatingPanelOrder.indexOf(id))}
          initialOffset={index * 30}
          onFocus={() => bringToFront(id)}
          isFocused={focusedFloatingPanelId === id}
        />
      ))}
    </>
  );
}
