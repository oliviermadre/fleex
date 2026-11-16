/**
 * The Factory's command card, as menus. Three levels at most:
 *
 *   Factory ─ Build ─┬─ Move      (belt, bridge, arm, the way they face)
 *                    ├─ Station   (agent, skill, panel, gate, status)
 *                    ├─ Area      (zone, exit, label)
 *                    └─ a selection (turn, remove)
 *           └ a ticket or a machine selected on the floor
 *
 * A command keeps its place from one menu to the next: in every build menu the
 * last two slots of the middle row are Undo and Redo, and the bottom row is
 * Copy, Cut, Paste and the way back. Only the first six slots change.
 */
import type { Tool } from './layoutOps';
import { BACK_SLOT, menu, type Command, type Menu } from './menu';
import type { Dir, MachineSpec, TicketPhase } from './types';

const ARROW = ['→', '↓', '←', '↑'];

export interface MenuContext {
  building: boolean;
  tool: Tool;
  dir: Dir;
  /** The ticket selected, with the outcomes of the gate it waits at (empty elsewhere). */
  ticket: { phase: TicketPhase; released: boolean; favorite: boolean | null; outcomes: string[] } | null;
  /** The machine selected; `waiting` is true for a zone that holds a ticket not yet released. */
  machine: { kind: MachineSpec['kind']; waiting: boolean } | null;
  /** How many machines are selected together (0 or 1 when it is not a group). */
  many: number;
  undoable: boolean; redoable: boolean; hasClip: boolean;
  /** How the platform writes its chord key: `⌘` or `Ctrl+`. */
  mod: string;
  act: {
    build(): void; done(): void; intake(): void; fit(): void; plan(): void;
    /** Open the list of the tickets on the floor. */
    tickets(): void;
    /** Take a tool in hand, or put it down when it already is. */
    tool(t: Tool): void;
    /** Put down whatever tool is in hand. */
    select(): void;
    /** Leave a sub-menu. */
    back(): void;
    face(): void; undo(): void; redo(): void; copy(): void; cut(): void; paste(): void;
    turn(): void; remove(): void; deselect(): void;
    openTicket(): void; star(): void; giveBack(): void; resolve(outcome: string): void; release(): void; retry(): void;
    openMachine(): void; releaseNext(): void;
  };
}

