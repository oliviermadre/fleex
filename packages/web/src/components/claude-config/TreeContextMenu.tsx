import { useEffect } from 'react';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { useContextMenuPopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { tintText, tintClasses } from '../../lib/tints';

export function TreeContextMenu() {
  const contextMenu = useClaudeConfigStore((s) => s.contextMenu);
  const closeContextMenu = useClaudeConfigStore((s) => s.closeContextMenu);
  const startCreate = useClaudeConfigStore((s) => s.startCreate);
  const requestDelete = useClaudeConfigStore((s) => s.requestDelete);

  const { open, openAt, close, refs, floatingStyles, getFloatingProps } = useContextMenuPopover();

  // The store owns when the menu should show + at which coordinates; feed those
  // coords into the virtual reference whenever the store opens the menu.
  useEffect(() => {
    if (contextMenu) {
      openAt(contextMenu.x, contextMenu.y);
    } else {
      close();
    }
  }, [contextMenu, openAt, close]);

  // When the popover dismisses itself (outside-click / Escape), clear the store.
  useEffect(() => {
    if (!open && contextMenu) {
      closeContextMenu();
    }
  }, [open, contextMenu, closeContextMenu]);

  if (!contextMenu || !open) return null;

  const { targetPath, targetIsDir } = contextMenu;
  const name = targetPath.split('/').pop() ?? targetPath;

  const handleAction = (action: () => void) => {
    action();
    close();
    closeContextMenu();
  };

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
      >
        {targetIsDir ? (
          <>
            <MenuItem
              label="New File"
              onClick={() => handleAction(() => startCreate(targetPath, 'file'))}
            />
            <MenuItem
              label="New Folder"
              onClick={() => handleAction(() => startCreate(targetPath, 'directory'))}
            />
            <div className="my-1 border-t border-[var(--theme-border)]" />
            <MenuItem
              label="Delete Folder"
              danger
              onClick={() => handleAction(() => requestDelete(targetPath, name, true))}
            />
          </>
        ) : (
          <MenuItem
            label="Delete File"
            danger
            onClick={() => handleAction(() => requestDelete(targetPath, name, false))}
          />
        )}
      </div>
    </FloatingPortal>
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
      className={cn(
        'flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors',
        danger
          ? cn(tintText('red'), tintClasses('red').hoverBg)
          : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
