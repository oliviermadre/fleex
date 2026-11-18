import { scriptSummary } from './script';
import { opText } from './setOps';
import { arrivalOf, portName } from './teleport';
import { useRef } from 'react';
import { Button } from '../components/ui/Button';
import { tintClasses, type TintHue } from '../lib/tints';
import { SLOTS, type Command, type Menu, type Tone } from './menu';
import { useKeyLabels } from './keys';
import { HUD } from './hudShape';
import { FactoryAvatar, type AvatarOf } from './FactoryAvatar';
import { Clock, Groups, Units, type Unit } from './FactoryHudBits';
import { machinesSel, ticketsSel } from './pick';
import { machineKind } from './FactoryMachinePopup';
import { cn } from '../lib/cn';
import { FIcon } from './icons';
import { useTicketStore } from '../stores/ticketStore';
import { since, span } from './format';
import { TicketGlyphs, TicketToken } from './FactoryTicketMeta';
import { LENS_LABEL } from './lens';
import { conditionsOf, longCondition } from './armRules';
import { TOGGLES, type Show } from './viewToggles';
import { bridgeFlow, flowLabel } from './bridges';
import type { FactoryView } from './renderer';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useFactoryStore } from './factoryStore';
import { periodLabel } from './FactoryStatsBits';
import { money } from './format';
import { needsHuman, RUNS, type FactoryLayout, type FactorySnapshot, type FactoryTicket, type Lens, type MachineSpec, type MachineStats, type Selection } from './types';

/** The layers of the floor, in the order they are listed next to the minimap. */
const LAYERS: [Lens, string, string][] = [
  ['none', 'Floor', 'The floor as it is'],
  ['load', LENS_LABEL.load, 'Where tickets stand right now, and for how long'],
  ['cost', LENS_LABEL.cost, 'What each station spent on agent runs'],
  ['time', LENS_LABEL.time, 'How long a run takes in each station'],
  ['human', LENS_LABEL.human, 'Where tickets wait for a human, and for how long'],
];

const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'waiting to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'run failed', aside: 'set aside by you', out: 'done, waiting for an arm', zone: 'in a zone', port: 'in a teleporter',
};
const YELLOW = tintClasses('yellow');
const alsoLabel = (k: string) => (k === 'Escape' ? 'Esc' : k === 'Delete' ? 'Del' : k);

