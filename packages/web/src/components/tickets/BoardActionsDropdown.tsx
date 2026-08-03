import { useState, useRef, useEffect } from 'react';

import type { BoardWithCounts } from '@fleex/shared';

import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { useTicketStore } from '../../stores/ticketStore';

export function BoardActionsDropdown({ board }: { board: BoardWithCounts }) {
  const updateBoard = useTicketStore((s) => s.updateBoard);
  const deleteBoard = useTicketStore((s) => s.deleteBoard);
  const boards = useTicketStore((s) => s.boards);

  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleStartRename = () => {
    setRenameValue(board.name);
    setRenaming(true);
  };

  const handleFinishRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== board.name) {
      await updateBoard(board.id, { name: trimmed });
    }
    setRenaming(false);
    setOpen(false);
  };

  const handleDelete = () => {
    if (confirm(`Delete board "${board.name}"? All tickets will be removed.`)) {
      deleteBoard(board.id);
    }
    setOpen(false);
  };

  return (
    <>
      <button
        ref={refs.setReference}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors',
          'hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
          open && 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-secondary)]',
        )}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        title="Board actions"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
          <line x1="9" y1="4" x2="12" y2="7" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[140px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {renaming ? (
              <div className="px-2 py-1.5">
                <input
                  ref={inputRef}
                  className="w-full rounded border border-[var(--theme-border-input)] bg-transparent px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      setRenaming(false);
                      setOpen(false);
                    }
                  }}
                  onBlur={handleFinishRename}
                />
              </div>
            ) : (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                  onClick={handleStartRename}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
                  </svg>
                  Rename
                </button>
                {boards.length > 1 && (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                      tintClasses('red').text,
                      tintClasses('red').hoverBg,
                    )}
                    onClick={handleDelete}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 3 14 13 14 13 6" />
                      <line x1="1" y1="3" x2="15" y2="3" />
                      <line x1="6" y1="1" x2="10" y2="1" />
                      <line x1="6" y1="9" x2="6" y2="12" />
                      <line x1="10" y1="9" x2="10" y2="12" />
                    </svg>
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
