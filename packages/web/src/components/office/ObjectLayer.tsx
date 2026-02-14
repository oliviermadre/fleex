import { memo } from 'react';
import type { MapObject, OfficeSelection, DataOverlayTarget } from './types';
import type { Session } from '@asm/shared';
import { OfficeObject } from './OfficeObject';

interface ObjectLayerProps {
  objects: MapObject[];
  selection: OfficeSelection;
  sessions: Session[];
  displayNames: Record<string, string>;
  onSelect: (selection: OfficeSelection) => void;
  onFocusSession: (sessionId: string) => void;
  onContextMenu?: (e: React.MouseEvent, object: MapObject) => void;
  onOpenDataOverlay?: (target: DataOverlayTarget) => void;
}

/** Maps MapObject[] to positioned DOM elements */
export const ObjectLayer = memo(function ObjectLayer({
  objects,
  selection,
  sessions,
  displayNames,
  onSelect,
  onFocusSession,
  onContextMenu,
  onOpenDataOverlay,
}: ObjectLayerProps) {
  return (
    <>
      {objects.map((obj) => {
        // Determine if this object is selected
        const isSelected = isObjectSelected(obj, selection);

        // Find associated session for robots
        const binding = obj.binding;
        const session = binding?.type === 'session'
          ? sessions.find((s) => s.id === binding.sessionId)
          : undefined;

        const displayName = binding?.type === 'session'
          ? displayNames[binding.sessionId]
          : undefined;

        // For computers bound to a worktree, find the first shell session to open on double-click
        let worktreeShellSessionId: string | undefined;
        if (obj.type === 'computer' && binding?.type === 'worktree') {
          const shell = sessions.find(
            (s) => s.type === 'shell' &&
              s.worktreeBranch === binding.branch &&
              `${s.repositoryOrg}/${s.repositoryName}` === binding.repoKey,
          );
          worktreeShellSessionId = shell?.id;
        }

        return (
          <OfficeObject
            key={obj.id}
            object={obj}
            selected={isSelected}
            session={session}
            displayName={displayName}
            worktreeShellSessionId={worktreeShellSessionId}
            onSelect={onSelect}
            onFocusSession={onFocusSession}
            onContextMenu={onContextMenu}
            onOpenDataOverlay={onOpenDataOverlay}
          />
        );
      })}
    </>
  );
});

function isObjectSelected(obj: MapObject, selection: OfficeSelection): boolean {
  if (!selection) return false;

  if (selection.type === 'session' && obj.binding?.type === 'session') {
    return obj.binding.sessionId === selection.sessionId;
  }
  if (selection.type === 'worktree' && obj.binding?.type === 'worktree') {
    return obj.binding.repoKey === selection.repoKey && obj.binding.branch === selection.branch;
  }
  if (selection.type === 'repo' && obj.binding?.type === 'repo') {
    return obj.binding.repoKey === selection.repoKey;
  }

  return false;
}
