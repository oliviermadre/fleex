import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MapObject } from './types';
import { OFFICE } from './officeTheme';

export interface ContextMenuTarget {
  x: number;
  y: number;
  object: MapObject;
}

interface MenuItem {
  label: string;
  action: () => void;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

interface OfficeContextMenuProps {
  target: ContextMenuTarget;
  items: MenuEntry[];
  onClose: () => void;
}

export function OfficeContextMenu({ target, items, onClose }: OfficeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleClick, true);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('mousedown', handleClick, true);
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: target.x,
        top: target.y,
        zIndex: 110,
        minWidth: 160,
        background: OFFICE.panelBg,
        border: `1px solid ${OFFICE.panelBorder}`,
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontSize: 12,
        color: OFFICE.textPrimary,
      }}
    >
      {items.map((entry, i) => {
        if (entry.separator) {
          return (
            <div
              key={i}
              style={{
                height: 1,
                background: OFFICE.panelBorderDim,
                margin: '4px 0',
              }}
            />
          );
        }
        return (
          <button
            key={i}
            onClick={() => { entry.action(); onClose(); }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 14px',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              color: OFFICE.textPrimary,
              cursor: 'pointer',
              fontSize: 12,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = OFFICE.panelHighlight;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Build context menu items for a given object */
export function buildContextMenuItems(
  object: MapObject,
  actions: {
    focusSession: () => void;
    killSession: () => void;
    killWorktreeShell: () => void;
    createShell: () => void;
    createClaude: () => void;
    openPR: () => void;
    openDashboard: () => void;
    refreshRepo: () => void;
    openCreateModal: () => void;
    openScratchpad: () => void;
    openPRLibrary?: () => void;
    openMergedPRs?: () => void;
    openAssignedWork?: () => void;
  },
): MenuEntry[] {
  const binding = object.binding;

  if (object.type === 'robot' && binding?.type === 'session') {
    return [
      { label: 'Open Terminal', action: actions.focusSession },
      { label: 'Kill Session', action: actions.killSession },
    ];
  }

  if ((object.type === 'computer' || object.type === 'desk') && binding?.type === 'worktree') {
    return [
      { label: 'New Shell', action: actions.createShell },
      { label: 'New Claude', action: actions.createClaude },
      { separator: true },
      { label: 'Kill Shell', action: actions.killWorktreeShell },
      { separator: true },
      { label: 'Open PR on GitHub', action: actions.openPR },
    ];
  }

  if (object.type === 'whiteboard') {
    return [
      { label: 'Open Scratchpad', action: actions.openScratchpad },
    ];
  }

  if (object.type === 'sign' && binding?.type === 'repo') {
    return [
      { label: 'Open Dashboard', action: actions.openDashboard },
      { label: 'Refresh', action: actions.refreshRepo },
      { separator: true },
      { label: 'New Session', action: actions.openCreateModal },
    ];
  }

  if (object.type === 'bookshelf' && actions.openPRLibrary) {
    return [
      { label: 'View Pull Requests', action: actions.openPRLibrary },
    ];
  }

  if (object.type === 'delivery' && actions.openMergedPRs) {
    return [
      { label: 'View Merged PRs', action: actions.openMergedPRs },
    ];
  }

  if (object.type === 'work-pile' && actions.openAssignedWork) {
    return [
      { label: 'View Assigned Work', action: actions.openAssignedWork },
    ];
  }

  return [];
}
