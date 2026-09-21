import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

/**
 * The card every new-task screen sits in. One shell — same width, padding and
 * border — so moving from the entry to a picker reads as one surface changing,
 * not as a new dialog.
 */
export function NewTaskCard({
  children,
  disabled = false,
  onKeyDown,
}: {
  children: ReactNode;
  /** Frozen backdrop while an import resolves on top of it. */
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <div className={cn('flex flex-1 items-start justify-center overflow-y-auto p-6', disabled && 'pointer-events-none')}>
      <div
        onKeyDown={onKeyDown}
        className="flex w-full max-w-2xl flex-col rounded-[14px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-6"
      >
        {children}
      </div>
    </div>
  );
}
