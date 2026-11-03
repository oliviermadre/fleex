import { useState, useRef, useEffect } from 'react';
import type { BoardWithCounts } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { boardChanges } from '../../lib/boardEmoji';
import { EmojiInput } from '../ui/EmojiInput';

export function BoardActionsDropdown({ board }: { board: BoardWithCounts }) {
  const updateBoard = useTicketStore((s) => s.updateBoard);
  const deleteBoard = useTicketStore((s) => s.deleteBoard);
  const boards = useTicketStore((s) => s.boards);

  // The edit in progress, or null when not editing. Mirrored in a ref because
  // the popover can close from outside (click away, trigger) and that path
  // must read the latest draft to save it.
  const [draft, setDraft] = useState<{ name: string; emoji: string } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** Save the draft (only what changed, one PATCH at most) and leave edit mode. */
  const finishEdit = (save: boolean) => {
    const current = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!save || !current) return;
    const changes = boardChanges(board, current);
    if (changes) void updateBoard(board.id, changes);
  };

  // Closing the popover while editing (outside click) saves, like the old
  // rename-on-blur. Escape and Enter clear the draft first, so they don't.
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    onOpenChange: (next) => { if (!next) finishEdit(true); },
  });
  const nameInputRef = useRef<HTMLInputElement>(null);

  const editing = draft !== null;
  useEffect(() => {
    if (editing && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editing]);

  const handleStartEdit = () => {
    setDraft({ name: board.name, emoji: board.emoji });
  };

  // Enter saves, Escape cancels. No blur handler: moving between the two
  // fields must keep the popover open.
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
      setOpen(false);
    }
    if (e.key === 'Escape') {
      finishEdit(false);
      setOpen(false);
    }
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
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            {draft ? (
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <EmojiInput
                  className="h-7 w-9 rounded text-base"
                  value={draft.emoji}
                  onChange={(emoji) => setDraft({ ...draft, emoji })}
                  onKeyDown={handleEditKeyDown}
                />
                <input
                  ref={nameInputRef}
                  aria-label="Board name"
                  className="w-44 rounded border border-[var(--theme-border-input)] bg-transparent px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={handleEditKeyDown}
                />
              </div>
            ) : (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                  onClick={handleStartEdit}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
                  </svg>
                  Edit
                </button>
                {boards.length > 1 && (
                  <button
                    className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors', tintClasses('red').text, tintClasses('red').hoverBg)}
                    onClick={handleDelete}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
