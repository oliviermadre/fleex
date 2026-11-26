import { useState } from 'react';
import { cn } from '../lib/cn';

/** What a list shows: the tickets, the items, or both. */
export type Kinds = 'tickets' | 'items' | 'both';
const KINDS: readonly Kinds[] = ['tickets', 'items', 'both'];
const LABEL: Record<Kinds, string> = { tickets: 'Tickets', items: 'Items', both: 'Both' };

/** Whether a line passes: an item is a line with `item` (the floor's tickets) or a `source` (an exit's list). */
export const showsKind = (kinds: Kinds, isItem: boolean): boolean => kinds === 'both' || (kinds === 'items') === isItem;

/**
 * The choice of a list, kept for this viewer (the list it was made in, by `key`): a list of tickets opens as it was
 * left. Storage may be refused (a private window): the choice then lasts as long as the list is open.
 */
export function useKinds(key: string, initial: Kinds): [Kinds, (k: Kinds) => void] {
  const storeKey = `fleex.factory.kinds.${key}`;
  const [kinds, setKinds] = useState<Kinds>(() => {
    try { const v = localStorage.getItem(storeKey); return KINDS.includes(v as Kinds) ? (v as Kinds) : initial; } catch { return initial; }
  });
  const set = (k: Kinds) => { setKinds(k); try { localStorage.setItem(storeKey, k); } catch { /* kept while open */ } };
  return [kinds, set];
}

/** Tickets · Items · Both, each with how many there are. It narrows the list only: nothing is faded on the floor. */
export function KindChoice({ value, onChange, tickets, items }: { value: Kinds; onChange: (k: Kinds) => void; tickets: number; items: number }) {
  const n: Record<Kinds, number> = { tickets, items, both: tickets + items };
  return (
    <div className="inline-flex flex-none gap-0.5 rounded-md border border-[var(--theme-border-input)] p-0.5" role="radiogroup" aria-label="Show">
      {KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={cn('h-[22px] whitespace-nowrap rounded px-2 text-[11px]', value === k ? 'bg-[var(--theme-accent-muted)] font-medium text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]')}>
          {LABEL[k]} <span className="font-mono text-[10px] opacity-70">{n[k]}</span>
        </button>
      ))}
    </div>
  );
}
