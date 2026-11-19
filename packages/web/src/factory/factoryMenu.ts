/**
 * The Factory's command card, as menus. Three levels at most:
 *
 *   Factory ─ Build ─┬─ Move      (belt, bridge, arm, the way they face)
 *                    ├─ Station   (agent, skill, panel, gate, status)
 *                    ├─ Area      (zone, exit, label, desk, intake)
 *                    └─ a selection (turn, remove)
 *           └ a ticket or a machine selected on the floor (a machine: stop or start it, and Edit opens its popup)
 *
 * The card is five columns by three rows, and a command's key is its place on the keyboard (`keys.ts`). A command
 * keeps its place from one menu to the next. The bottom row never moves: Undo and Redo first (build mode), Next
 * fourth (the floor), and last the way in and out: Build, Done, Previous, Cancel. Fit is fourth in the middle row in
 * every menu, which is the F key on any keyboard. Only the top row and the rest of the middle row change.
 */
import type { Tool } from './layoutOps';
import type { TicketGroup } from './pick';
import { BACK_SLOT, menu, type Command, type Menu } from './menu';
import { SET_ASIDE, type Dir, type MachineSpec, type TicketPhase } from './types';

const ARROW = ['→', '↓', '←', '↑'];

export interface MenuContext {
  building: boolean;
  tool: Tool;
  dir: Dir;
  /** The ticket selected, with the outcomes of the station it is in (empty elsewhere), and whether it can be set aside there. */
  ticket: { phase: TicketPhase; released: boolean; favorite: boolean | null; outcomes: string[]; canAside?: boolean; /** An item, not a ticket: it has a source to open and is archived, not given back. */ item?: { url: string | null } } | null;
  /**
   * The machine selected. `waiting` is true for a zone that holds a ticket not yet released; `power` says whether a
   * station that runs something is switched on (null for what has no switch); `popup` whether it opens in a popup.
   */
  machine: { kind: MachineSpec['kind']; waiting: boolean; power?: 'on' | 'off' | null; popup?: boolean } | null;
  /** In build mode, what the selection's belts can be made: `up` when one of them is a plain belt, `down` when all are fast, null with no belt selected. */
  speed?: 'up' | 'down' | null;
  /** How many machines are selected together (0 or 1 when it is not a group). */
  many: number;
  /** How many tickets wait for someone on the floor. */
  waiting?: number;
  /** Several tickets selected together (a frame dragged out of build mode): how many each command would act on. */
  group?: TicketGroup | null;
  undoable: boolean; redoable: boolean; hasClip: boolean;
  /** How the platform writes its chord key: `⌘` or `Ctrl+`. */
  mod: string;
  act: {
    build(): void; done(): void; intake(): void; fit(): void; plan(): void;
    /** Open the ticket creation form: at the desk selected, else at the floor's first desk, else for Inbound. */
    newTicket(): void;
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
    openTicket(): void; star(): void; giveBack(): void;
    /** An item: open its conversation where it lives, and archive it. */
    openSource(): void; archive(): void; resolve(outcome: string): void; release(): void; retry(): void;
    /** Take the ticket off its station's hands; and put it back as one of the station's outcomes (`retry` puts it back for another run). */
    setAside(): void; putBack(outcome: string): void;
    /** Open the popup of the machine selected: its settings, what it holds, what it did. */
    openMachine(): void; releaseNext(): void;
    /** Stop the station selected, or start it again. */
    power(): void;
    /** Open the popup of the floor itself: its figures and its limits. */
    floor(): void;
    /** The floor's run limits, in a popup of their own. */
    limits(): void;
    /** Go to the next ticket that waits for someone. */
    next(): void;
    /** Make the belts selected fast, or plain again. */
    speed(): void;
  };
}

/** Where the commands that never move are: Fit, Undo, Redo, Next, and the last slot (`BACK_SLOT`). */
export const FIT_SLOT = 8, UNDO_SLOT = 10, REDO_SLOT = 11, NEXT_SLOT = 13;

