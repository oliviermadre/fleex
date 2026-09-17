/**
 * Picker options for the New task card, kept pure so the ordering rules are
 * testable without rendering the card.
 */
import type { TicketGroup } from '@fleex/shared';
import type { MultiSelectOption } from '../../ui/MultiSelect';

const SUGGESTED_LIMIT = 3;

/**
 * Configured repos, with the board's most relevant ones (`rankedRefs`, best
 * first — see topReposForBoard) pulled to the top under "Suggested". A ranked
 * repo that is no longer configured is skipped. No history → a flat list.
 */
export function repoOptions(repoKeys: string[], rankedRefs: string[]): MultiSelectOption<string>[] {
  const configured = new Set(repoKeys);
  const suggested = rankedRefs.filter((ref) => configured.has(ref)).slice(0, SUGGESTED_LIMIT);
  if (suggested.length === 0) return repoKeys.map((key) => ({ value: key, label: key }));

  const isSuggested = new Set(suggested);
  return [
    ...suggested.map((key) => ({ value: key, label: key, group: 'Suggested' })),
    ...repoKeys.filter((key) => !isSuggested.has(key)).map((key) => ({ value: key, label: key, group: 'All repos' })),
  ];
}

/** The epics a new ticket can join: only the active ones. */
export function epicOptions(epics: TicketGroup[]): MultiSelectOption<string>[] {
  return epics
    .filter((g) => g.groupStatus === 'active')
    .map((g) => ({ value: g.id, label: g.name, icon: <span className="shrink-0 text-[11px]">{g.emoji}</span> }));
}
