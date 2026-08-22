import { useEffect, useRef } from 'react';
import { MentionTypeIcon } from '../../lib/primitives';
import type { MentionTargetType } from '../ui/MentionTypeBadge';

export interface MentionOption {
  /** The text inserted into the textarea (e.g. "@agent:catalyst" or "@olivier") */
  insertText: string;
  /** Display label shown in the dropdown */
  label: string;
  /** Secondary text, and the icon shown beside the label */
  type: MentionTargetType;
  /**
   * Hidden until the user types a query, then capped.
   *
   * For kinds that can be numerous — tickets — where a bare `@` would otherwise
   * dump the whole list into the dropdown.
   */
  deferred?: boolean;
}

export function MentionMenu({
  options,
  selectedIndex,
  onSelect,
  position,
}: {
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (opt: MentionOption) => void;
  position: { bottom: number; left: number };
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (options.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-30 max-h-48 min-w-[200px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {options.map((opt, i) => (
        <button
          key={opt.insertText}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
            i === selectedIndex
              ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
          }`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(opt); }}
        >
          <MentionTypeIcon type={opt.type} />
          <span className="flex-1 truncate font-medium">{opt.label}</span>
          <span className="text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
        </button>
      ))}
    </div>
  );
}