function machineIcon(m: MachineSpec): string {
  if (m.kind === 'belt' && m.toll) return 'toll';
  if (m.kind === 'belt' && m.set !== undefined) return 'set';
  if (m.kind === 'station') return m.exec === 'human_gate' ? 'gate' : m.exec;
  return m.kind === 'zone' && m.inbound ? 'inbound' : m.kind;
}
function machineSub(m: MachineSpec, view: FactoryView, boardName: (id: string) => string): string {
  if (m.kind === 'belt' && m.toll) return `Toll · ${[...(m.set ?? []).map((o) => opText(o, boardName)), m.toll.when.length ? `rejects when ${m.toll.when.map((c) => longCondition(c, boardName)).join(', or ')}` : 'rejects nothing yet'].join(', ')}`;
  if (m.kind === 'belt' && m.set !== undefined) return `Set gantry · ${m.set.length ? m.set.map((o) => opText(o, boardName)).join(', ') : 'nothing set yet'}`;
  if (m.kind === 'belt') { const d = view.leadsTo(m); return `${m.fast ? 'Fast belt, twice as fast' : 'Belt'} · ${d ? `leads to ${d.name ?? d.kind}` : 'leads nowhere'}`; }
  if (m.kind === 'arm') { const when = conditionsOf(m); return `Arm · ${when.length ? `takes a ticket when ${when.map((c) => longCondition(c, boardName)).join(', and ')}` : 'takes anything, or what the arms next to it leave'}`; }
  if (m.kind === 'station') return m.exec === 'human_gate' ? `Gate · ${m.outcomes.join(' / ')}` : m.exec === 'native' ? `Sets status ${m.sets ?? ''}` : m.exec === 'script' ? `Script · ${scriptSummary(m.script)}` : `${m.exec} · ${m.ref || 'nothing chosen yet'}`;
  if (m.kind === 'zone') return m.inbound ? 'Inbound · tickets handed over land here' : `Zone${m.status ? ` · ${m.status}` : ''} · leaves ${m.release === 'auto' ? 'automatically' : 'when released'}`;
  if (m.kind === 'exit') return 'Exit · sets done and hands the ticket back to Fleex';
  if (m.kind === 'teleporter') {
    if (m.role === 'arrival') return 'Arrival · receives from its departures only, one ticket at a time; an arm takes it out';
    const to = arrivalOf(m, (id) => view.machine(id));
    return `Departure · ${to ? `sends its ticket to ${portName(to)}` : 'no destination: it keeps what it is given'}`;
  }
  if (m.kind === 'bridge') { const f = bridgeFlow((px, py) => view.at(px, py), m); return `Bridge · over ${flowLabel(f.over)}, under ${flowLabel(f.under)}`; }
  return 'Label';
}
const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'warning' | 'success' }) => (
  <span className="whitespace-nowrap text-[11px] text-[var(--theme-text-muted)]">{label} <b className={cn('font-mono font-medium', tone === 'danger' ? 'text-[var(--theme-danger)]' : tone === 'warning' ? 'text-[var(--theme-warning)]' : tone === 'success' ? 'text-[var(--theme-success)]' : 'text-[var(--theme-text-primary)]')}>{value}</b></span>
);
/** What a station did over the period, read only, on one line: the figures its popup shows in full. */
function Did({ q, gate, period }: { q: MachineStats | null; gate: boolean; period: string }) {
  if (!q || q.runs === 0) return <div className="text-[11px] text-[var(--theme-text-muted)]">{period}: nothing {gate ? 'decided' : 'ran'} here</div>;
  return (
    <div className="flex flex-wrap gap-x-3" aria-label="What it did">
      <span className="text-[11px] text-[var(--theme-text-faint)]">{period}</span>
      <Stat label={gate ? 'decisions' : 'runs'} value={q.runs} />
      {!gate && <Stat label="failed" value={q.failed} tone={q.failed ? 'danger' : undefined} />}
      {!gate && <Stat label="questions" value={q.questions} tone={q.questions ? 'warning' : undefined} />}
      {!gate && <Stat label="avg run" value={span(q.avgRunMs)} />}
      {gate ? <Stat label="avg decision" value={span(q.avgHumanMs)} /> : <Stat label="cost" value={money(q.costUsd)} />}
      {(gate || q.humanWaits > 0) && <Stat label="human wait" value={span(q.humanMs)} />}
    </div>
  );
}

/** The tickets a machine holds, as small squares: click one to select it. */
function Wire({ tickets, onSelect }: { tickets: FactoryTicket[]; onSelect: (s: Selection) => void }) {
  if (tickets.length === 0) return null;
  return (
    <div className="flex max-h-[58px] flex-wrap gap-[3px] overflow-hidden">
      {tickets.slice(0, 40).map((t) => (
        <button key={t.ticketId} type="button" onClick={() => onSelect({ ticket: t.ticketId })} title={`#${t.info?.displayId ?? '?'} ${t.info?.title ?? ''} · ${PHASE[t.phase]}`}
          aria-label={`Ticket ${t.info?.displayId ?? ''}`} className={cn('grid h-[26px] w-[26px] flex-none place-items-center rounded-md border', needsHuman(t) ? 'border-[var(--theme-warning)]' : 'border-transparent hover:border-[var(--theme-border-input)]')}>
          <TicketToken info={t.info ? { ...t.info, favorite: false } : null} size={18} />
        </button>
      ))}
      {tickets.length > 40 && <span className="self-center pl-1 font-mono text-[10px] text-[var(--theme-text-muted)]">+{tickets.length - 40}</span>}
    </div>
  );
}

