import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from '../lib/constants';

import type { Theme } from '../lib/themes';

/**
 * Terminal appearance intent, decoupled from xterm.js.
 *
 * `useTheme()` and `useTerminalFont()` run at the very top of <App>, so importing
 * terminalManager from them dragged @xterm/xterm (108 kB gzip) into the entry
 * chunk on every page load — including mobile, which has no terminal at all.
 *
 * These hooks now write here instead. terminalManager subscribes when it is
 * actually loaded and replays the current state, so the applied appearance is
 * identical — it lands when the manager arrives rather than when the hook runs.
 *
 * This module must stay dependency-free. Importing anything that reaches xterm
 * would restore the edge it exists to cut.
 */
export interface TerminalAppearance {
  theme: Theme | null;
  fontFamily: string;
  fontSize: number;
  fontThicken: boolean;
}

let appearance: TerminalAppearance = {
  theme: null,
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: TERMINAL_FONT_SIZE,
  fontThicken: false,
};

const listeners = new Set<(a: TerminalAppearance) => void>();

function emit(): void {
  for (const listener of listeners) listener(appearance);
}

export function setTerminalTheme(theme: Theme): void {
  appearance = { ...appearance, theme };
  emit();
}

export function setTerminalFont(fontFamily: string, fontSize: number, fontThicken: boolean): void {
  appearance = { ...appearance, fontFamily, fontSize, fontThicken };
  emit();
}

export function getTerminalAppearance(): TerminalAppearance {
  return appearance;
}

export function subscribeTerminalAppearance(fn: (a: TerminalAppearance) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
