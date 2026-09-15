/**
 * Board picker: a trigger chip showing the current board (emoji + name) that
 * opens a popover of all boards. Value+onChange so it drives either a ticket's
 * board (Context) or the new-task draft. The app's BoardSelectorDropdown only
 * drives the global kanban filter, hence this dedicated one.
 */
import { useTicketStore } from '../../../stores/ticketStore';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';

interface Props {
  value: string | null;
  onChange: (boardId: string) => void;
}

export function WorkBoardPicker({ value, onChange }: Props) {
  const boards = useTicketStore((s) => s.boards);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();
  const current = boards.find((b) => b.id === value);

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        title="Click to change board"
        className="inline-flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-medium text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        {current ? (
          <span className="truncate">
            {current.emoji} {current.name}
          </span>
        ) : (
          <span className="text-[var(--theme-text-faint)]">No board</span>
        )}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-h-72 min-w-[180px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (b.id !== value) onChange(b.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--theme-bg-hover)]',
                  b.id === value ? 'bg-[var(--theme-bg-hover)]' : '',
                )}
              >
                <span>{b.emoji}</span>
                <span className="truncate text-[var(--theme-text-secondary)]">{b.name}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
