import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BoardWithCounts } from '@fleex/shared';
import { useClickOutside } from '../../hooks/useClickOutside';

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8" />
      <polyline points="4,7 8,11 12,7" />
      <path d="M2 13h12" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

export function ImportTaskButton({
  boards,
  onImport,
  importing,
}: {
  boards: BoardWithCounts[];
  onImport: (boardId: string) => void;
  importing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([buttonRef, menuRef], () => setOpen(false), open);

  if (importing) {
    return (
      <div className="flex w-[108px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500">
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Importing...
      </div>
    );
  }

  const handleClick = () => {
    if (boards.length === 1) {
      onImport(boards[0]!.id);
    } else {
      setOpen(!open);
    }
  };

  const rect = buttonRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={buttonRef}
        className="flex w-[108px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition-all hover:border-amber-500/60 hover:bg-amber-500/20"
        onClick={handleClick}
      >
        <ImportIcon />
        Import
        {boards.length > 1 && <ChevronDownIcon />}
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          style={{ left: rect.left, top: rect.bottom + 4 }}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
            Select board
          </div>
          {boards.map((b) => (
            <button
              key={b.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => {
                setOpen(false);
                onImport(b.id);
              }}
            >
              <span>{b.emoji}</span>
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
