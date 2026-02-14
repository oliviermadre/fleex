import { memo, useCallback, useRef, useEffect, useState } from 'react';
import type { MapObject, OfficeSelection, DataOverlayTarget } from './types';
import { TILE_PX } from './types';
import { ObjectSprite } from './ObjectSprite';
import { StatusBadge } from './StatusBadge';
import { OfficeTooltip } from './OfficeTooltip';
import { OFFICE, getStatusLabel } from './officeTheme';
import { useUIStore } from '../../stores/uiStore';
import type { Session } from '@asm/shared';

interface OfficeObjectProps {
  object: MapObject;
  selected: boolean;
  session?: Session;
  displayName?: string;
  worktreeShellSessionId?: string;
  onSelect: (selection: OfficeSelection) => void;
  onFocusSession: (sessionId: string) => void;
  onContextMenu?: (e: React.MouseEvent, object: MapObject) => void;
  onOpenDataOverlay?: (target: DataOverlayTarget) => void;
}

const Z_LAYERS: Record<string, number> = {
  desk: 5,
  computer: 6,
  whiteboard: 5,
  bookshelf: 5,
  door: 3,
  sign: 4,
  robot: 10,
  delivery: 5,
  'work-pile': 5,
};

function getRobotAssetKey(session?: Session): string {
  if (!session) return 'robot';
  const activity = session.claudeActivity ?? 'idle';
  if (activity === 'working' || activity === 'executing') return 'robot-working';
  if (activity.startsWith('waiting_')) return 'robot-thinking';
  if (activity === 'unknown') return 'robot-error';
  return 'robot-idle';
}

function getObjectLabel(object: MapObject, session?: Session, displayName?: string): string | undefined {
  if (object.type === 'robot' && session) {
    return displayName || 'Claude';
  }
  if (object.type === 'sign' && object.binding?.type === 'worktree') {
    const branch = object.binding.branch;
    return branch.length > 14 ? branch.slice(0, 13) + '\u2026' : branch;
  }
  if (object.type === 'sign' && object.binding?.type === 'repo') {
    const name = object.binding.repoKey.split('/')[1] ?? object.binding.repoKey;
    return name;
  }
  return undefined;
}

function getRobotAnimation(session?: Session): string {
  if (!session || session.type !== 'claude') return 'office-robot-idle';
  const activity = session.claudeActivity ?? 'idle';
  if (activity === 'working') return 'office-robot-working';
  if (activity === 'executing') return 'office-robot-working';
  if (activity.startsWith('waiting_')) return 'office-robot-thinking';
  if (activity === 'unknown') return 'office-robot-error';
  return 'office-robot-idle';
}

/** Build tooltip content for an object */
function getTooltipContent(object: MapObject, session?: Session, displayName?: string): React.ReactNode | null {
  if (object.type === 'robot' && session) {
    const activity = session.claudeActivity ?? 'idle';
    const cwd = session.cwd.replace(/^\/Users\/[^/]+/, '~');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600 }}>{displayName || session.tmuxName}</span>
        <span style={{ color: OFFICE.textSecondary, fontSize: 10 }}>
          {session.type === 'claude' ? 'Claude' : 'Shell'} &middot; {getStatusLabel(activity)}
        </span>
        <span style={{ color: OFFICE.textMuted, fontSize: 10 }}>{cwd}</span>
        {session.repositoryName && (
          <span style={{ color: OFFICE.textMuted, fontSize: 10 }}>
            {session.repositoryOrg}/{session.repositoryName}
            {session.worktreeBranch ? ` \u2192 ${session.worktreeBranch}` : ''}
          </span>
        )}
      </div>
    );
  }

  if ((object.type === 'computer' || object.type === 'desk') && object.binding?.type === 'worktree') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600 }}>{object.binding.branch}</span>
        <span style={{ color: OFFICE.textMuted, fontSize: 10 }}>{object.binding.path}</span>
      </div>
    );
  }

  if (object.type === 'sign' && object.binding?.type === 'worktree') {
    return <span>{object.binding.branch}</span>;
  }

  if (object.type === 'sign' && object.binding?.type === 'repo') {
    return <span>{object.binding.repoKey}</span>;
  }

  if (object.type === 'whiteboard') {
    return <span>Scratchpad</span>;
  }

  if (object.type === 'door') {
    return <span>Room entrance</span>;
  }

  if (object.type === 'bookshelf') {
    return <span>PR Library (double-click to open)</span>;
  }

  if (object.type === 'delivery') {
    return <span>Recently Merged PRs (double-click to open)</span>;
  }

  if (object.type === 'work-pile') {
    return <span>Assigned Work (double-click to open)</span>;
  }

  return null;
}