/** The colour of each family of commands. `null`: the app's own neutral, accent or outline. */
const HUE: Record<Tone, TintHue | null> = { go: null, move: 'blue', station: 'purple', area: 'teal', plan: 'yellow', ticket: 'indigo', danger: 'red', back: null, plain: null };

/**
 * A side block of the console: taller than the middle, its inner top corner cut. The line along its edge follows
 * the cut: it is the block itself, in the border's colour, under a copy of it one pixel smaller.
 */
function Side({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  const c = HUD.cut, clip = side === 'left' ? `polygon(0 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% 100%, 0 100%)` : `polygon(${c}px 0, 100% 0, 100% 100%, 0 100%, 0 ${c}px)`;
  return (
    <div className="absolute bottom-0 bg-[var(--theme-border-input)]" style={{ [side]: 0, width: HUD[side], height: HUD.mid + HUD.step, clipPath: clip }}>
      <div className="absolute bg-[var(--theme-bg-surface)] p-2" style={{ top: 1, bottom: 0, left: side === 'right' ? 1 : 0, right: side === 'left' ? 1 : 0, clipPath: clip }}>{children}</div>
    </div>
  );
}

/** One command of the card: the key of its place, a large icon, its label whole. */
function Tile({ c, slotKey, onRun }: { c: Command; slotKey: string; onRun: (c: Command) => void }) {
  const tone = c.tone ?? 'plain', hue = HUE[tone], t = hue ? tintClasses(hue) : null;
  const look = t ? (c.active ? cn(t.solid, t.onSolid, 'border-transparent') : cn(t.bg, t.text, t.borderColor, t.hoverBg))
    : tone === 'go' ? 'border-transparent bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]'
    : tone === 'back' ? 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]'
    : c.active ? 'border-transparent bg-[var(--theme-text-primary)] text-[var(--theme-bg-base)]'
    : 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-border-input)]';
  const shortcut = c.also ? `${slotKey}, ${alsoLabel(c.also)}` : slotKey;
  return (
    <button type="button" disabled={c.disabled} onClick={() => onRun(c)} aria-pressed={c.active} aria-haspopup={c.menu ? 'menu' : undefined} title={`${c.title ?? c.label}${shortcut ? ` (${shortcut})` : ''}`}
      className={cn('relative flex h-[62px] w-[68px] flex-col items-center justify-end gap-[3px] rounded-lg border px-0.5 pb-[5px] transition-colors', look,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] disabled:pointer-events-none disabled:opacity-35')}>
      <kbd className="absolute left-1.5 top-1 font-mono text-[9.5px] font-bold opacity-75">{slotKey}{c.also === 'Escape' ? ' Esc' : ''}</kbd>
      {c.menu && <span className="absolute right-1.5 top-0.5 text-[11px] font-bold opacity-75" aria-hidden="true">›</span>}
      <FIcon name={c.icon} size={24} />
      {/* a label is shown whole: it wraps before it is ever cut */}
      <span className="max-w-full break-words text-center text-[11px] font-medium leading-[1.05]">{c.label}</span>
    </button>
  );
}

