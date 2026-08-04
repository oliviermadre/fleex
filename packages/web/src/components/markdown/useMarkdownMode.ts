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

/**
 * True when the viewport is wide enough for a side-by-side split.
 * `matchMedia` is guarded because jsdom (tests) doesn't always provide it.
 */
export function useSplitAllowed(): boolean {
  const query = `(min-width: ${SPLIT_MIN_WIDTH}px)`;
  const [allowed, setAllowed] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(query).matches;
  });

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
export function useMarkdownMode(surfaceKind: string, defaultMode: MarkdownMode = 'write') {
  const [stored, setStored] = useState<MarkdownMode>(() => readMarkdownMode(surfaceKind) ?? defaultMode);

  // A single mounted editor can host different surfaces over its lifetime.
  useEffect(() => {
    setStored(readMarkdownMode(surfaceKind) ?? defaultMode);
    // `defaultMode` is a literal at every call site; re-reading on surface change only.
  }, [surfaceKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const allowSplit = useSplitAllowed();
  const mode: MarkdownMode = !allowSplit && stored === 'split' ? 'preview' : stored;

  const setMode = useCallback(
    (next: MarkdownMode) => {
      setStored(next);
      writeMarkdownMode(surfaceKind, next);
    },
    [surfaceKind],
  );

  const cycleMode = useCallback(() => {
    setMode(nextMarkdownMode(mode, allowSplit));
  }, [allowSplit, mode, setMode]);

  return { mode, setMode, cycleMode, allowSplit };
}
