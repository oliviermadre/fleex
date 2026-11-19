/**
 * The keys of the command card. The card is laid on the keyboard: its first row is the top row of letters, its
 * second the home row, its third the bottom row, five keys each from the left. A key is bound to where it is
 * (`KeyboardEvent.code`), so the command at the top left is under the same finger on any keyboard; what is printed on
 * the tile is what that key types, which depends on the layout: A Z E R T on a French keyboard, Q W E R T on an
 * English one.
 *
 * The layout is read from the browser when it says (Chromium, the Electron app). Otherwise it shows in the first
 * letter typed on a key that differs, and until then it is guessed from the language. It can be forced.
 */
import { useCallback, useEffect, useState } from 'react';

/** The fifteen keys, by position: row after row, as the card's slots. */
export const SLOT_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'] as const;
export type KeyLayout = 'azerty' | 'qwerty';
const LABELS: Record<KeyLayout, string[]> = { azerty: 'AZERTQSDFGWXCVB'.split(''), qwerty: 'QWERTASDFGZXCVB'.split('') };

/** The slot a key runs, or -1. */
export const slotOfCode = (code: string): number => (SLOT_CODES as readonly string[]).indexOf(code);
export const layoutLabels = (layout: KeyLayout): string[] => LABELS[layout];

/** What each of the fifteen keys types, from the browser's own map of the keyboard; null when it does not have them all. */
export function labelsFromMap(get: (code: string) => string | undefined): string[] | null {
  const out = SLOT_CODES.map((c) => get(c));
  return out.every((k) => typeof k === 'string' && k.length === 1) ? out.map((k) => k!.toUpperCase()) : null;
}
/** The layout a typed letter gives away, when it was typed on one of the four keys the two layouts disagree on. */
export function layoutOfKey(code: string, key: string): KeyLayout | null {
  const k = key.toLowerCase();
  const tell: Record<string, Record<string, KeyLayout>> = { KeyQ: { a: 'azerty', q: 'qwerty' }, KeyA: { q: 'azerty', a: 'qwerty' }, KeyW: { z: 'azerty', w: 'qwerty' }, KeyZ: { w: 'azerty', z: 'qwerty' } };
  return tell[code]?.[k] ?? null;
}
/** A first guess, before anything is known: French and Belgian keyboards are AZERTY, Canadian French is not. */
export const guessLayout = (language: string): KeyLayout => (/^fr(?!-CA)/i.test(language) || /-BE$/i.test(language) ? 'azerty' : 'qwerty');

const KEY = 'fleex.factory.keys';
export function loadForcedLayout(): KeyLayout | null {
  try { const v = window.localStorage.getItem(KEY); return v === 'azerty' || v === 'qwerty' ? v : null; } catch { return null; }
}
export function saveForcedLayout(layout: KeyLayout | null): void {
  try { if (layout) window.localStorage.setItem(KEY, layout); else window.localStorage.removeItem(KEY); } catch { /* nothing is kept: the choice lasts the visit */ }
}

export interface KeyLabels {
  /** What to print on each of the fifteen tiles. */
  labels: string[];
  /** How the layout is known, for the switch that forces it. */
  name: string; forced: boolean;
  /** Force the other layout; from a forced one, go back to finding out. */
  flip(): void;
}
/** The labels of the card's keys, kept up to date with what is known of the keyboard. */
export function useKeyLabels(): KeyLabels {
  const [forced, setForced] = useState<KeyLayout | null>(loadForcedLayout);
  const [seen, setSeen] = useState<KeyLayout | null>(null);
  const [mapped, setMapped] = useState<string[] | null>(null);
  useEffect(() => {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<{ get(code: string): string | undefined }> } }).keyboard;
    let live = true;
    kb?.getLayoutMap?.().then((m) => { if (live) setMapped(labelsFromMap((c) => m.get(c))); }).catch(() => { /* not allowed here: the first key typed will say */ });
    const onKey = (e: KeyboardEvent) => { if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return; const l = layoutOfKey(e.code, e.key); if (l) setSeen(l); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, []);
  const guessed = seen ?? guessLayout(typeof navigator !== 'undefined' ? navigator.language : 'en');
  const labels = forced ? LABELS[forced] : mapped ?? LABELS[guessed];
  const now: KeyLayout = labels[0] === 'A' ? 'azerty' : 'qwerty';
  const flip = useCallback(() => setForced((f) => { const next = f ? null : now === 'azerty' ? 'qwerty' : 'azerty'; saveForcedLayout(next); return next; }), [now]);
  return { labels, name: labels[0] === 'A' ? 'AZERTY' : labels[0] === 'Q' && labels[1] === 'W' ? 'QWERTY' : 'Keyboard', forced: !!forced, flip };
}
