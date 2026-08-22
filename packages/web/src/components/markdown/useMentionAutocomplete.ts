import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import type { MentionOption } from './MentionMenu';

/**
 * `@mention` autocomplete for any Markdown textarea.
 *
 * Knows nothing about which primitives exist: the option list is a parameter,
 * so every surface passes the list it wants — today that's the same shared
 * `useAllMentionOptions()` list everywhere, offering all eight kinds. A hook
 * that enumerated primitives itself would have to be edited every time a
 * surface wanted a different subset.
 */

/** Deferred matches shown at once, so a long list stays usable. */
export const MAX_DEFERRED_SUGGESTIONS = 8;

/**
 * Rows offered per kind for a bare `@`, so a numerous kind (personas) cannot
 * crowd the sparser ones (notes, routines, panels…) out of the handful of rows
 * visible at rest — the exact complaint this mention work started from.
 */
export const MAX_EMPTY_QUERY_PER_KIND = 3;

/** Primitive prefixes stripped from the query, so "@agent:cat" matches "Catalyst". */
const PRIMITIVE_PREFIX = /^(agent|panel|skill|workflow|routine|ticket|scratchpad):/;

/**
 * Whether the caret sits inside an `@mention` being typed, and what has been
 * typed so far.
 *
 * The `@` must start the text or follow whitespace — otherwise the `@` of an
 * email address would open the menu on every address the user writes.
 */
export function detectMentionTrigger(value: string, cursor: number): { triggerPos: number; query: string } | null {
  const before = value.slice(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return null;
  if (atIdx !== 0 && !/\s/.test(before[atIdx - 1]!)) return null;

  const fragment = before.slice(atIdx + 1);
  // A space means the mention is finished and the user has moved on.
  if (/\s/.test(fragment)) return null;

  return { triggerPos: atIdx, query: fragment.replace(PRIMITIVE_PREFIX, '') };
}

/** Options matching `query`, non-deferred first, deferred capped. */
export function filterMentionOptions(options: MentionOption[], query: string): MentionOption[] {
  const q = query.toLowerCase();
  const matches = (o: MentionOption) =>
    o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);

  const immediate = options.filter((o) => !o.deferred && matches(o));
  // A bare "@" must not dump a long list into the dropdown — and must not let
  // one numerous kind (personas) fill every visible row on its own. Cap per
  // kind, preserving the existing order within and across kinds, so a bare
  // "@" samples every kind at once and typing a query still expands within it.
  if (q.length === 0) {
    const seenPerKind = new Map<string, number>();
    return immediate.filter((o) => {
      const seen = seenPerKind.get(o.type) ?? 0;
      if (seen >= MAX_EMPTY_QUERY_PER_KIND) return false;
      seenPerKind.set(o.type, seen + 1);
      return true;
    });
  }

  const deferred = options.filter((o) => o.deferred && matches(o)).slice(0, MAX_DEFERRED_SUGGESTIONS);
  return [...immediate, ...deferred];
}

export function useMentionAutocomplete({
  options,
  value,
  onChange,
  textareaRef,
}: {
  options: MentionOption[];
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState(-1);

  const filtered = useMemo(
    () => (open ? filterMentionOptions(options, query) : []),
    [open, options, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setIndex(0);
    setTriggerPos(-1);
  }, []);

  const accept = useCallback((opt: MentionOption) => {
    const ta = textareaRef.current;
    if (!ta || triggerPos < 0) return;
    // Replace from the '@' trigger to the caret with the insert text + a space.
    const next = value.slice(0, triggerPos) + opt.insertText + ' ' + value.slice(ta.selectionStart);
    onChange(next);
    close();
    // Restore the caret after React re-renders.
    const caret = triggerPos + opt.insertText.length + 1;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  }, [value, onChange, triggerPos, close, textareaRef]);

  const onScan = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const hit = detectMentionTrigger(e.target.value, e.target.selectionStart);
    if (!hit) {
      close();
      return;
    }
    setOpen(true);
    setTriggerPos(hit.triggerPos);
    setQuery(hit.query);
    setIndex(0);
  }, [close]);

  /** Returns true when the menu consumed the event, so the caller can stop. */
  const onKeyDown = useCallback((e: KeyboardEvent): boolean => {
    if (!open || filtered.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % filtered.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      accept(filtered[index]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  }, [open, filtered, index, accept, close]);

  return { open, filtered, index, onScan, onKeyDown, close, accept };
}