export function factoryMenu(c: MenuContext): Menu {
  const a = c.act;
  const back = (label: string, title: string, run: () => void): Command => ({ id: 'back', key: 'Escape', label, icon: 'back', tone: 'back', title, run });

  // ---------- a ticket ----------
  if (c.ticket && !c.building) {
    const t = c.ticket, first: Record<number, Command> = {};
    if (t.phase === 'review') t.outcomes.slice(0, 4).forEach((o, i) => { first[i] = { id: `decide-${i}`, key: 'QWER'[i]!, label: o, icon: i ? 'loop' : 'check', tone: i ? 'ticket' : 'go', title: `Decide: ${o}`, run: () => a.resolve(o) }; });
    else if (t.phase === 'zone' && !t.released) first[0] = { id: 'release', key: 'Q', label: 'Release', icon: 'play', tone: 'go', title: 'Let an arm take this ticket out of its zone', run: a.release };
    else if (t.phase === 'failed' || t.phase === 'question') first[0] = { id: 'retry', key: 'Q', label: 'Run again', icon: 'loop', tone: 'go', title: 'Run the station again on this ticket', run: a.retry };
    return menu('Ticket', {
      ...first,
      4: { id: 'open', key: 'V', label: 'Open', icon: 'open', tone: 'ticket', title: 'The ticket, its thread and its actions, without leaving the floor', run: a.openTicket },
      5: t.favorite === null ? null : { id: 'star', key: 'S', label: t.favorite ? 'Unstar' : 'Star', icon: 'star', tone: 'plan', active: t.favorite, title: t.favorite ? 'Remove from your favourites' : 'Make it a favourite: it then carries its name on the floor', run: a.star },
      6: { id: 'give', key: 'X', label: 'Give back', icon: 'give', tone: 'plain', title: 'Take this ticket out of the Factory', run: a.giveBack },
      [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
    });
  }

  // ---------- the floor, out of build mode ----------
  if (!c.building) {
    if (c.machine) {
      const box = c.machine.kind === 'station' || c.machine.kind === 'zone';
      return menu('Machine', {
        0: c.machine.kind === 'zone' && { id: 'release-next', key: 'Q', label: 'Release 1', icon: 'play', tone: 'go', disabled: !c.machine.waiting, title: 'Release the ticket that has waited longest', run: a.releaseNext },
        4: box && { id: 'open', key: 'V', label: 'Open', icon: 'open', tone: 'ticket', title: 'Everything inside, what each ticket waits for, and what this machine did lately', run: a.openMachine },
        [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
      });
    }
    return menu('Factory', {
      0: { id: 'build', key: 'B', label: 'Build', icon: 'build', tone: 'go', title: 'Lay belts, arms, stations and zones', run: a.build },
      1: { id: 'intake', key: 'T', label: 'Intake', icon: 'inbound', tone: 'ticket', title: 'Hand tickets over to the Factory: they land in Inbound', run: a.intake },
      2: { id: 'fit', key: 'F', label: 'Fit', icon: 'fit', tone: 'plain', title: 'Frame the floor', run: a.fit },
      3: { id: 'tickets', key: 'Tab', label: 'Tickets', icon: 'list', tone: 'ticket', title: 'Every ticket on the floor, as a list to filter and to jump from', run: a.tickets },
    });
  }

  // ---------- build mode: one frame, whatever the menu ----------
  const selected = c.tool === 'select' && (c.many > 1 || !!c.machine);
  const frame = (title: string, top: Record<number, Command | null | false>, last: Command): Menu => menu(title, {
    ...top,
    6: { id: 'undo', key: 'Z', label: 'Undo', icon: 'undo', tone: 'plain', disabled: !c.undoable, title: `Take back the last change to the floor (also ${c.mod}Z)`, run: a.undo },
    7: { id: 'redo', key: 'Y', label: 'Redo', icon: 'redo', tone: 'plain', disabled: !c.redoable, title: `Put back the change you took back (also ${c.mod}Shift+Z)`, run: a.redo },
    8: { id: 'copy', key: '', keyText: `${c.mod}C`, label: 'Copy', icon: 'copy', tone: 'plain', disabled: !selected, title: selected ? 'Copy what is selected, with its settings' : 'Select one or several machines to copy them', run: a.copy },
    9: { id: 'cut', key: '', keyText: `${c.mod}X`, label: 'Cut', icon: 'cut', tone: 'plain', disabled: !selected, title: selected ? 'Cut what is selected' : 'Select one or several machines to cut them', run: a.cut },
    10: { id: 'paste', key: '', keyText: `${c.mod}V`, label: 'Paste', icon: 'paste', tone: 'plain', disabled: !c.hasClip, active: c.tool === 'paste', title: c.hasClip ? 'Put down what you copied, cut or imported: click where' : 'Nothing copied yet', run: a.paste },
    [BACK_SLOT]: last,
  });
  const place = (id: Tool, key: string, label: string, tone: Command['tone'], title: string): Command => ({ id, key, label, icon: id, tone, active: c.tool === id, title, run: () => a.tool(id) });
  const previous = back('Previous', 'Back to the build menu', a.back);

  if (selected) {
    const turns = c.many <= 1 && (c.machine?.kind === 'belt' || c.machine?.kind === 'arm');
    return frame(c.many > 1 ? 'Selection' : 'Machine', {
      0: turns && { id: 'turn', key: 'R', label: 'Turn', icon: 'rotate', tone: 'move', title: 'Quarter turn', run: a.turn },
      3: { id: 'remove', key: 'Delete', label: 'Remove', icon: 'trash', tone: 'danger', title: c.many > 1 ? `Remove the ${c.many} selected machines` : 'Remove this machine from the floor', run: a.remove },
    }, back('Previous', 'Back to the build menu', a.deselect));
  }

  const move = frame('Move', {
    0: place('belt', 'C', 'Belt', 'move', 'Drag to lay belts: each tile points the way you drag'),
    1: place('bridge', 'H', 'Bridge', 'move', 'Where two belts cross: each ticket goes straight across, the lines do not mix'),
    2: place('arm', 'B', 'Arm', 'move', 'Takes from the tile behind it, drops on the tile in front'),
    3: { id: 'face', key: 'R', label: `Face ${ARROW[c.dir]}`, icon: 'rotate', tone: 'plain', title: 'Direction of the belts and arms you place', run: a.face },
  }, previous);
  const station = frame('Station', {
    0: place('agent', 'A', 'Agent', 'station', 'A station that runs a persona on the ticket'),
    1: place('skill', 'S', 'Skill', 'station', 'A station that runs a skill'),
    2: place('panel', 'N', 'Panel', 'station', 'A station that runs a panel of personas'),
    3: place('gate', 'G', 'Gate', 'station', 'Waits for your decision; each outcome leaves by its own arm'),
    4: place('native', 'T', 'Status', 'station', 'Sets a status on the ticket and lets it through'),
  }, previous);
  const area = frame('Area', {
    0: place('zone', 'D', 'Zone', 'area', 'Tickets wait here until released'),
    1: place('exit', 'O', 'Exit', 'area', 'Sets the ticket to done and hands it back to Fleex'),
    2: place('label', 'L', 'Label', 'area', 'A name on the floor'),
  }, previous);

  const inHand = c.tool !== 'select';
  return frame('Build', {
    0: { id: 'move', key: 'M', label: 'Move', icon: 'belt', tone: 'move', title: 'What carries tickets: belts, bridges, arms', menu: move },
    1: { id: 'station', key: 'S', label: 'Station', icon: 'agent', tone: 'station', title: 'What works on tickets: agents, skills, panels, gates, status changes', menu: station },
    2: { id: 'area', key: 'A', label: 'Area', icon: 'zone', tone: 'area', title: 'Where tickets wait or leave, and names on the floor', menu: area },
    3: { id: 'plan', key: 'P', label: 'Plan', icon: 'plan', tone: 'plan', title: 'Turn one of your workflows into machines and put them on the floor', run: a.plan },
    4: { id: 'select', key: 'Q', label: 'Select', icon: 'select', tone: 'plain', active: !inHand, title: 'Click a machine to set it up, drag on empty floor to select several', run: a.select },
    5: { ...place('erase', 'X', 'Erase', 'danger', 'Click or drag to remove machines') },
  }, inHand ? back('Cancel', 'Put down what is in hand', a.select) : back('Done', 'Leave build mode', a.done));
}
