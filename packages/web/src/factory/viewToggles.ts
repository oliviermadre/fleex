/**
 * What the floor shows on top of the machines and the tickets, switched on and
 * off from the row of toggles above the minimap. Kept from one visit to the
 * next in the browser: a matter of taste, not of the floor.
 */

export interface Show {
  /** Every ticket carries its name. Off, only the favourites, the selected one and what a search found do. */
  names: boolean;
  /** What each arm takes is written next to it. Off, only the arm selected or pointed at says it. */
  arms: boolean;
  /** Every ticket carries its number. Off, only when the view is close. */
  numbers: boolean;
  /** The lines of the grid. */
  grid: boolean;
}
export const DEFAULT_SHOW: Show = { names: false, arms: true, numbers: false, grid: true };

/** The toggles, in the order of the row: what each one switches, its icon and what to say of it. */
export const TOGGLES: { key: keyof Show; icon: string; label: string; title: string }[] = [
  { key: 'names', icon: 'names', label: 'Ticket names', title: 'The name of every ticket, on the floor' },
  { key: 'arms', icon: 'rules', label: 'Arm rules', title: 'What each arm takes, written next to it' },
  { key: 'numbers', icon: 'numbers', label: 'Ticket numbers', title: 'The number of every ticket, under it' },
  { key: 'grid', icon: 'grid', label: 'Grid', title: 'The lines of the floor' },
];

const KEY = 'fleex.factory.show';

/** What was chosen last time, or the defaults. A browser that keeps nothing (private window, storage blocked) gets the defaults every time. */
export function loadShow(): Show {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<Show> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SHOW };
    const out = { ...DEFAULT_SHOW };
    for (const k of Object.keys(DEFAULT_SHOW) as (keyof Show)[]) if (typeof raw[k] === 'boolean') out[k] = raw[k];
    return out;
  } catch { return { ...DEFAULT_SHOW }; }
}
/** Whether the console along the bottom is hidden, to give the floor the whole page: kept like the rest. */
const HUD_KEY = 'fleex.factory.console-hidden';
export function loadConsoleHidden(): boolean {
  try { return window.localStorage.getItem(HUD_KEY) === '1'; } catch { return false; }
}
export function saveConsoleHidden(hidden: boolean): void {
  try { window.localStorage.setItem(HUD_KEY, hidden ? '1' : '0'); } catch { /* nothing is kept: the choice lasts the visit */ }
}

export function saveShow(show: Show): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(show)); } catch { /* nothing is kept: the choice lasts the visit */ }
}
