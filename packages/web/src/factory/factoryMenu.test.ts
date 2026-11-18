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
  const tools: Tool[] = ['select', 'belt', 'fastbelt', 'agent', 'zone', 'erase', 'paste'];
  const out: [string, Menu][] = [
    ['floor', factoryMenu(ctx())],
    ['gate ticket', factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: false, outcomes: ['approve', 'rework', 'reject', 'park'] } }))],
    ['zone ticket', factoryMenu(ctx({ ticket: { phase: 'zone', released: false, favorite: true, outcomes: [] } }))],
    ['failed ticket', factoryMenu(ctx({ ticket: { phase: 'failed', released: false, favorite: null, outcomes: [] } }))],
    ['ticket set aside', factoryMenu(ctx({ ticket: { phase: 'aside', released: false, favorite: false, outcomes: ['ok', 'redo', 'drop', 'later'] } }))],
    ['running ticket', factoryMenu(ctx({ ticket: { phase: 'running', released: false, favorite: false, outcomes: ['ok'], canAside: true } }))],
    ['zone', factoryMenu(ctx({ machine: { kind: 'zone', waiting: true, popup: true } }))],
    ['station running', factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'on' } }))],
    ['station stopped', factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'off' } }))],
    ['station, building', factoryMenu(ctx({ building: true, machine: { kind: 'station', waiting: false, popup: true, power: 'on' } }))],
    ['belt, not building', factoryMenu(ctx({ machine: { kind: 'belt', waiting: false } }))],
    ['arm, building', factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false } }))],
    ['group, building', factoryMenu(ctx({ building: true, many: 7 }))],
    ['belts, building', factoryMenu(ctx({ building: true, many: 7, speed: 'up' }))],
    ['fast belt, building', factoryMenu(ctx({ building: true, machine: { kind: 'belt', waiting: false, popup: false }, speed: 'down' }))],
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

  it('starts with Build, Intake, Fit, the list of tickets, which Tab opens, and the floor\'s figures', () => {
    const root = factoryMenu(ctx());
    expect(labels(root).filter(Boolean)).toEqual(['Build', 'Intake', 'Fit', 'Tickets', 'Stats', 'Next']);
    expect(byKey(root, 'Tab')).toMatchObject({ id: 'tickets', label: 'Tickets' });
  });

  it('build sorts what can be placed into Move, Station and Area', () => {
    const build = factoryMenu(ctx({ building: true }));
    expect(labels(build)).toEqual(['Move', 'Station', 'Area', 'Plan', 'Erase', null, 'Undo', 'Redo', null, null, null, 'Done']);
    expect(labels(menuAt(build, ['move']).menu).slice(0, 6)).toEqual(['Belt', 'Bridge', 'Arm', 'Face →', 'Fast belt', 'Teleporter']);
    expect(labels(menuAt(build, ['station']).menu).slice(0, 6)).toEqual(['Agent', 'Skill', 'Panel', 'Gate', 'Status', 'Set']);
    expect(labels(menuAt(build, ['area']).menu).slice(0, 6)).toEqual(['Zone', 'Exit', 'Label', null, null, null]);
    expect(menuAt(build, ['move']).titles).toEqual(['Build', 'Move']);
  });

  it('keeps Undo, Redo and the way back at the same place in every build menu, and leaves copy, cut and paste to the keyboard', () => {
    const build = factoryMenu(ctx({ building: true }));
    const menus = [build, menuAt(build, ['move']).menu, menuAt(build, ['station']).menu, menuAt(build, ['area']).menu,
      factoryMenu(ctx({ building: true, machine: { kind: 'belt', waiting: false } })), factoryMenu(ctx({ building: true, many: 4 }))];
    for (const m of menus) {
      expect([6, 7, 8, 9, 10].map((i) => at(m, i))).toEqual(['Undo', 'Redo', null, null, null]);
      expect(m.slots[BACK_SLOT]).toMatchObject({ id: 'back', key: 'Escape' });
    }
    expect(menus.map((m) => at(m, BACK_SLOT))).toEqual(['Done', 'Previous', 'Previous', 'Previous', 'Previous', 'Previous']);
  });

  it('undo and redo wait for something to take back; a selection has its own commands', () => {
    const idle = factoryMenu(ctx({ building: true, undoable: false, hasClip: false }));
    expect([6, 7].map((i) => idle.slots[i]!.disabled)).toEqual([true, true]);
    const sel = factoryMenu(ctx({ building: true, many: 3, redoable: true }));
    expect([6, 7].map((i) => !!sel.slots[i]!.disabled)).toEqual([false, false]);
    expect([at(sel, 0), at(sel, 3)]).toEqual([null, 'Remove']);
    const arm = factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false } }));
    expect([at(arm, 0), at(arm, 3)]).toEqual(['Turn', 'Remove']);
  });

  it('shows the tool in hand, and offers to put it down instead of leaving', () => {
    const erasing = factoryMenu(ctx({ building: true, tool: 'erase' }));
    expect(erasing.slots[4]).toMatchObject({ label: 'Erase', active: true });
    expect(erasing.slots.some((c) => c?.label === 'Select')).toBe(false);          // a click or a drag selects: no command for it
    expect(at(erasing, BACK_SLOT)).toBe('Cancel');
    const belts = menuAt(factoryMenu(ctx({ building: true, tool: 'belt', dir: 1 })), ['move']).menu;
    expect(belts.slots[0]).toMatchObject({ label: 'Belt', active: true });
    expect(at(belts, 3)).toBe('Face ↓');
    expect(at(factoryMenu(ctx({ building: true, tool: 'paste' })), BACK_SLOT)).toBe('Cancel');   // what was pasted from the keyboard is put down the same way
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
    expect(labels(gate)).toEqual(['approve', 'rework', null, null, 'Open', 'Star', 'Give back', null, 'Next', null, null, 'Previous']);
    expect(gate.slots.slice(0, 2).map((c) => c!.key)).toEqual(['Q', 'W']);
    const zone = factoryMenu(ctx({ ticket: { phase: 'zone', released: false, favorite: true, outcomes: [] } }));
    expect([at(zone, 0), at(zone, 4), at(zone, 5), at(zone, 6)]).toEqual(['Release', 'Open', 'Unstar', 'Give back']);
    expect(at(factoryMenu(ctx({ ticket: { phase: 'question', released: false, favorite: false, outcomes: [] } })), 0)).toBe('Run again');
    expect(at(factoryMenu(ctx({ ticket: { phase: 'belt', released: false, favorite: false, outcomes: [] } })), 0)).toBeNull();
    /* set aside in its station: back for another run at the same place as after a failure, then one tile per outcome to leave by */
    const aside = factoryMenu(ctx({ ticket: { phase: 'aside', released: false, favorite: false, outcomes: ['ok', 'drop'] } }));
    expect([0, 1, 2, 3].map((i) => at(aside, i))).toEqual(['Run again', 'ok', 'drop', null]);
    expect(at(aside, 7)).toBeNull();
    expect(at(factoryMenu(ctx({ ticket: { phase: 'running', released: false, favorite: false, outcomes: ['ok'], canAside: true } })), 7)).toBe('Set aside');
  });

  it('a machine is stopped or started from the card, and Edit opens its popup where a ticket has Open', () => {
    const c = ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'on' } }), on = factoryMenu(c);
    expect(labels(on)).toEqual(['Stop', null, null, null, 'Edit', null, null, null, 'Next', null, null, 'Previous']);
    byKey(on, 'Q')!.run!(); expect(c.act.power).toHaveBeenCalled();
    byKey(on, 'V')!.run!(); expect(c.act.openMachine).toHaveBeenCalled();
    expect(at(factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'off' } })), 0)).toBe('Start');
    /* a gate or a status station has no switch; a zone keeps Release at that place; a belt has nothing to edit */
    expect(labels(factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: null } }))).slice(0, 5)).toEqual([null, null, null, null, 'Edit']);
    expect(labels(factoryMenu(ctx({ machine: { kind: 'zone', waiting: true, popup: true } }))).slice(0, 5)).toEqual(['Release 1', null, null, null, 'Edit']);
    expect(labels(factoryMenu(ctx({ machine: { kind: 'belt', waiting: false, popup: false } }))).slice(0, 5)).toEqual([null, null, null, null, null]);
    /* in build mode the machine selected keeps Edit at the same place, a group has none */
    expect(at(factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false, popup: true } })), 4)).toBe('Edit');
    expect(at(factoryMenu(ctx({ building: true, many: 3, machine: null })), 4)).toBeNull();
  });

  it('with nothing selected, the floor itself opens from the same place', () => {
    const c = ctx(), floor = factoryMenu(c);
    expect(at(floor, 4)).toBe('Stats');
    byKey(floor, 'V')!.run!(); expect(c.act.floor).toHaveBeenCalled();
  });

  it('out of build mode, Next is always at the same place: the next ticket that waits, when one does', () => {
    const c = ctx({ waiting: 2 });
    for (const m of [factoryMenu(c), factoryMenu({ ...c, machine: { kind: 'zone', waiting: false, popup: true } }), factoryMenu({ ...c, ticket: { phase: 'belt', released: false, favorite: false, outcomes: [] } })]) {
      expect(m.slots[8]).toMatchObject({ label: 'Next', key: 'N', disabled: false });
    }
    byKey(factoryMenu(c), 'N')!.run!(); expect(c.act.next).toHaveBeenCalled();
    expect(factoryMenu(ctx()).slots[8]).toMatchObject({ label: 'Next', disabled: true });
    expect(labels(factoryMenu(ctx({ building: true, waiting: 2 })))).not.toContain('Next');
  });

  it('in build mode, the belts selected are sped up or slowed down from the card', () => {
    const c = ctx({ building: true, machine: { kind: 'belt', waiting: false, popup: false }, speed: 'up' }), up = factoryMenu(c);
    expect(labels(up).slice(0, 5)).toEqual(['Turn', 'Speed up', null, 'Remove', null]);
    byKey(up, 'S')!.run!(); expect(c.act.speed).toHaveBeenCalled();
    expect(at(factoryMenu(ctx({ building: true, machine: { kind: 'belt', waiting: false, popup: false }, speed: 'down' })), 1)).toBe('Slow down');
    expect(at(factoryMenu(ctx({ building: true, many: 6, speed: 'up' })), 1)).toBe('Speed up');
    /* nothing to speed up without a belt in the selection, nor out of build mode */
    expect(at(factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false, popup: true }, speed: null })), 1)).toBeNull();
    expect(labels(factoryMenu(ctx({ machine: { kind: 'belt', waiting: false, popup: false }, speed: 'up' })))).not.toContain('Speed up');
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

