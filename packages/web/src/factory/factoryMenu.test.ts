import { describe, it, expect, vi } from 'vitest';
import { factoryMenu, FIT_SLOT, NEXT_SLOT, REDO_SLOT, UNDO_SLOT, type MenuContext } from './factoryMenu';
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
    ['desk', factoryMenu(ctx({ machine: { kind: 'desk', waiting: false, popup: true } }))],
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

/** A menu's three rows of five. */
const rows = (m: Menu) => [0, 1, 2].map((r) => labels(m).slice(r * COLS, r * COLS + COLS));

describe('the command card', () => {
  it('is five columns by three rows, and its last slot leads back', () => {
    expect([COLS, ROWS, SLOTS, BACK_SLOT]).toEqual([5, 3, 15, 14]);
    expect(menu('x', { 0: null, 3: undefined, 5: false }).slots).toHaveLength(15);
  });

  it('no menu of the Factory has too many commands, a key used twice, or a label that would be cut', () => {
    for (const [name, m] of everyMenu()) expect([name, problems(m)]).toEqual([name, []]);
  });

  it('is three levels deep at most: the floor, build, and what build opens', () => {
    for (const [name, m] of everyMenu()) expect([name, depth(m) + (name.startsWith('build') || name.includes('building') ? 1 : 0) <= 3]).toEqual([name, true]);
    expect(depth(factoryMenu(ctx({ building: true })))).toBe(2);
    expect(depth(factoryMenu(ctx()))).toBe(1);
  });

  it('the commands that never move are where they are in every menu: Fit, Undo, Redo, Next and the last slot', () => {
    expect([FIT_SLOT, UNDO_SLOT, REDO_SLOT, NEXT_SLOT, BACK_SLOT]).toEqual([8, 10, 11, 13, 14]);
    /* Fit is the fourth key of the middle row, which is F on any keyboard: it is there in every menu */
    for (const [name, m] of everyMenu()) expect([name, at(m, FIT_SLOT)]).toEqual([name, 'Fit']);
  });

  it('an exit selected: View (what left by it) first, Edit under E', () => {
    const c = ctx({ machine: { kind: 'exit', waiting: false, popup: true } }), m = factoryMenu(c);
    expect(rows(m)[0]).toEqual(['View', null, 'Edit', null, null]);
    expect(rows(m)[1]).toEqual([null, null, null, 'Fit', null]);
    m.slots[0]!.run!(); expect(c.act.viewExit).toHaveBeenCalled();
    m.slots[2]!.run!(); expect(c.act.openMachine).toHaveBeenCalled();
  });

  it('with nothing selected: what the floor offers on the first row, and Build where Done will be', () => {
    const c = ctx(), root = factoryMenu(c);
    expect(rows(root)).toEqual([['Intake', 'Tickets', 'Stats', 'Limits', 'New ticket'], [null, 'Archived', 'Exits', 'Fit', null], [null, null, null, 'Next', 'Build']]);
    expect(byKey(root, 'Tab')).toMatchObject({ id: 'tickets', label: 'Tickets' });
    /* under Stats: what left by every exit */
    root.slots[7]!.run!(); expect(c.act.exits).toHaveBeenCalled();
    root.slots[6]!.run!(); expect(c.act.archived).toHaveBeenCalled();
    root.slots[2]!.run!(); expect(c.act.floor).toHaveBeenCalled();
    root.slots[3]!.run!(); expect(c.act.limits).toHaveBeenCalled();
    /* T on any keyboard: a ticket is created from the floor itself, never through the Work view */
    root.slots[4]!.run!(); expect(c.act.newTicket).toHaveBeenCalled();
    /* the way into build mode and the way out of it are the same slot, so the same key */
    root.slots[BACK_SLOT]!.run!(); expect(c.act.build).toHaveBeenCalled();
    expect(at(factoryMenu(ctx({ building: true })), BACK_SLOT)).toBe('Done');
  });

  it('an intake selected makes an item by hand at it', () => {
    const c = ctx({ machine: { kind: 'intake', waiting: false, popup: true } }), m = factoryMenu(c);
    expect(rows(m)[0]).toEqual(['New item', 'Archived', null, null, null]);
    m.slots[0]!.run!(); expect(c.act.newItem).toHaveBeenCalled();
  });

  it('a desk selected creates a ticket at it, where a zone releases and a station starts', () => {
    const c = ctx({ machine: { kind: 'desk', waiting: false, popup: true } }), desk = factoryMenu(c);
    expect(rows(desk)[0]).toEqual(['New ticket', null, null, null, null]);
    desk.slots[0]!.run!(); expect(c.act.newTicket).toHaveBeenCalled();
    expect(at(desk, 5)).toBe('Edit');
  });

  it('an item selected: release it, open its source, archive it; nothing a ticket only has', () => {
    const c = ctx({ ticket: { phase: 'zone', released: false, favorite: null, outcomes: [], item: { url: 'https://x.slack.com/a' } } }), m = factoryMenu(c);
    expect(m.title).toBe('Item');
    expect(rows(m)).toEqual([['Release', null, null, null, null], ['Open', 'Source', null, 'Fit', 'Archive'], [null, null, null, 'Next', 'Previous']]);
    m.slots[5]!.run!(); expect(c.act.openTicket).toHaveBeenCalled();
    m.slots[6]!.run!(); expect(c.act.openSource).toHaveBeenCalled();
    m.slots[9]!.run!(); expect(c.act.archive).toHaveBeenCalled();
    expect(factoryMenu(ctx({ ticket: { phase: 'belt', released: false, favorite: null, outcomes: [], item: { url: null } } })).slots[6]!.disabled).toBe(true);
  });

  it('an item a station asked about, or failed on: run again, or send it on by an outcome; at a gate, decide', () => {
    const c = ctx({ ticket: { phase: 'question', released: false, favorite: null, outcomes: ['junk', 'mine'], item: { url: null } } }), m = factoryMenu(c);
    expect(rows(m)[0]).toEqual(['Run again', 'junk', 'mine', null, null]);
    m.slots[0]!.run!(); expect(c.act.retry).toHaveBeenCalled();
    m.slots[2]!.run!(); expect(c.act.putBack).toHaveBeenCalledWith('mine');
    expect(rows(factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: null, outcomes: ['approve', 'reject'], item: { url: null } } })))[0]).toEqual(['approve', 'reject', null, null, null]);
  });

  it('build sorts what can be placed into Move, Station and Place', () => {
    const build = factoryMenu(ctx({ building: true }));
    expect(rows(build)).toEqual([['Move', 'Station', 'Place', 'Plan', 'Erase'], [null, 'Export', 'Import', 'Fit', null], ['Undo', 'Redo', null, null, 'Done']]);
    /* what goes on a line of belts is in Move: the Set gantry is there, next to the toll */
    expect(rows(menuAt(build, ['move']).menu).slice(0, 2)).toEqual([['Belt', 'Fast belt', 'Bridge', 'Arm', 'Teleporter'], ['Toll', 'Set', 'Face →', 'Fit', null]]);
    expect(rows(menuAt(build, ['station']).menu).slice(0, 2)).toEqual([['Agent', 'Skill', 'Panel', 'Script', 'Gate'], [null, null, null, 'Fit', null]]);
    expect(rows(menuAt(build, ['place']).menu).slice(0, 2)).toEqual([['Zone', 'Exit', 'Label', 'Area', 'Desk'], ['Intake', null, null, 'Fit', null]]);
    expect(menuAt(build, ['move']).titles).toEqual(['Build', 'Move']);
  });

  it('exports the floor and imports one from the build card; with machines selected, Export takes only them', () => {
    const c = ctx({ building: true }), build = factoryMenu(c);
    build.slots[6]!.run!(); build.slots[7]!.run!();
    expect(c.act.exportFloor).toHaveBeenCalledTimes(1); expect(c.act.importFloor).toHaveBeenCalledTimes(1);
    const sel = factoryMenu(ctx({ building: true, many: 3 }));
    expect(sel.slots[6]).toMatchObject({ id: 'export', title: expect.stringContaining('3 machines selected') });
    expect(sel.slots[7]).toBeFalsy();
  });

  it('keeps Undo, Redo and the way back at the same place in every build menu, and leaves copy, cut and paste to the keyboard', () => {
    const build = factoryMenu(ctx({ building: true }));
    const menus = [build, menuAt(build, ['move']).menu, menuAt(build, ['station']).menu, menuAt(build, ['place']).menu,
      factoryMenu(ctx({ building: true, machine: { kind: 'belt', waiting: false } })), factoryMenu(ctx({ building: true, many: 4 }))];
    for (const m of menus) {
      expect([UNDO_SLOT, REDO_SLOT].map((i) => at(m, i))).toEqual(['Undo', 'Redo']);
      expect(m.slots.some((c) => c && ['Copy', 'Cut', 'Paste'].includes(c.label))).toBe(false);
      expect(m.slots[BACK_SLOT]).toMatchObject({ id: 'back', also: 'Escape' });
    }
    expect(menus.map((m) => at(m, BACK_SLOT))).toEqual(['Done', 'Previous', 'Previous', 'Previous', 'Previous', 'Previous']);
  });

  it('undo and redo wait for something to take back; a selection has its own commands', () => {
    const idle = factoryMenu(ctx({ building: true, undoable: false, hasClip: false }));
    expect([UNDO_SLOT, REDO_SLOT].map((i) => idle.slots[i]!.disabled)).toEqual([true, true]);
    const sel = factoryMenu(ctx({ building: true, many: 3, redoable: true }));
    expect([UNDO_SLOT, REDO_SLOT].map((i) => !!sel.slots[i]!.disabled)).toEqual([false, false]);
    expect([at(sel, 0), at(sel, 4)]).toEqual([null, 'Remove']);
    expect(byKey(sel, 'Delete')).toMatchObject({ id: 'remove' });
    const arm = factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false } }));
    expect([at(arm, 0), at(arm, 4)]).toEqual(['Turn', 'Remove']);
  });

  it('shows the tool in hand, and offers to put it down instead of leaving', () => {
    const erasing = factoryMenu(ctx({ building: true, tool: 'erase' }));
    expect(erasing.slots[4]).toMatchObject({ label: 'Erase', active: true });
    expect(erasing.slots.some((c) => c?.label === 'Select')).toBe(false);          // a click or a drag selects: no command for it
    expect(at(erasing, BACK_SLOT)).toBe('Cancel');
    const belts = menuAt(factoryMenu(ctx({ building: true, tool: 'belt', dir: 1 })), ['move']).menu;
    expect(belts.slots[0]).toMatchObject({ label: 'Belt', active: true });
    expect(at(belts, 7)).toBe('Face ↓');
    expect(at(factoryMenu(ctx({ building: true, tool: 'paste' })), BACK_SLOT)).toBe('Cancel');   // what was pasted from the keyboard is put down the same way
  });

  it('a command is run by its place; named keys only run what answers to them in the menu shown', () => {
    const c = ctx({ building: true }), build = factoryMenu(c), move = menuAt(build, ['move']).menu;
    move.slots[0]!.run!();
    expect(c.act.tool).toHaveBeenCalledWith('belt');
    expect(build.slots[0]!.menu).toBe(move);
    byKey(move, 'Escape')!.run!();
    expect(c.act.back).toHaveBeenCalled();
    byKey(build, 'Escape')!.run!();
    expect(c.act.done).toHaveBeenCalled();
    expect(byKey(build, 'Delete')).toBeNull();     // nothing to remove in this menu
    expect(byKey(build, '')).toBeNull();           // most commands answer to no named key
  });

  it('a ticket shows what it waits for on the first row, then the same commands on the second', () => {
    const gate = factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: false, outcomes: ['approve', 'rework'] } }));
    expect(rows(gate)).toEqual([['approve', 'rework', null, null, null], ['Open', 'Star', null, 'Fit', 'Give back'], [null, null, null, 'Next', 'Previous']]);
    const zone = factoryMenu(ctx({ ticket: { phase: 'zone', released: false, favorite: true, outcomes: [] } }));
    expect([at(zone, 0), at(zone, 5), at(zone, 6), at(zone, 9)]).toEqual(['Release', 'Open', 'Unstar', 'Give back']);
    expect(at(factoryMenu(ctx({ ticket: { phase: 'question', released: false, favorite: false, outcomes: [] } })), 0)).toBe('Run again');
    expect(at(factoryMenu(ctx({ ticket: { phase: 'belt', released: false, favorite: false, outcomes: [] } })), 0)).toBeNull();
    /* set aside in its station: back for another run at the same place as after a failure, then one tile per outcome to leave by */
    const aside = factoryMenu(ctx({ ticket: { phase: 'aside', released: false, favorite: false, outcomes: ['ok', 'drop'] } }));
    expect([0, 1, 2, 3].map((i) => at(aside, i))).toEqual(['Run again', 'ok', 'drop', null]);
    expect(at(aside, 7)).toBeNull();
    expect(at(factoryMenu(ctx({ ticket: { phase: 'running', released: false, favorite: false, outcomes: ['ok'], canAside: true } })), 7)).toBe('Set aside');
    /* a gate with four ways out shows them all, and a station's four outcomes fit after Run again */
    expect(rows(factoryMenu(ctx({ ticket: { phase: 'review', released: false, favorite: false, outcomes: ['a', 'b', 'c', 'd', 'e'] } })))[0]).toEqual(['a', 'b', 'c', 'd', null]);
    expect(rows(factoryMenu(ctx({ ticket: { phase: 'failed', released: false, favorite: false, outcomes: ['a', 'b', 'c', 'd', 'e'] } })))[0]).toEqual(['Run again', 'a', 'b', 'c', 'd']);
  });

  it('a machine is stopped or started from the card, and Edit opens its popup where a ticket has Open', () => {
    const c = ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'on' } }), on = factoryMenu(c);
    expect(rows(on)).toEqual([['Stop', null, null, null, null], ['Edit', null, null, 'Fit', null], [null, null, null, 'Next', 'Previous']]);
    on.slots[0]!.run!(); expect(c.act.power).toHaveBeenCalled();
    on.slots[5]!.run!(); expect(c.act.openMachine).toHaveBeenCalled();
    expect(at(factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: 'off' } })), 0)).toBe('Start');
    /* a gate or a status station has no switch; a zone keeps Release at that place; a belt has nothing to edit */
    const first = (m: Menu) => [at(m, 0), at(m, 5)];
    expect(first(factoryMenu(ctx({ machine: { kind: 'station', waiting: false, popup: true, power: null } })))).toEqual([null, 'Edit']);
    expect(first(factoryMenu(ctx({ machine: { kind: 'zone', waiting: true, popup: true } })))).toEqual(['Release 1', 'Edit']);
    expect(first(factoryMenu(ctx({ machine: { kind: 'belt', waiting: false, popup: false } })))).toEqual([null, null]);
    /* in build mode the machine selected keeps Edit at the same place, a group has none */
    expect(at(factoryMenu(ctx({ building: true, machine: { kind: 'arm', waiting: false, popup: true } })), 5)).toBe('Edit');
    expect(at(factoryMenu(ctx({ building: true, many: 3, machine: null })), 5)).toBeNull();
  });

  it('out of build mode, Next is always at the same place: the next ticket that waits, when one does', () => {
    const c = ctx({ waiting: 2 });
    for (const m of [factoryMenu(c), factoryMenu({ ...c, machine: { kind: 'zone', waiting: false, popup: true } }), factoryMenu({ ...c, ticket: { phase: 'belt', released: false, favorite: false, outcomes: [] } })]) {
      expect(m.slots[NEXT_SLOT]).toMatchObject({ label: 'Next', also: 'N', disabled: false });
    }
    byKey(factoryMenu(c), 'N')!.run!(); expect(c.act.next).toHaveBeenCalled();
    expect(factoryMenu(ctx()).slots[NEXT_SLOT]).toMatchObject({ label: 'Next', disabled: true });
    expect(labels(factoryMenu(ctx({ building: true, waiting: 2 })))).not.toContain('Next');
  });

  it('in build mode, the belts selected are sped up or slowed down from the card', () => {
    const c = ctx({ building: true, machine: { kind: 'belt', waiting: false, popup: false }, speed: 'up' }), up = factoryMenu(c);
    expect(rows(up)[0]).toEqual(['Turn', 'Speed up', null, null, 'Remove']);
    up.slots[1]!.run!(); expect(c.act.speed).toHaveBeenCalled();
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
      { id: 'a', also: 'Escape', label: 'One', icon: 'x', run: () => {} }, { id: 'a', also: 'Escape', label: 'A label far too long', icon: 'x', run: () => {} },
      { id: 'c', label: 'More...', icon: 'x' }, ...Array.from({ length: 14 }, () => null),
    ] };
    const said = problems(bad).join('\n');
    expect(said).toMatch(/17 slots for a grid of 15/);
    expect(said).toMatch(/two commands are called a/);
    expect(said).toMatch(/share the key Escape/);
    expect(said).toMatch(/too long to be shown whole/);
    expect(said).toMatch(/trails off/);
    expect(said).toMatch(/More\.\.\. does nothing/);
  });
});

