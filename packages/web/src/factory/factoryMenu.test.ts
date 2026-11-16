import { describe, it, expect, vi } from 'vitest';
import { factoryMenu, type MenuContext } from './factoryMenu';
import { BACK_SLOT, byKey, COLS, depth, menu, menuAt, problems, ROWS, SLOTS, type Menu } from './menu';
import type { Tool } from './layoutOps';

/** Every action as a spy, made the first time it is asked for. */
const act = (): MenuContext['act'] => { const seen: Record<string, ReturnType<typeof vi.fn>> = {}; return new Proxy({}, { get: (_, name: string) => (seen[name] ??= vi.fn()) }) as MenuContext['act']; };
const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({ building: false, tool: 'select', dir: 0, ticket: null, machine: null, many: 0, undoable: true, redoable: false, hasClip: true, mod: 'Ctrl+', act: act(), ...over });
const labels = (m: Menu) => m.slots.map((c) => c?.label ?? null);
const at = (m: Menu, i: number) => m.slots[i]?.label ?? null;

/** Every menu a person can reach: out of build mode, in it, and with each kind of thing selected. */
const everyMenu = (): [string, Menu][] => {
  const tools: Tool[] = ['select', 'belt', 'agent', 'zone', 'erase', 'paste'];
  const out: [string, Menu][] = [
    ['floor', factoryMenu(ctx())],
    ['gate ticket', factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: false, outcomes: ['approve', 'rework', 'reject', 'park'] } }))],
    ['zone ticket', factoryMenu(ctx({ ticket: { phase: 'zone', released: false, favorite: true, outcomes: [] } }))],
    ['failed ticket', factoryMenu(ctx({ ticket: { phase: 'failed', released: false, favorite: null, outcomes: [] } }))],
    ['zone', factoryMenu(ctx({ machine: { kind: 'zone', waiting: true } }))],
    ['belt, not building', factoryMenu(ctx({ machine: { kind: 'belt', waiting: false } }))],
    ['arm, building', factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false } }))],
    ['group, building', factoryMenu(ctx({ building: true, many: 7 }))],
  ];
  for (const tool of tools) out.push([`build with ${tool}`, factoryMenu(ctx({ building: true, tool }))]);
  return out;
};

