import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useCommandItems } from './useCommandItems';
import { useMemorySearchItems } from './useMemorySearchItems';
import type { CommandItem } from './commandPaletteTypes';

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);

  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const commandItems = useCommandItems(query);
  // Appended, never interleaved: a command must keep its place at the top of the
  // list, and memory only fills the gap when nothing local matched.
  const memoryItems = useMemorySearchItems(query, commandItems.length > 0);
  const items = memoryItems.length > 0 ? [...commandItems, ...memoryItems] : commandItems;

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightedIndex(0);
      // Focus input on next tick after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset highlight when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // Keyboard handling (capture phase, like scratchpad)
  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCommandPalette();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (items[highlightedIndex]) {
          items[highlightedIndex].onExecute();
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, items, highlightedIndex, closeCommandPalette]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      closeCommandPalette();
    }
  }, [closeCommandPalette]);

  if (!open) return null;

  // Group items by category, preserving order
  const grouped: { category: string; categoryLabel: string; items: { item: CommandItem; flatIndex: number }[] }[] = [];
  let flatIndex = 0;
  for (const item of items) {
    let group = grouped.find((g) => g.category === item.category);
    if (!group) {
      group = { category: item.category, categoryLabel: item.categoryLabel, items: [] };
      grouped.push(group);
    }
    group.items.push({ item, flatIndex });
    flatIndex++;
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="command-palette-backdrop"
      onClick={handleBackdropClick}
    >
      <div className="command-palette-container" style={{ alignSelf: 'flex-start' }}>
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--theme-border-subtle)] px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-muted)]">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.2" y1="10.2" x2="14" y2="14" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none"
          />
          <kbd className="shrink-0 rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-faint)]">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="command-palette-results max-h-80 overflow-y-auto py-1">
          {grouped.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--theme-text-faint)]">
              No results found
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-4 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--theme-text-faint)]">
                {group.categoryLabel}
              </div>
              {group.items.map(({ item, flatIndex: idx }) => (
                <div
                  key={item.id}
                  data-index={idx}
                  className={
                    'mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ' +
                    (idx === highlightedIndex
                      ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
                      : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]')
                  }
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    item.onExecute();
                  }}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--theme-text-muted)]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.description && (
                    <span className="shrink-0 max-w-[45%] truncate text-[11px] text-[var(--theme-text-faint)]">
                      {item.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center gap-4 border-t border-[var(--theme-border-subtle)] px-4 py-2 text-[11px] text-[var(--theme-text-faint)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-1 py-0.5 text-[10px]">&uarr;&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-1 py-0.5 text-[10px]">&crarr;</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-1 py-0.5 text-[10px]">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