export function factoryMenu(c: MenuContext): Menu {
  const a = c.act;
  const back = (label: string, title: string, run: () => void): Command => ({ id: 'back', also: 'Escape', label, icon: 'back', tone: 'back', title, run });
  const fit: Command = { id: 'fit', label: 'Fit', icon: 'fit', tone: 'plain', title: 'Frame the floor', run: a.fit };

  /* out of build mode, always at the same place: the next ticket that waits for someone */
  const next: Command = { id: 'next', also: 'N', label: 'Next', icon: 'person', tone: 'plan', disabled: !c.waiting, title: c.waiting ? 'Go to the next ticket that waits for you (Shift+N: the one before)' : 'No ticket waits for you', run: a.next };

  // ---------- several tickets ----------
  if (c.group && !c.building) {
    /* each command where a single ticket has it; it acts on those of the group it applies to */
    const g = c.group, of = (n: number) => (n === g.count ? `the ${n} tickets` : `${n} of the ${g.count} tickets`);
    return menu('Tickets', {
      0: g.release > 0 && { id: 'release', label: 'Release', icon: 'play', tone: 'go', title: `Let an arm take ${of(g.release)} out of their zone`, run: a.release },
      1: g.retry > 0 && { id: 'retry', label: 'Run again', icon: 'loop', tone: 'ticket', title: `Put back ${of(g.retry)}: their station runs on them again`, run: a.retry },
      6: { id: 'star', label: g.starred ? 'Unstar' : 'Star', icon: 'star', tone: 'plan', active: g.starred, title: g.starred ? 'Remove them from your favourites' : 'Make them favourites: they then carry their name on the floor', run: a.star },
      7: g.aside > 0 && { id: 'aside', label: 'Set aside', icon: 'person', tone: 'plan', title: `Keep ${of(g.aside)} in their station until you put them back; a run in progress is stopped`, run: a.setAside },
      [FIT_SLOT]: fit,
      9: { id: 'give', label: 'Give back', icon: 'give', tone: 'plain', title: `Take the ${g.count} tickets out of the Factory (asked first)`, run: a.giveBack },
      [NEXT_SLOT]: next,
      [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
    });
  }

  // ---------- a ticket ----------
  if (c.ticket?.item && !c.building) {
    const t = c.ticket, url = c.ticket.item.url;
    return menu('Item', {
      0: t.phase === 'zone' && !t.released ? { id: 'release', label: 'Release', icon: 'play', tone: 'go', title: 'Let an arm take this item out now, without waiting for its conversation to be quiet', run: a.release } : null,
      5: { id: 'source', label: 'Source', icon: 'open', tone: 'ticket', disabled: !url, title: url ? 'Open the conversation where it lives (also Enter)' : 'This item has no link to its source', run: a.openSource },
      [FIT_SLOT]: fit,
      9: { id: 'archive', label: 'Archive', icon: 'trash', tone: 'danger', title: 'Junk, or done with: it leaves the floor. A new message in its conversation brings it back', run: a.archive },
      [NEXT_SLOT]: next,
      [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
    });
  }
  if (c.ticket && !c.building) {
    const t = c.ticket, first: Record<number, Command> = {};
    if (t.phase === 'review') t.outcomes.slice(0, 4).forEach((o, i) => { first[i] = { id: `decide-${i}`, label: o, icon: i ? 'loop' : 'check', tone: i ? 'ticket' : 'go', title: `Decide: ${o}`, run: () => a.resolve(o) }; });
    else if (t.phase === 'zone' && !t.released) first[0] = { id: 'release', label: 'Release', icon: 'play', tone: 'go', title: 'Let an arm take this ticket out of its zone', run: a.release };
    else if (SET_ASIDE.includes(t.phase)) {
      /* set aside in its station: back for another run, or out by the arm of an outcome, as done by hand */
      first[0] = { id: 'retry', label: 'Run again', icon: 'loop', tone: 'go', title: 'Put it back: the station runs on it again', run: a.retry };
      t.outcomes.slice(0, 4).forEach((o, i) => { first[i + 1] = { id: `as-${i}`, label: o, icon: 'exit', tone: 'ticket', title: `Put it back as "${o}": it leaves the station by that arm, as done by hand`, run: () => a.putBack(o) }; });
    }
    return menu('Ticket', {
      ...first,
      5: { id: 'open', label: 'Open', icon: 'open', tone: 'ticket', title: 'The ticket, its thread and its actions, without leaving the floor (also Enter)', run: a.openTicket },
      6: t.favorite === null ? null : { id: 'star', label: t.favorite ? 'Unstar' : 'Star', icon: 'star', tone: 'plan', active: t.favorite, title: t.favorite ? 'Remove from your favourites' : 'Make it a favourite: it then carries its name on the floor', run: a.star },
      7: t.canAside ? { id: 'aside', label: 'Set aside', icon: 'person', tone: 'plan', title: t.phase === 'running' ? 'Stop the run and keep the ticket in its station until you put it back' : 'Keep the ticket in its station until you put it back', run: a.setAside } : null,
      [FIT_SLOT]: fit,
      9: { id: 'give', label: 'Give back', icon: 'give', tone: 'plain', title: 'Take this ticket out of the Factory', run: a.giveBack },
      [NEXT_SLOT]: next,
      [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
    });
  }

  /* at the place where a ticket has Open: the popup of what is selected */
  const edit: Command = { id: 'edit', label: 'Edit', icon: 'edit', tone: 'station', title: 'Its settings, the tickets it holds and what it did, in a popup over the floor (also Enter, or a double-click)', run: a.openMachine };

  // ---------- the floor, out of build mode ----------
  if (!c.building) {
    if (c.machine) {
      const off = c.machine.power === 'off';
      return menu('Machine', {
        0: c.machine.kind === 'desk' ? { id: 'new-ticket', label: 'New ticket', icon: 'newticket', tone: 'go', title: 'Create a ticket at this desk: it is born here, with the desk\'s board, type and priority', run: a.newTicket }
          : c.machine.kind === 'zone' ? { id: 'release-next', label: 'Release 1', icon: 'play', tone: 'go', disabled: !c.machine.waiting, title: 'Release the ticket that has waited longest', run: a.releaseNext }
          : c.machine.power ? { id: 'power', label: off ? 'Start' : 'Stop', icon: off ? 'play' : 'stop', tone: off ? 'go' : 'danger', title: off ? 'Start the station again: it runs on the tickets it holds' : 'Stop the station: it keeps taking tickets in and starts nothing on them; what runs finishes', run: a.power }
          : null,
        5: c.machine.popup && edit,
        [FIT_SLOT]: fit,
        [NEXT_SLOT]: next,
        [BACK_SLOT]: back('Previous', 'Back to the floor', a.deselect),
      });
    }
    return menu('Factory', {
      0: { id: 'intake', label: 'Intake', icon: 'inbound', tone: 'ticket', title: 'Hand tickets over to the Factory: they land in Inbound', run: a.intake },
      1: { id: 'tickets', also: 'Tab', label: 'Tickets', icon: 'list', tone: 'ticket', title: 'Every ticket on the floor, as a list to filter and to jump from', run: a.tickets },
      2: { id: 'floor', label: 'Stats', icon: 'coin', tone: 'plain', title: 'What the floor did over the period, where tickets stand, and its safety limits', run: a.floor },
      3: { id: 'limits', label: 'Limits', icon: 'gauge', tone: 'plain', title: 'How many runs the floor may start per hour, and how many at once', run: a.limits },
      4: { id: 'new-ticket', label: 'New ticket', icon: 'newticket', tone: 'go', title: 'Create a ticket on the floor: at your first desk, or in Inbound when there is none (select a desk to create at that one)', run: a.newTicket },
      [FIT_SLOT]: fit,
      [NEXT_SLOT]: next,
      /* the way into build mode is where the way out of it is */
      [BACK_SLOT]: { id: 'build', label: 'Build', icon: 'build', tone: 'go', title: 'Lay belts, arms, stations and zones', run: a.build },
    });
  }

  // ---------- build mode: one frame, whatever the menu ----------
  /* copy, cut and paste are on the keyboard only, and a click or a drag selects: none of them takes a place on the card */
  const selected = c.tool === 'select' && (c.many > 1 || !!c.machine);
  const frame = (title: string, top: Record<number, Command | null | false>, last: Command): Menu => menu(title, {
    ...top,
    [FIT_SLOT]: fit,
    [UNDO_SLOT]: { id: 'undo', label: 'Undo', icon: 'undo', tone: 'plain', disabled: !c.undoable, title: `Take back the last change to the floor (also ${c.mod}Z)`, run: a.undo },
    [REDO_SLOT]: { id: 'redo', label: 'Redo', icon: 'redo', tone: 'plain', disabled: !c.redoable, title: `Put back the change you took back (also ${c.mod}Shift+Z)`, run: a.redo },
    [BACK_SLOT]: last,
  });
  const place = (id: Tool, label: string, tone: Command['tone'], title: string): Command => ({ id, label, icon: id, tone, active: c.tool === id, title, run: () => a.tool(id) });
  const previous = back('Previous', 'Back to the build menu', a.back);

  if (selected) {
    const turns = c.many <= 1 && (c.machine?.kind === 'belt' || c.machine?.kind === 'arm');
    return frame(c.many > 1 ? 'Selection' : 'Machine', {
      0: turns && { id: 'turn', label: 'Turn', icon: 'rotate', tone: 'move', title: 'Quarter turn', run: a.turn },
      1: !!c.speed && { id: 'speed', label: c.speed === 'up' ? 'Speed up' : 'Slow down', icon: c.speed === 'up' ? 'fastbelt' : 'belt', tone: 'move', title: c.speed === 'up' ? 'Make the belts selected fast: they carry tickets twice as fast' : 'Make the belts selected plain belts again', run: a.speed },
      4: { id: 'remove', also: 'Delete', label: 'Remove', icon: 'trash', tone: 'danger', title: c.many > 1 ? `Remove the ${c.many} selected machines` : 'Remove this machine from the floor', run: a.remove },
      5: c.many <= 1 && !!c.machine?.popup && edit,
    }, back('Previous', 'Back to the build menu', a.deselect));
  }

  /* what goes on a line of belts is in Move: the gantry that sets, like the toll */
  const move = frame('Move', {
    0: place('belt', 'Belt', 'move', 'Drag to lay belts: each tile points the way you drag'),
    1: place('fastbelt', 'Fast belt', 'move', 'Belts that carry tickets twice as fast. Drag to lay them; over belts already there, it speeds them up'),
    2: place('bridge', 'Bridge', 'move', 'Where two belts cross: each ticket goes straight across, the lines do not mix'),
    3: place('arm', 'Arm', 'move', 'Takes from the tile behind it, drops on the tile in front'),
    4: place('teleporter', 'Teleporter', 'move', 'A jump across the floor: a departure sends its ticket to the arrival it is set to. Its popup says which of the two it is'),
    5: place('toll', 'Toll', 'move', 'A gantry that sets things on a ticket, then takes it off the belt when a condition holds: what stops a loop'),
    6: place('set', 'Set', 'move', 'A gantry over a belt: it sets fields and tags on every ticket that goes under it, without stopping it'),
    7: { id: 'face', label: `Face ${ARROW[c.dir]}`, icon: 'rotate', tone: 'plain', title: 'Direction of the belts and arms you place', run: a.face },
  }, previous);
  const station = frame('Station', {
    0: place('agent', 'Agent', 'station', 'A station that runs a persona on the ticket'),
    1: place('skill', 'Skill', 'station', 'A station that runs a skill'),
    2: place('panel', 'Panel', 'station', 'A station that runs a panel of personas'),
    3: place('script', 'Script', 'station', 'A station that runs shell commands in the ticket\'s worktrees or its workspace: tests, a build, anything'),
    4: place('gate', 'Gate', 'station', 'Waits for your decision; each outcome leaves by its own arm'),
    5: place('native', 'Status', 'station', 'Sets a status on the ticket and lets it through'),
  }, previous);
  const area = frame('Area', {
    0: place('zone', 'Zone', 'area', 'Tickets wait here until released'),
    1: place('exit', 'Exit', 'area', 'Sets the ticket to done and hands it back to Fleex'),
    2: place('label', 'Label', 'area', 'A name on the floor'),
    4: place('intake', 'Intake', 'area', 'Where items of one source come in (Slack, Gmail, GitHub): they wait while the conversation moves, what its rules recognise is dropped'),
    3: place('desk', 'Desk', 'area', 'Where tickets are born: New ticket opens the creation form on it, with its board, type and priority, and an arm takes the ticket out'),
  }, previous);

  const inHand = c.tool !== 'select';
  return frame('Build', {
    0: { id: 'move', label: 'Move', icon: 'belt', tone: 'move', title: 'What carries tickets: belts, bridges, arms, teleporters, and the gantries that go on a belt', menu: move },
    1: { id: 'station', label: 'Station', icon: 'agent', tone: 'station', title: 'What works on tickets: agents, skills, panels, scripts, gates, status changes', menu: station },
    2: { id: 'area', label: 'Area', icon: 'zone', tone: 'area', title: 'Where tickets wait or leave, and names on the floor', menu: area },
    3: { id: 'plan', label: 'Plan', icon: 'plan', tone: 'plan', title: 'Turn one of your workflows into machines and put them on the floor', run: a.plan },
    4: { ...place('erase', 'Erase', 'danger', 'Click or drag to remove machines') },
  }, inHand ? back('Cancel', 'Put down what is in hand', a.select) : back('Done', 'Leave build mode', a.done));
}
