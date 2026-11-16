/**
 * The command card: a grid of four columns by three rows, where a command is
 * found by its place. A command either does something or opens a sub-menu, to
 * any depth; the card shows one menu at a time and its last slot leads back.
 *
 * Nothing here knows about the Factory: the menus themselves are built in
 * `factoryMenu.ts`.
 */

export const COLS = 4, ROWS = 3, SLOTS = COLS * ROWS;
/** The slot that always leads back (or out): bottom right. */
export const BACK_SLOT = SLOTS - 1;

/** The family a command belongs to, shown as its colour. */
export type Tone = 'go' | 'move' | 'station' | 'area' | 'plan' | 'ticket' | 'danger' | 'back' | 'plain';

export interface Command {
  /** Stable within its menu: the path of open sub-menus is made of these. */
  id: string;
  /** The key that runs it while its menu is shown. Empty when it only has a chord, shown through `keyText`. */
  key: string;
  /** What to print as its shortcut when it is not a single key. */
  keyText?: string;
  /** One or two short words: a label is never cut. */
  label: string;
  icon: string;
  title?: string;
  tone?: Tone;
  /** Lit: the tool in hand, the layer shown. */
  active?: boolean;
  disabled?: boolean;
  /** What it does. A command that opens a sub-menu may also do something as it opens. */
  run?: () => void;
  /** The sub-menu it opens. */
  menu?: Menu;
}

export interface Menu {
  /** Named in the card's header, after the menus that lead to it. */
  title: string;
  /** By position, row after row. Shorter than the grid is fine; longer is a mistake (`problems` says so). */
  slots: (Command | null)[];
}

/** A menu's slots, laid on the whole grid. */
export function menu(title: string, slots: Record<number, Command | null | undefined | false>): Menu {
  const out: (Command | null)[] = Array.from({ length: SLOTS }, () => null);
  for (const [i, c] of Object.entries(slots)) if (c) out[Number(i)] = c;
  return { title, slots: out };
}

/** The menu a path of sub-menu ids leads to, with the titles on the way. A path that no longer exists stops where it breaks. */
export function menuAt(root: Menu, path: readonly string[]): { menu: Menu; path: string[]; titles: string[] } {
  let cur = root;
  const taken: string[] = [], titles = [root.title];
  for (const id of path) {
    const next = cur.slots.find((c) => c?.id === id)?.menu;
    if (!next) break;
    cur = next; taken.push(id); titles.push(next.title);
  }
  return { menu: cur, path: taken, titles };
}

/** The command a key runs in a menu. Disabled commands keep their key, so it does nothing rather than something else. */
export function byKey(m: Menu, key: string): Command | null {
  return m.slots.find((c) => !!c && !!c.key && c.key === key) ?? null;
}

/** How many menus deep the deepest command is: 1 for a menu with no sub-menu. */
export function depth(m: Menu): number {
  return 1 + Math.max(0, ...m.slots.map((c) => (c?.menu ? depth(c.menu) : 0)));
}

/**
 * What is wrong with a menu and its sub-menus, in words: too many slots, a key
 * used twice, a label that would have to be cut, two commands under one id.
 * Empty when it is sound. The tests hold every menu of the Factory to this.
 */
export function problems(m: Menu, maxLabel = 10, trail: string[] = []): string[] {
  const here = [...trail, m.title].join(' › '), out: string[] = [];
  if (m.slots.length > SLOTS) out.push(`${here}: ${m.slots.length} slots for a grid of ${SLOTS}`);
  const keys = new Map<string, string>(), ids = new Set<string>();
  for (const c of m.slots) {
    if (!c) continue;
    if (ids.has(c.id)) out.push(`${here}: two commands are called ${c.id}`);
    ids.add(c.id);
    if (c.key) { const other = keys.get(c.key); if (other) out.push(`${here}: ${other} and ${c.label} share the key ${c.key}`); keys.set(c.key, c.label); }
    if (c.label.length > maxLabel) out.push(`${here}: “${c.label}” is too long to be shown whole`);
    if (/\.\.\.|…/.test(c.label)) out.push(`${here}: “${c.label}” trails off`);
    if (!c.run && !c.menu && !c.disabled) out.push(`${here}: ${c.label} does nothing`);
    if (c.menu) out.push(...problems(c.menu, maxLabel, [...trail, m.title]));
  }
  return out;
}
