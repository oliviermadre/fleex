import { memo, useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTerminal } from '../../hooks/useTerminal';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalManager } from '../../services/terminalManager';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';

const MIN_WIDTH = 480;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 500;

export const TerminalOverlay = memo(function TerminalOverlay({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
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

  // Focus terminal when overlay opens
  useEffect(() => {
    const inst = terminalManager.get(sessionId);
    if (inst) {
      setTimeout(() => inst.terminal.focus(), 100);
    }
  }, [sessionId]);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const resizeRef = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

  // Center on first render
  useEffect(() => {
    if (position !== null) return;
    setPosition({
      x: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
      y: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2 - 40),
    });
  }, [position]);

  const effectivePos = position ?? { x: 0, y: 0 };

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
      setPosition({
        x: dragRef.current.startPosX + (me.clientX - dragRef.current.startX),
        y: dragRef.current.startPosY + (me.clientY - dragRef.current.startY),
      });
    };
    const handleUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [effectivePos]);

  // Resize handle
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
      const newW = Math.max(MIN_WIDTH, resizeRef.current.startW + (me.clientX - resizeRef.current.startX));
      const newH = Math.max(MIN_HEIGHT, resizeRef.current.startH + (me.clientY - resizeRef.current.startY));
      setSize({ width: newW, height: newH });
      terminalManager.resize(sessionId);
    };
    const handleUp = () => {
      resizeRef.current.resizing = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      terminalManager.resize(sessionId);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size, sessionId]);

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
      {/* Floating panel */}
      <div
        ref={panelRef}
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
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5), 0 0 40px rgba(59, 130, 246, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
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
            {session.displayName || displayName || session.tmuxName}
          </span>

          <span
            style={{
              fontSize: 9,
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: isRobot ? 'rgba(59, 130, 246, 0.15)' : 'rgba(107, 114, 128, 0.25)',
              color: isRobot ? '#60a5fa' : 'var(--theme-text-secondary)',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {isRobot ? 'Claude' : 'Shell'}
          </span>

          {isRobot && activity !== 'idle' && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 3,
                backgroundColor: `${activityColor}22`,
                color: activityColor,
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {activity.replace(/_/g, ' ')}
            </span>
          )}

          <div style={{ flex: 1 }} />

          <span
            style={{
              color: 'var(--theme-text-muted)',
              fontSize: 10,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
            title={session.cwd}
          >
            {cwdDisplay}
          </span>

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
          style={{ flex: 1, minHeight: 0, background: '#1a1d23' }}
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
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: statusDotColor,
              display: 'inline-block',
            }}
          />
          <span>{connectionStatus}</span>

          {session.worktreeBranch && (
            <span style={{ color: 'var(--theme-text-faint)' }}>
              {session.repositoryOrg}/{session.repositoryName} &rarr; {session.worktreeBranch}
            </span>
          )}
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

/**
 * Global floating session overlay — renders via portal so it persists across all view switches.
 * Reads `floatingSessionId` from uiStore.
 */
export function FloatingSessionOverlay() {
  const floatingSessionId = useUIStore((s) => s.floatingSessionId);
  const setFloatingSession = useUIStore((s) => s.setFloatingSession);

  const onClose = useCallback(() => {
    setFloatingSession(null);
  }, [setFloatingSession]);

  if (!floatingSessionId) return null;

  return <TerminalOverlay sessionId={floatingSessionId} onClose={onClose} />;
}
