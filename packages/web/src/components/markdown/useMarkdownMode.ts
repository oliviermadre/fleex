import { useCallback, useEffect, useState } from 'react';

export type MarkdownMode = 'write' | 'preview' | 'split';

const STORAGE_PREFIX = 'md_mode_';
const MODES: MarkdownMode[] = ['write', 'preview', 'split'];

/** Next mode in the write → preview → split → write cycle. */
export function nextMarkdownMode(mode: MarkdownMode, allowSplit = true): MarkdownMode {
  const available: MarkdownMode[] = allowSplit ? MODES : ['write', 'preview'];
  const idx = available.indexOf(mode);
  return available[(idx + 1) % available.length]!;
}

/** Below this viewport width a side-by-side split is unreadable. */
const SPLIT_MIN_WIDTH = 640;

export function readMarkdownMode(surfaceKind: string): MarkdownMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + surfaceKind);
    return raw && (MODES as string[]).includes(raw) ? (raw as MarkdownMode) : null;
  } catch {
    return null;
  }
}

export function writeMarkdownMode(surfaceKind: string, mode: MarkdownMode) {
  try {
    localStorage.setItem(STORAGE_PREFIX + surfaceKind, mode);
  } catch {
    // localStorage full or unavailable — the mode simply won't persist
  }
}

const SPLIT_QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px)`;

/**
 * One-shot read of the same condition `useSplitAllowed` subscribes to, for
 * callers outside React (the scratchpad store's global hotkey).
 * `matchMedia` is guarded because jsdom (tests) doesn't always provide it.
 */
export function isSplitAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(SPLIT_QUERY).matches;
}

/**
 * True when the viewport is wide enough for a side-by-side split.
 */
export function useSplitAllowed(): boolean {
  const query = SPLIT_QUERY;
  const [allowed, setAllowed] = useState(isSplitAllowed);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setAllowed(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return allowed;
}

/**
 * Write / Preview / Split mode, persisted per *surface kind* (not per entity),
 * so opening ticket #42 then #43 keeps the same mode.
 *
 * On a narrow viewport `split` degrades to `preview` without overwriting the
 * stored preference — going back to a wide screen restores the split.
 */
export interface MarkdownModeOptions {
  /**
   * Whether `preview` is a durable preference.
   *
   * False for composers: previewing a message is a transient "check my
   * formatting" gesture, not a setting. Persisting it would reopen every
   * later thread with a rendered pane and no field to type in. `write` and
   * `split` still persist — both keep the input reachable.
   */
  persistPreview?: boolean;
}

export function useMarkdownMode(
  surfaceKind: string,
  defaultMode: MarkdownMode = 'write',
  { persistPreview = true }: MarkdownModeOptions = {},
) {
  const readInitial = () => {
    const saved = readMarkdownMode(surfaceKind);
    if (!saved) return defaultMode;
    return !persistPreview && saved === 'preview' ? defaultMode : saved;
  };
  const [stored, setStored] = useState<MarkdownMode>(readInitial);

  // A single mounted editor can host different surfaces over its lifetime.
  useEffect(() => {
    setStored(readInitial());
    // `defaultMode` is a literal at every call site; re-reading on surface change only.
  }, [surfaceKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const allowSplit = useSplitAllowed();
  const mode: MarkdownMode = !allowSplit && stored === 'split' ? 'preview' : stored;

  const setMode = useCallback(
    (next: MarkdownMode) => {
      setStored(next);
      // A non-persisted preview leaves the previous durable choice in place.
      if (persistPreview || next !== 'preview') writeMarkdownMode(surfaceKind, next);
    },
    [surfaceKind, persistPreview],
  );

  const cycleMode = useCallback(() => {
    setMode(nextMarkdownMode(mode, allowSplit));
  }, [allowSplit, mode, setMode]);

  return { mode, setMode, cycleMode, allowSplit };
}