describe('the command card', () => {
  it('is four columns by three rows, and its last slot leads back', () => {
    expect([COLS, ROWS, SLOTS, BACK_SLOT]).toEqual([4, 3, 12, 11]);
    expect(menu('x', { 0: null, 3: undefined, 5: false }).slots).toHaveLength(12);
  });

  it('no menu of the Factory has too many commands, a key used twice, or a label that would be cut', () => {
    for (const [name, m] of everyMenu()) expect([name, problems(m)]).toEqual([name, []]);
  });

  it('is three levels deep at most: the floor, build, and what build opens', () => {
    for (const [name, m] of everyMenu()) expect([name, depth(m) + (name.startsWith('build') || name.includes('building') ? 1 : 0) <= 3]).toEqual([name, true]);
    expect(depth(factoryMenu(ctx({ building: true })))).toBe(2);
    expect(depth(factoryMenu(ctx()))).toBe(1);
  });

  it('starts with Build, Intake, Fit and the list of tickets, which Tab opens', () => {
    const root = factoryMenu(ctx());
    expect(labels(root).filter(Boolean)).toEqual(['Build', 'Intake', 'Fit', 'Tickets']);
    expect(byKey(root, 'Tab')).toMatchObject({ id: 'tickets', label: 'Tickets' });
  });

  it('build sorts what can be placed into Move, Station and Area', () => {
    const build = factoryMenu(ctx({ building: true }));
    expect(labels(build)).toEqual(['Move', 'Station', 'Area', 'Plan', 'Select', 'Erase', 'Undo', 'Redo', 'Copy', 'Cut', 'Paste', 'Done']);
    expect(labels(menuAt(build, ['move']).menu).slice(0, 6)).toEqual(['Belt', 'Bridge', 'Arm', 'Face →', null, null]);
    expect(labels(menuAt(build, ['station']).menu).slice(0, 6)).toEqual(['Agent', 'Skill', 'Panel', 'Gate', 'Status', null]);
    expect(labels(menuAt(build, ['area']).menu).slice(0, 6)).toEqual(['Zone', 'Exit', 'Label', null, null, null]);
    expect(menuAt(build, ['move']).titles).toEqual(['Build', 'Move']);
  });

  it('keeps Undo, Redo, Copy, Cut, Paste and the way back at the same place in every build menu', () => {
    const build = factoryMenu(ctx({ building: true }));
    const menus = [build, menuAt(build, ['move']).menu, menuAt(build, ['station']).menu, menuAt(build, ['area']).menu,
      factoryMenu(ctx({ building: true, machine: { kind: 'belt', waiting: false } })), factoryMenu(ctx({ building: true, many: 4 }))];
    for (const m of menus) {
      expect([6, 7, 8, 9, 10].map((i) => at(m, i))).toEqual(['Undo', 'Redo', 'Copy', 'Cut', 'Paste']);
      expect(m.slots[BACK_SLOT]).toMatchObject({ id: 'back', key: 'Escape' });
    }
    expect(menus.map((m) => at(m, BACK_SLOT))).toEqual(['Done', 'Previous', 'Previous', 'Previous', 'Previous', 'Previous']);
  });

  it('copy and cut wait for a selection, paste for something copied, undo and redo for something to take back', () => {
    const idle = factoryMenu(ctx({ building: true, undoable: false, hasClip: false }));
    expect([6, 7, 8, 9, 10].map((i) => idle.slots[i]!.disabled)).toEqual([true, true, true, true, true]);
    const sel = factoryMenu(ctx({ building: true, many: 3, redoable: true }));
    expect([6, 7, 8, 9, 10].map((i) => !!sel.slots[i]!.disabled)).toEqual([false, false, false, false, false]);
    expect([at(sel, 0), at(sel, 3)]).toEqual([null, 'Remove']);
    const arm = factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false } }));
    expect([at(arm, 0), at(arm, 3)]).toEqual(['Turn', 'Remove']);
  });

  it('shows the tool in hand, and offers to put it down instead of leaving', () => {
    const erasing = factoryMenu(ctx({ building: true, tool: 'erase' }));
    expect(erasing.slots[5]).toMatchObject({ label: 'Erase', active: true });
    expect(erasing.slots[4]).toMatchObject({ label: 'Select', active: false });
    expect(at(erasing, BACK_SLOT)).toBe('Cancel');
    const belts = menuAt(factoryMenu(ctx({ building: true, tool: 'belt', dir: 1 })), ['move']).menu;
    expect(belts.slots[0]).toMatchObject({ label: 'Belt', active: true });
    expect(at(belts, 3)).toBe('Face ↓');
    expect(factoryMenu(ctx({ building: true, tool: 'paste' })).slots[10]).toMatchObject({ active: true });
  });

  it('runs what a key is for in the menu shown, and nothing for a key of another menu', () => {
    const c = ctx({ building: true }), build = factoryMenu(c), move = menuAt(build, ['move']).menu;
    expect(byKey(build, 'C')).toBeNull();          // Belt is not in this menu
    byKey(move, 'C')!.run!();
    expect(c.act.tool).toHaveBeenCalledWith('belt');
    expect(byKey(build, 'M')!.menu).toBe(move);
    byKey(move, 'Escape')!.run!();
    expect(c.act.back).toHaveBeenCalled();
    byKey(build, 'Escape')!.run!();
    expect(c.act.done).toHaveBeenCalled();
    expect(byKey(build, '')).toBeNull();           // a chord-only command has no key of its own
  });

  it('a ticket shows what it waits for first, then the same three commands', () => {
    const gate = factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: false, outcomes: ['approve', 'rework'] } }));
    expect(labels(gate)).toEqual(['approve', 'rework', null, null, 'Open', 'Star', 'Give back', null, null, null, null, 'Previous']);
    expect(gate.slots.slice(0, 2).map((c) => c!.key)).toEqual(['Q', 'W']);
    const zone = factoryMenu(ctx({ ticket: { phase: 'zone', released: false, favorite: true, outcomes: [] } }));
    expect([at(zone, 0), at(zone, 4), at(zone, 5), at(zone, 6)]).toEqual(['Release', 'Open', 'Unstar', 'Give back']);
    expect(at(factoryMenu(ctx({ ticket: { phase: 'question', released: false, favorite: false, outcomes: [] } })), 0)).toBe('Run again');
    expect(at(factoryMenu(ctx({ ticket: { phase: 'belt', released: false, favorite: false, outcomes: [] } })), 0)).toBeNull();
  });

  it('a path that no longer exists stops where it breaks', () => {
    const build = factoryMenu(ctx({ building: true }));
    expect(menuAt(build, ['move', 'nope']).path).toEqual(['move']);
    expect(menuAt(build, ['gone']).menu).toBe(build);
  });

  it('says what is wrong with a menu', () => {
    const bad: Menu = { title: 'Bad', slots: [
      { id: 'a', key: 'Q', label: 'One', icon: 'x', run: () => {} }, { id: 'a', key: 'Q', label: 'A label far too long', icon: 'x', run: () => {} },
      { id: 'c', key: 'W', label: 'More...', icon: 'x' }, ...Array.from({ length: 11 }, () => null),
    ] };
    const said = problems(bad).join('\n');
    expect(said).toMatch(/14 slots for a grid of 12/);
    expect(said).toMatch(/two commands are called a/);
    expect(said).toMatch(/share the key Q/);
    expect(said).toMatch(/too long to be shown whole/);
    expect(said).toMatch(/trails off/);
    expect(said).toMatch(/More\.\.\. does nothing/);
  });
});