describe('several tickets selected together', () => {
  const group = { count: 5, release: 2, retry: 1, aside: 3, starred: false };

  it('have each command where a single ticket has it, and only those that apply to some of them', () => {
    const c = ctx({ group }), m = factoryMenu(c);
    expect(rows(m)).toEqual([['Release', 'Run again', null, null, null], [null, 'Star', 'Set aside', 'Fit', 'Give back'], [null, null, null, 'Next', 'Previous']]);
    expect(m.title).toBe('Tickets');
    m.slots[0]!.run!(); expect(c.act.release).toHaveBeenCalled();
    m.slots[7]!.run!(); expect(c.act.setAside).toHaveBeenCalled();
    m.slots[9]!.run!(); expect(c.act.giveBack).toHaveBeenCalled();
    byKey(m, 'Escape')!.run!(); expect(c.act.deselect).toHaveBeenCalled();
    expect(m.slots[0]!.title).toContain('2 of the 5 tickets');
    const quiet = factoryMenu(ctx({ group: { count: 3, release: 0, retry: 0, aside: 0, starred: true } }));
    expect(rows(quiet)).toEqual([[null, null, null, null, null], [null, 'Unstar', null, 'Fit', 'Give back'], [null, null, null, 'Next', 'Previous']]);
  });

  it('fit the grid like every other menu, and give way to build mode', () => {
    expect(problems(factoryMenu(ctx({ group })))).toEqual([]);
    expect(factoryMenu(ctx({ group, building: true })).title).toBe('Build');
  });
});
