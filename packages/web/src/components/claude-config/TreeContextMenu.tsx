import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';

export function TreeContextMenu() {
  const contextMenu = useClaudeConfigStore((s) => s.contextMenu);
  const closeContextMenu = useClaudeConfigStore((s) => s.closeContextMenu);
  const startCreate = useClaudeConfigStore((s) => s.startCreate);
  const requestDelete = useClaudeConfigStore((s) => s.requestDelete);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  const { x, y, targetPath, targetIsDir } = contextMenu;
  const name = targetPath.split('/').pop() ?? targetPath;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {targetIsDir ? (
        <>
          <MenuItem
            label="New File"
            onClick={() => startCreate(targetPath, 'file')}
          />
          <MenuItem
            label="New Folder"
            onClick={() => startCreate(targetPath, 'directory')}
          />
          <div className="my-1 border-t border-[var(--theme-border)]" />
          <MenuItem
            label="Delete Folder"
            danger
            onClick={() => requestDelete(targetPath, name, true)}
          />
        </>
      ) : (
        <MenuItem
          label="Delete File"
          danger
          onClick={() => requestDelete(targetPath, name, false)}
        />
      )}
    </div>,
    document.body,
  );
}

function MenuItem({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