describe('several tickets selected together', () => {
  const group = { count: 5, release: 2, retry: 1, aside: 3, starred: false };

  it('have each command where a single ticket has it, and only those that apply to some of them', () => {
    const c = ctx({ group }), m = factoryMenu(c);
    expect(labels(m)).toEqual(['Release', 'Run again', null, null, null, 'Star', 'Give back', 'Set aside', 'Next', null, null, 'Previous']);
    expect(m.title).toBe('Tickets');
    byKey(m, 'Q')!.run!(); expect(c.act.release).toHaveBeenCalled();
    byKey(m, 'H')!.run!(); expect(c.act.setAside).toHaveBeenCalled();
    byKey(m, 'X')!.run!(); expect(c.act.giveBack).toHaveBeenCalled();
    byKey(m, 'Escape')!.run!(); expect(c.act.deselect).toHaveBeenCalled();
    expect(m.slots[0]!.title).toContain('2 of the 5 tickets');
    const quiet = factoryMenu(ctx({ group: { count: 3, release: 0, retry: 0, aside: 0, starred: true } }));
    expect(labels(quiet)).toEqual([null, null, null, null, null, 'Unstar', 'Give back', null, 'Next', null, null, 'Previous']);
  });

  it('fit the grid like every other menu, and give way to build mode', () => {
    expect(problems(factoryMenu(ctx({ group })))).toEqual([]);
    expect(factoryMenu(ctx({ group, building: true })).title).toBe('Build');
  });
});