/** Determine flash class for activity transitions */
function useActivityFlash(session?: Session): string | null {
  const prevActivity = useRef<string | undefined>(undefined);
  const [flashClass, setFlashClass] = useState<string | null>(null);

  const currentActivity = session?.claudeActivity ?? 'idle';

  useEffect(() => {
    const prev = prevActivity.current;
    prevActivity.current = currentActivity;

    if (prev === undefined) return; // Initial mount
    if (prev === currentActivity) return;

    if ((prev === 'idle' || prev === 'unknown') && (currentActivity === 'working' || currentActivity === 'executing')) {
      setFlashClass('office-flash-green');
    } else if (currentActivity.startsWith('waiting_')) {
      setFlashClass('office-flash-amber');
    } else {
      return; // No flash for other transitions
    }

    const timer = setTimeout(() => setFlashClass(null), 600);
    return () => clearTimeout(timer);
  }, [currentActivity]);

  return flashClass;
}

export const OfficeObject = memo(function OfficeObject({
  object,
  selected,
  session,
  displayName,
  worktreeShellSessionId,
  onSelect,
  onFocusSession,
  onContextMenu,
  onOpenDataOverlay,
}: OfficeObjectProps) {
  const x = object.tileX * TILE_PX;
  const y = object.tileY * TILE_PX;
  const zIndex = selected ? 20 : (Z_LAYERS[object.type] ?? object.zLayer);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (object.binding?.type === 'session') {
      onSelect({ type: 'session', sessionId: object.binding.sessionId });
    } else if (object.binding?.type === 'worktree') {
      onSelect({ type: 'worktree', repoKey: object.binding.repoKey, branch: object.binding.branch });
    } else if (object.binding?.type === 'repo') {
      onSelect({ type: 'repo', repoKey: object.binding.repoKey });
    }
  }, [object.binding, onSelect]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (object.binding?.type === 'session') {
      onFocusSession(object.binding.sessionId);
    } else if (object.type === 'computer' && worktreeShellSessionId) {
      onFocusSession(worktreeShellSessionId);
    } else if (object.type === 'whiteboard') {
      useUIStore.getState().toggleScratchpad();
    } else if (object.type === 'bookshelf' && object.binding?.type === 'repo-prs') {
      onOpenDataOverlay?.({ type: 'pr-library', repoKey: object.binding.repoKey });
    } else if (object.type === 'delivery' && object.binding?.type === 'repo-merged') {
      onOpenDataOverlay?.({ type: 'merged', repoKey: object.binding.repoKey });
    } else if (object.type === 'work-pile' && object.binding?.type === 'repo-assigned') {
      onOpenDataOverlay?.({ type: 'assigned', repoKey: object.binding.repoKey });
    }
  }, [object, worktreeShellSessionId, onFocusSession, onOpenDataOverlay]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, object);
  }, [object, onContextMenu]);

  const isRobot = object.type === 'robot';
  const assetKey = isRobot ? getRobotAssetKey(session) : undefined;
  const label = getObjectLabel(object, session, displayName);
  const animClass = isRobot ? getRobotAnimation(session) : undefined;
  const activity = session?.claudeActivity ?? 'idle';
  const flashClass = useActivityFlash(session);
  const isEmptyDesk = object.type === 'desk' && !object.binding;

  const tooltipContent = getTooltipContent(object, session, displayName);

  const element = (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex,
        cursor: object.binding || object.type === 'whiteboard' || object.type === 'bookshelf' || object.type === 'delivery' || object.type === 'work-pile' ? 'pointer' : 'default',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Selection ring */}
      {selected && (
        <div
          className="office-selection-pulse"
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: isRobot ? '50%' : 6,
            border: `2px solid ${OFFICE.selectionBlue}`,
            boxShadow: `0 0 12px ${OFFICE.selectionGlow}`,
            pointerEvents: 'none',
            zIndex: -1,
          }}
        />
      )}

      {/* Activity change flash ring */}
      {flashClass && (
        <div
          className={flashClass}
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: -1,
          }}
        />
      )}

      {/* Sprite with animation */}
      <div className={animClass}>
        <ObjectSprite
          type={object.type}
          assetKey={assetKey}
          tileW={object.tileW}
          tileH={object.tileH}
          label={label}
          empty={isEmptyDesk}
        />
      </div>

      {/* Status badge for robots */}
      {isRobot && session && activity !== 'idle' && (
        <StatusBadge activity={activity} />
      )}
    </div>
  );

  if (tooltipContent) {
    return (
      <OfficeTooltip content={tooltipContent}>
        {element}
      </OfficeTooltip>
    );
  }

  return element;
});
