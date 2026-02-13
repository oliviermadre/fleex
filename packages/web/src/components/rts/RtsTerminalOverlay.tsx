import { memo, useRef, useEffect, useCallback, useState } from 'react';
import type { Session } from '@asm/shared';
import { useTerminal } from '../../hooks/useTerminal';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalManager } from '../../services/terminalManager';
import { useSettingsStore } from '../../stores/settingsStore';
import { ZERG } from './rtsTheme';

interface RtsTerminalOverlayProps {
  session: Session;
  onClose: () => void;
}

const MIN_WIDTH = 480;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 500;

export const RtsTerminalOverlay = memo(function RtsTerminalOverlay({
  session,
  onClose,
}: RtsTerminalOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useTerminal(session.id, containerRef);

  const connectionStatus = useTerminalStore(
    (s) => s.connectionStatus[session.id] ?? 'disconnected'
  );
  const displayName = useSettingsStore(
    (s) => s.settings.sessionDisplayNames[session.id]
  );

  // Focus the terminal when the overlay opens
  useEffect(() => {
    const inst = terminalManager.get(session.id);
    if (inst) {
      setTimeout(() => inst.terminal.focus(), 100);
    }
  }, [session.id]);

  // Escape closes the overlay (only when terminal isn't capturing it)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
  const resizeRef = useRef({ resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 });

  // Center on first render
  useEffect(() => {
    if (position !== null) return;
    setPosition({
      x: Math.max(0, (window.innerWidth - size.width) / 2),
      y: Math.max(0, (window.innerHeight - size.height) / 2 - 40),
    });
  }, [position, size]);

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
      // Trigger xterm fit
      terminalManager.resize(session.id);
    };
    const handleUp = () => {
      resizeRef.current.resizing = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      // Final fit
      terminalManager.resize(session.id);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size, session.id]);

  const isDrone = session.type === 'claude';
  const activity = session.claudeActivity ?? 'idle';
  const activityColor =
    activity === 'working' || activity === 'executing'
      ? ZERG.activeGreen
      : activity.startsWith('waiting_')
        ? ZERG.waitingAmber
        : ZERG.textMuted;

  const statusDotColor = {
    connecting: ZERG.waitingAmber,
    connected: ZERG.activeGreen,
    disconnected: ZERG.textFaint,
  }[connectionStatus];

  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      {/* Semi-transparent backdrop — click to close */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(5, 2, 10, 0.5)',
          pointerEvents: 'auto',
        }}
        onClick={onClose}
      />

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
          border: `1px solid ${ZERG.carapaceBorder}`,
          boxShadow: `
            0 0 0 1px ${ZERG.carapaceBorderDim},
            0 24px 80px rgba(0, 0, 0, 0.6),
            0 0 40px rgba(138, 43, 226, 0.1),
            inset 0 1px 0 rgba(180, 100, 255, 0.1)
          `,
          background: ZERG.carapaceBg,
        }}
      >
        {/* Title bar — draggable */}
        <div
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'grab',
            borderBottom: `1px solid ${ZERG.carapaceBorderDim}`,
            background: 'linear-gradient(180deg, rgba(40, 20, 65, 0.6) 0%, rgba(20, 10, 35, 0.8) 100%)',
            flexShrink: 0,
            userSelect: 'none',
          }}
          onMouseDown={handleTitleMouseDown}
        >
          {/* Unit type indicator */}
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

          {/* Session name */}
          <span
            style={{
              color: ZERG.textPrimary,
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName || session.tmuxName}
          </span>

          {/* Type badge */}
          <span
            style={{
              fontSize: 9,
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: isDrone ? `${ZERG.droneBody}22` : `${ZERG.overlordBody}44`,
              color: isDrone ? ZERG.droneBody : ZERG.textSecondary,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {isDrone ? 'Drone' : 'Overlord'}
          </span>

          {/* Activity badge */}
          {isDrone && activity !== 'idle' && (
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

          {/* CWD */}
          <span
            style={{
              color: ZERG.textMuted,
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

          {/* Close button */}
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
              color: ZERG.textMuted,
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 14,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = ZERG.dangerRed;
              (e.currentTarget as HTMLElement).style.background = `${ZERG.dangerRed}22`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = ZERG.textMuted;
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Terminal area */}
        <div
          ref={containerRef}
          className="xterm-container"
          style={{
            flex: 1,
            minHeight: 0,
            background: '#0a0514',
          }}
        />

        {/* Status bar */}
        <div
          style={{
            height: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            borderTop: `1px solid ${ZERG.carapaceBorderDim}`,
            background: 'rgba(20, 10, 35, 0.8)',
            fontSize: 10,
            color: ZERG.textMuted,
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
            <span style={{ color: ZERG.textFaint }}>
              {session.repositoryOrg}/{session.repositoryName} → {session.worktreeBranch}
            </span>
          )}

          <div style={{ flex: 1 }} />
          <span style={{ color: ZERG.textFaint, fontSize: 9 }}>Esc to close</span>
        </div>

        {/* Resize handle (bottom-right corner) */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 16,
            height: 16,
            cursor: 'se-resize',
          }}
          onMouseDown={handleResizeMouseDown}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{ position: 'absolute', bottom: 3, right: 3 }}
          >
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke={ZERG.carapaceBorderDim} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
});
