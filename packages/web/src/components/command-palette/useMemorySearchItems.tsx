import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { fetchMemorySearch, type MemorySnippetResult } from '../../services/api';
import { ticketLink } from '../../notifications/links';
import type { CommandItem } from './commandPaletteTypes';

/** Below this, the query is too vague to spend a search on. */
const MIN_QUERY_LENGTH = 3;

/** Long enough that typing does not fire a search per keystroke. */
const DEBOUNCE_MS = 250;

const MAX_RESULTS = 5;

/**
 * Memory results for the command palette.
 *
 * Only runs when the typed text matches nothing the palette already knows: the
 * palette's job is to get you somewhere in one keystroke, so a command must never
 * be pushed down the list by a semantic match. When there is no command to offer,
 * the same box becomes a search over everything the workspace remembers.
 */
export function useMemorySearchItems(query: string, hasLocalMatches: boolean): CommandItem[] {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.paletteSearch !== false);
  const askEnabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.ask !== false);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const openAskMemory = useUIStore((s) => s.openAskMemory);
  const [results, setResults] = useState<MemorySnippetResult[]>([]);

  const trimmed = query.trim();
  const shouldSearch = enabled && !hasLocalMatches && trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!shouldSearch) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await fetchMemorySearch(trimmed, MAX_RESULTS);
        // A slower earlier request must not overwrite a newer query's results.
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldSearch, trimmed]);

  const showAsk = askEnabled && !hasLocalMatches && trimmed.length >= MIN_QUERY_LENGTH;
  if (!shouldSearch && !showAsk) return [];

  const items: CommandItem[] = results.map((snippet, i) => ({
    id: `memory:${snippet.sourceKind}:${snippet.sourceId}:${i}`,
    label: snippet.title,
    category: 'memory' as const,
    categoryLabel: 'Memory',
    icon: memoryIcon(),
    description: excerpt(snippet.content),
    onExecute: () => {
      closeCommandPalette();
      // Everything indexed either belongs to a ticket or is one; anything without
      // that anchor has nowhere to navigate, so the entry only reads as a result.
      const ticketId = snippet.ticketId ?? (snippet.sourceKind === 'ticket' ? snippet.sourceId : null);
      if (ticketId) window.location.assign(ticketLink(ticketId));
    },
  }));

  // Last, not first: the excerpts above are free and instant, and this spends a
  // model call. It stays offered even when the search found nothing, because that
  // is exactly when a question beats a lookup.
  if (showAsk) {
    items.push({
      id: 'memory:ask',
      label: `Ask memory: ${trimmed}`,
      category: 'memory' as const,
      categoryLabel: 'Memory',
      icon: askIcon(),
      description: 'A cited answer drawn from past work — one LLM call',
      onExecute: () => openAskMemory(trimmed),
    });
  }

  return items;
}

/** One line of the matched text, so a result is recognisable without opening it. */
function excerpt(content: string, max = 90): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function askIcon(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M9.5 9.5a2.5 2.5 0 114 1.9c-.9.6-1.5 1-1.5 1.9" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

function memoryIcon(): React.ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5.5" cy="17" r="2.5" />
      <circle cx="18.5" cy="17" r="2.5" />
      <path d="M10.4 7.1 7.1 14.9M13.6 7.1l3.3 7.8M8 17h8" />
    </svg>
  );
}
