/**
 * The reader of a todo chip (SPEC todo-timeline §3.5): what happened in that
 * burst — per event its kind, #ref, the item's text at the time, who, when,
 * from where, and a cancel's reason. Hover shows it, a click on the chip pins
 * it. A row opens the item in the Todo panel; the footer opens the History.
 * Rows of a deleted item are struck and not clickable: there is nothing to open.
 */
import { useEffect } from 'react';
import { cn } from '../../../lib/cn';
import { CloseIcon } from '../../ui/icons/AnnotationIcons';
import { AgentTag, longWhen } from './AnnotationPopovers';
import type { TodoChip } from './layoutTodoStrip';
import { Popover, type AnchorRect, type PopoverHover } from './TimelinePopover';
import { TODO_MARK_ICON, todoChipNodeId } from './TimelineTodoStrip';
import { TODO_MARK_HUE, TODO_MARK_KINDS, TODO_MARK_LABEL } from './todoMarks';

/** Rows shown; the rest is summed up ("+ N autres"), the History has them all. */
export const TODO_POPOVER_MAX = 12;

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function TodoMarksPopover({
  chip,
  anchor,
  pinned,
  hover,
  onClose,
  onOpenItem,
  onOpenHistory,
}: {
  chip: TodoChip;
  anchor: AnchorRect;
  pinned: boolean;
  hover?: PopoverHover;
  onClose: () => void;
  onOpenItem: (itemId: string) => void;
  /** `null`: the whole list's history. */
  onOpenHistory: (itemId: string | null) => void;
}) {
  // Échap closes it even when the focus stayed on the chip (keyboard: Entrée pinned it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const first = chip.marks[0]!;
  const last = chip.marks[chip.marks.length - 1]!;
  const head = `Todo · ${longWhen(first.at)}${hm(first.at) !== hm(last.at) ? ` – ${hm(last.at)}` : ''}`;
  const lone = chip.marks.length === 1;
  const shown = chip.marks.slice(0, TODO_POPOVER_MAX);
  const more = chip.marks.length - shown.length;

  return (
    <Popover anchor={anchor} width={400} onClose={onClose} label={head} hover={{ anchorNode: todoChipNodeId(chip), ...hover }}>
      <div className="flex items-start gap-2">
        <span className="text-[12px] font-semibold text-[var(--theme-text-primary)]">{head}</span>
        {pinned && (
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-2.5 border-b border-[var(--theme-border)] pb-2 text-[11.5px]">
        {TODO_MARK_KINDS.filter((k) => chip.counts[k]).map((k) => {
          const Glyph = TODO_MARK_ICON[k];
          return (
            <span key={k} className="flex items-center gap-1" style={{ color: `var(--tint-${TODO_MARK_HUE[k]}-text)` }}>
              <Glyph size={11} />
              {chip.counts[k]} {chip.counts[k]! > 1 ? TODO_MARK_LABEL[k].many : TODO_MARK_LABEL[k].one}
            </span>
          );
        })}
      </div>

      <ul className="-mx-3 py-1" aria-label="Événements">
        {shown.map((m) => {
          const Glyph = TODO_MARK_ICON[m.kind];
          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={m.deleted}
                onClick={() => onOpenItem(m.itemId)}
                title={m.itemText}
                data-testid="todo-mark-row"
                className={cn(
                  'grid w-full grid-cols-[14px_28px_minmax(0,1fr)_auto] items-center gap-x-1.5 px-3 py-1 text-left text-[12px]',
                  m.deleted ? 'cursor-default' : 'hover:bg-[var(--theme-bg-hover)]',
                )}
              >
                <span className="flex" style={{ color: `var(--tint-${TODO_MARK_HUE[m.kind]}-solid)` }}>
                  <Glyph size={12} />
                </span>
                <span className="font-mono text-[10.5px] text-[var(--theme-text-faint)]">#{m.ref}</span>
                <span className={cn('truncate', m.deleted ? 'text-[var(--theme-text-muted)] line-through' : 'text-[var(--theme-text-primary)]')}>
                  {m.itemText}
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px] text-[var(--theme-text-muted)]">
                  {m.deleted && (
                    <span className="rounded-sm border border-[var(--tint-red-border)] px-1 text-[9px] text-[var(--tint-red-text)]">supprimé</span>
                  )}
                  <span className="text-[var(--theme-text-secondary)]">{m.actorName}</span>
                  {m.actorType === 'agent' && <AgentTag />}
                  <span>{hm(m.at)}</span>
                  <span className="rounded-sm bg-[var(--theme-bg-base)] px-1 font-mono text-[9.5px]">{m.source}</span>
                </span>
                {m.reason && (
                  <span className="col-start-3 col-end-5 text-[11px] italic text-[var(--theme-text-muted)]">« {m.reason} »</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && <div className="pb-1 text-[11px] text-[var(--theme-text-faint)]">+ {more} autre{more > 1 ? 's' : ''}</div>}

      <div className="border-t border-[var(--theme-border)] pt-2">
        <button
          type="button"
          onClick={() => onOpenHistory(lone ? first.itemId : null)}
          className="text-[12px] text-[var(--theme-accent)] hover:underline"
        >
          {lone ? `Historique de #${first.ref}` : "Ouvrir l'historique de la todo"}
        </button>
      </div>
    </Popover>
  );
}