export function FactoryConsole({ view, snapshot, layout, selection, onSelect, menu, trail, onRun, title, hint, groups, onGroup, miniRef, lens, onLens, onFit, show, onShow, hidden = false, onHide, building = false }: {
  view: FactoryView | null; snapshot: FactorySnapshot | null; layout: FactoryLayout | null; selection: Selection; onSelect: (s: Selection) => void;
  /** The menu shown in the command card, the menus that lead to it, and what running one of its commands does. */
  menu: Menu; trail: string[]; onRun: (c: Command) => void;
  title: string; hint: string; groups: Selection[]; onGroup: (index: number, save: boolean) => void; miniRef: React.RefObject<HTMLCanvasElement | null>;
  lens: Lens; onLens: (lens: Lens) => void; onFit: () => void;
  /** What the floor shows on top of the machines, and the switch for each. */
  show: Show; onShow: (key: keyof Show) => void;
  /** The console is put away to give the floor the whole page; its handle stays, and the card's keys still work. */
  hidden?: boolean; onHide?: () => void;
  /** Build mode: with nothing selected, the portrait is the work site and not the factory. */
  building?: boolean;
}) {
  const boards = useTicketStore((s) => s.boards), keys = useKeyLabels();
  const stats = useFactoryStore((s) => s.stats), period = periodLabel(useFactoryStore((s) => s.statsDays)).toLowerCase();
  const personas = useAgentPersonaStore((s) => s.personas);
  /* the page gets a fresh copy of the layout at every poll: the view must read this one before it is asked about it */
  if (view && layout) view.use(layout);
  const down = useRef(false);
  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || !layout) return;
    const r = e.currentTarget.getBoundingClientRect(), w = view.miniToWorld(e.clientX - r.left, e.clientY - r.top);
    /* the view holds itself to the floor: it goes as near as it can */
    if (w) { view.cam.x = w.x; view.cam.y = w.y; }
  };
  const zoom = (f: number) => view?.zoomAt(view.w / 2, view.h / 2, f);
  const tickets = snapshot?.tickets ?? [], now = snapshot?.serverTime ?? '';
  const machine = selection && 'machine' in selection && layout ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const ticket = selection && 'ticket' in selection ? tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  const inside = machine ? tickets.filter((t) => t.machineId === machine.id).sort((a, b) => a.since.localeCompare(b.since)) : [];
  const waiting = tickets.filter((t) => needsHuman(t));
  const many = selection && 'machines' in selection ? selection.machines.length : 0;
  /* several tickets selected together: those of them still on the floor, longest there first */
  const picked = selection && 'tickets' in selection ? ((ids) => tickets.filter((t) => ids.has(t.ticketId)).sort((a, b) => a.since.localeCompare(b.since)))(new Set(selection.tickets)) : null;
  const box = 'rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)]';

  const pickedMachines = selection && 'machines' in selection && layout ? selection.machines.map((id) => layout.machines.find((m) => m.id === id)).filter((m): m is MachineSpec => !!m) : [];
  const ticketUnit = (t: FactoryTicket): Unit => ({ id: t.ticketId, face: <TicketToken info={t.info ? { ...t.info, favorite: false } : null} size={22} />, name: `#${t.info?.displayId ?? '?'} ${t.info?.title ?? ''}`.trim(), sub: `${view?.machine(t.machineId)?.name ?? ''} ${PHASE[t.phase]}`.trim(), mark: String(t.info?.displayId ?? ''), warn: !!needsHuman(t) });
  const machineUnit = (m: MachineSpec): Unit => ({ id: m.id, face: <FIcon name={machineIcon(m)} size={20} />, name: ('name' in m && m.name) || (m.kind === 'label' ? m.text : machineKind(m)), sub: machineKind(m) });
  const avatar: AvatarOf = ticket ? { kind: 'ticket', info: ticket.info } : machine ? { kind: 'machine', machine } : picked ? { kind: 'many', count: picked.length, of: 'tickets' } : many ? { kind: 'many', count: many, of: 'machines' } : building ? { kind: 'build' } : { kind: 'floor' };

  /* the handle: at the end of the notch over the middle; with the console hidden it is all that is left, at the foot of the floor */
  const handle = onHide && (
    <button type="button" onClick={onHide} aria-expanded={!hidden} aria-label={hidden ? 'Show the console' : 'Hide the console'} title={hidden ? 'Bring the console back (U)' : 'Hide the console and give the floor the whole page (U). The keys of the command card still work.'}
      className={cn('flex h-5 flex-none items-center gap-1 rounded-t-md border border-b-0 border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 text-[10px] font-medium uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]', hidden && 'absolute bottom-full left-1/2 z-10 -translate-x-1/2')}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={hidden ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
      {hidden && 'Console'}
      <kbd className="font-mono text-[var(--theme-text-faint)]">U</kbd>
    </button>
  );
  if (hidden) return <div className="relative h-0 flex-shrink-0" aria-label="Factory console">{handle}</div>;

  /*
   * The console is not a straight bar: the block of the minimap and the block of the command card stand taller than
   * the middle, their inner top corners cut, and the floor shows in the notch between them (`hudShape.ts`). The page
   * gives the console the height of its middle; the two side blocks rise over the foot of the floor.
   */
  return (
    <div className="relative flex-shrink-0" style={{ height: HUD.mid }} aria-label="Factory console">
      <Side side="left">
        <div className="flex h-full flex-col gap-1.5">
          <div className="flex flex-none items-center gap-2" style={{ paddingRight: HUD.cut - 6 }}>
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--theme-success)]" aria-hidden="true" /><Clock />
            <span className="ml-auto text-[10px] text-[var(--theme-text-faint)]">local time</span>
          </div>
          <div className="flex min-h-0 flex-1 gap-1.5">
            <div className="flex h-full min-w-0 flex-1 flex-col gap-1.5">
              {/* what the floor shows on top of the machines: each one on or off, black or yellow */}
              <div className="flex flex-none gap-1" role="group" aria-label="Show on the floor">
                {TOGGLES.map((t) => (
                  <button key={t.key} type="button" aria-pressed={show[t.key]} aria-label={t.label} title={`${t.title}: ${show[t.key] ? 'shown' : 'hidden'}`} onClick={() => onShow(t.key)}
                    className={cn('grid h-[26px] w-[30px] place-items-center rounded-md border transition-colors',
                      show[t.key] ? cn(YELLOW.solid, YELLOW.onSolid, 'border-transparent') : 'border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>
                    <FIcon name={t.icon} size={16} />
                  </button>
                ))}
              </div>
              <canvas ref={miniRef} className="min-h-0 w-full flex-1 cursor-crosshair touch-none rounded-md" aria-label="Minimap: click to go there"
              onPointerDown={(e) => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e) => { if (down.current) go(e); }} onPointerUp={() => { down.current = false; }} />
            </div>
            <div className="flex w-[104px] flex-col justify-between gap-1">
              {/* one layer at a time: a list, not commands */}
              <div className="flex flex-col rounded-md border border-[var(--theme-border-input)] p-0.5" role="radiogroup" aria-label="Layer">
                {LAYERS.map(([l, label, what]) => (
                  <button key={l} type="button" role="radio" aria-checked={lens === l} title={what} onClick={() => onLens(l)}
                    className={cn('rounded px-2 py-[2.5px] text-left text-[11px] font-medium', lens === l ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>{label}</button>
                ))}
              </div>
              <div className="flex rounded-md border border-[var(--theme-border-input)]" role="group" aria-label="Zoom">
                <button type="button" className="flex-1 py-0.5 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.4)}>−</button>
                <button type="button" className="flex-1 py-0.5 text-xs text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]" aria-label="Fit the floor" title="Fit the floor (F)" onClick={onFit}>⤢</button>
                <button type="button" className="flex-1 py-0.5 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.4)}>+</button>
              </div>
            </div>
          </div>

        </div>
      </Side>

      {/* in the notch: the saved selections at their ten places, and the handle that puts the console away */}
      <div className="absolute bottom-full z-10 flex items-end gap-2" style={{ left: HUD.left + 8, right: HUD.right + 8 }}>
        <Groups groups={groups} selection={selection} tickets={tickets} layout={layout} onGroup={onGroup} />
        {handle}
      </div>

      {/* the middle: what is selected, and its portrait against the command card */}
      <div className="@container absolute inset-y-0 flex gap-2 border-t border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-2" style={{ left: HUD.left, right: HUD.right }}>
        <div className={cn(box, 'flex min-w-0 flex-1 p-2')}>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
            {ticket ? (
              <>
                <div className="flex-none truncate text-sm font-semibold text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-xs font-normal text-[var(--theme-text-muted)]">#{ticket.info?.displayId ?? '?'}</span>{ticket.info?.title ?? ticket.ticketId}</div>
                <div className={cn('truncate text-xs', needsHuman(ticket) ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-secondary)]')}>{view?.machine(ticket.machineId)?.name ?? ''} {PHASE[ticket.phase]}{ticket.note ? ` · ${ticket.note}` : ''}</div>
                <TicketGlyphs info={ticket.info} words className="text-[11px] text-[var(--theme-text-secondary)]" />
                <div className="flex flex-wrap gap-x-3">
                  {ticket.info && <Stat label="board" value={boards.find((b) => b.id === ticket.info!.boardId)?.name ?? '?'} />}
                  <Stat label="status" value={ticket.info?.status ?? '?'} />
                  {now && <Stat label="here for" value={span(since(ticket.since, now))} />}
                  {now && ticket.handedAt && <Stat label="on the floor for" value={span(since(ticket.handedAt, now))} />}
                  {ticket.outcome && <Stat label="last outcome" value={ticket.outcome} />}
                </div>
                {ticket.info && ticket.info.tags.length > 0 && <div className="flex gap-1 overflow-hidden">{ticket.info.tags.slice(0, 6).map((tag) => <span key={tag} className="flex-none rounded border border-[var(--theme-border-input)] px-1 text-[10px] text-[var(--theme-text-secondary)]">{tag}</span>)}</div>}
              </>
            ) : machine && view ? (
              <>
                <div className="flex-none truncate text-sm font-semibold text-[var(--theme-text-primary)]">{machine.name || (machine.kind === 'label' ? machine.text : machine.kind)}</div>
                <div className="truncate text-xs text-[var(--theme-text-secondary)]">{machineSub(machine, view, (id) => boards.find((b) => b.id === id)?.name ?? 'a board')}</div>
                {(machine.kind === 'station' || machine.kind === 'zone') && (
                  <div className="flex flex-wrap gap-x-3" aria-label="Settings">
                    {machine.kind === 'station' && RUNS.includes(machine.exec) && <Stat label="switch" value={machine.off ? 'stopped' : 'running'} tone={machine.off ? 'danger' : 'success'} />}
                    {machine.kind === 'station' && machine.exec === 'agent' && <Stat label="model" value={machine.model || personas.find((q) => q.name === machine.ref)?.model || "the persona's own"} />}
                    {machine.kind === 'station' && machine.exec === 'agent' && <Stat label="mode" value={machine.mode ?? 'edit'} />}
                    <Stat label="inside" value={machine.kind === 'station' ? `${inside.length}/${machine.cap}` : inside.length} />
                    <Stat label="waiting for you" value={inside.filter((t) => needsHuman(t)).length} />
                    {machine.kind === 'station' && machine.exec !== 'native' && machine.exec !== 'human_gate' && <Stat label="outcomes" value={machine.outcomes.join(' / ')} />}
                    <Stat label="leaves by" value={`${view.takersOf(machine).length} arm(s)`} tone={view.takersOf(machine).length || (machine.kind === 'zone' && machine.inbound) ? undefined : 'danger'} />
                  </div>
                )}
                {machine.kind === 'station' && machine.exec !== 'native' && (stats ? <Did q={stats.machines.find((q) => q.machineId === machine.id) ?? null} gate={machine.exec === 'human_gate'} period={period} /> : null)}
                <Wire tickets={inside} onSelect={onSelect} />
              </>
            ) : picked ? (
              <>
                <div className="flex-none truncate text-sm font-semibold text-[var(--theme-text-primary)]">{picked.length} tickets selected</div>
                <div className="flex flex-wrap gap-x-3">
                  <Stat label="waiting for you" value={picked.filter((t) => needsHuman(t)).length} tone={picked.some((t) => needsHuman(t)) ? 'warning' : undefined} />
                  <Stat label="running" value={picked.filter((t) => t.phase === 'running').length} />
                  <Stat label="in a zone" value={picked.filter((t) => t.phase === 'zone').length} />
                  <Stat label="on their way" value={picked.filter((t) => t.phase === 'belt' || t.phase === 'arm').length} />
                </div>
                <Units units={picked.map(ticketUnit)} onPick={(id, shift) => onSelect(shift ? ticketsSel(picked.map((t) => t.ticketId).filter((q) => q !== id)) : { ticket: id })} />
              </>
            ) : (
              <>
                <div className="flex-none truncate text-sm font-semibold text-[var(--theme-text-primary)]">{many ? `${many} machines selected` : title}</div>
                <div className="line-clamp-2 flex-none text-xs text-[var(--theme-text-secondary)]" title={many ? undefined : hint}>{many ? 'Drag one of them to move them all. Delete removes them. Click one below to keep only it.' : hint}</div>
                <div className="flex flex-wrap gap-x-3"><Stat label="tickets" value={tickets.length} /><Stat label="running" value={`${snapshot?.running ?? 0}/${snapshot?.floor.settings.maxConcurrentRuns ?? 0}`} /><Stat label="runs this hour" value={`${snapshot?.runsLastHour ?? 0}/${snapshot?.floor.settings.maxRunsPerHour ?? 0}`} /><Stat label="waiting for you" value={waiting.length} tone={waiting.length ? 'warning' : undefined} /></div>
                {!many && stats && (
                  <div className="flex flex-wrap gap-x-3" aria-label="What the floor did">
                    <span className="text-[11px] text-[var(--theme-text-faint)]">{period}</span>
                    <Stat label="shipped" value={stats.totals.shipped} /><Stat label="lead time" value={span(stats.totals.avgLeadMs)} /><Stat label="runs" value={stats.totals.runs} />
                    <Stat label="failed" value={stats.totals.failed} tone={stats.totals.failed ? 'danger' : undefined} /><Stat label="cost" value={money(stats.totals.costUsd)} /><Stat label="human wait" value={span(stats.totals.humanMs)} />
                  </div>
                )}
                {many ? <Units units={pickedMachines.map(machineUnit)} onPick={(id, shift) => onSelect(shift ? machinesSel(pickedMachines.map((m) => m.id).filter((q) => q !== id)) : { machine: id })} /> : <Wire tickets={waiting} onSelect={onSelect} />}
              </>
            )}
          </div>
        </div>
        <FactoryAvatar of={avatar} className="hidden w-[132px] flex-none @[430px]:block" />
      </div>

      <Side side="right">
        {/* command card: five by three, one menu at a time; a command's key is its place on the keyboard */}
        <div className="flex h-full flex-col justify-end gap-1">
          <div className="flex items-baseline text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]" style={{ paddingLeft: HUD.cut - 6 }}>
            <span className="min-w-0 flex-1 truncate" aria-label="Menu">{trail.map((t, i) => <span key={i} className={i === trail.length - 1 ? 'font-semibold text-[var(--theme-text-primary)]' : undefined}>{i > 0 && <span className="mx-1" aria-hidden="true">›</span>}{t}</span>)}</span>
            <button type="button" onClick={keys.flip} aria-label={`Keyboard: ${keys.name}`} title={`The keys of the card follow your keyboard, read as ${keys.name}${keys.forced ? ' because you said so' : ''}. Click ${keys.forced ? 'to let Fleex find out again' : 'if it is the other one'}.`}
              className={cn('flex-none rounded px-1 font-mono text-[9px] hover:text-[var(--theme-text-primary)]', keys.forced && 'text-[var(--theme-text-secondary)] underline')}>{keys.name}</button>
          </div>
          <div className="grid grid-cols-5 gap-1.5" role="toolbar" aria-label="Factory commands">
            {Array.from({ length: SLOTS }, (_, i) => {
              const c = menu.slots[i];
              return c ? <Tile key={`${i}-${c.id}`} c={c} slotKey={keys.labels[i] ?? ''} onRun={onRun} /> : <span key={i} className="h-[62px] w-[68px] rounded-lg border border-dashed border-[var(--theme-border)] opacity-40" />;
            })}
          </div>
        </div>
      </Side>
    </div>
  );
}
