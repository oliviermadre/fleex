import { useRef } from 'react';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { FIcon } from './icons';
import type { Selection } from './FactoryInspector';
import { useTicketStore } from '../stores/ticketStore';
import { since, span } from './format';
import { TicketGlyphs, TicketSquare } from './FactoryTicketMeta';
import { LENS_LABEL } from './lens';
import { TYPE_COLORS, type FactoryView } from './renderer';
import { needsHuman, type FactoryLayout, type FactorySnapshot, type FactoryTicket, type Lens, type MachineSpec } from './types';

export interface Command {
  /** The key that runs it. Empty when it only has a chord, shown through `keyText`. */
  key: string; label: string; icon: string; run: () => void; primary?: boolean; active?: boolean; danger?: boolean; disabled?: boolean; title?: string;
  /** What to print as its shortcut when it is not a single key (Ctrl+C…). */
  keyText?: string;
}

/** The layers of the floor, in the order they are listed next to the minimap. */
const LAYERS: [Lens, string, string][] = [
  ['none', 'Floor', 'The floor as it is'],
  ['load', LENS_LABEL.load, 'Where tickets stand right now, and for how long'],
  ['cost', LENS_LABEL.cost, 'What each station spent on agent runs'],
  ['time', LENS_LABEL.time, 'How long a run takes in each station'],
  ['human', LENS_LABEL.human, 'Where tickets wait for a human, and for how long'],
];

const SLOTS = 18;
const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'waiting to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'run failed', out: 'done, waiting for an arm', zone: 'in a zone',
};
const keyLabel = (k: string) => (k === 'Escape' ? 'Esc' : k === 'Delete' ? 'Del' : k);

function machineIcon(m: MachineSpec): string {
  if (m.kind === 'station') return m.exec === 'human_gate' ? 'gate' : m.exec;
  return m.kind === 'zone' && m.inbound ? 'inbound' : m.kind;
}
function machineSub(m: MachineSpec, view: FactoryView): string {
  if (m.kind === 'belt') { const d = view.leadsTo(m); return `Belt · ${d ? `leads to ${d.name ?? d.kind}` : 'leads nowhere'}`; }
  if (m.kind === 'arm') return `Arm · ${m.filter?.values.length ? `only takes ${m.filter.field} ${m.filter.values.join(', ')}` : 'takes anything'}`;
  if (m.kind === 'station') return m.exec === 'human_gate' ? `Gate · ${m.outcomes.join(' / ')}` : m.exec === 'native' ? `Sets status ${m.sets ?? ''}` : `${m.exec} · ${m.ref || 'nothing chosen yet'}`;
  if (m.kind === 'zone') return m.inbound ? 'Inbound · tickets handed over land here' : `Zone${m.status ? ` · ${m.status}` : ''} · leaves ${m.release === 'auto' ? 'automatically' : 'when released'}`;
  if (m.kind === 'exit') return 'Exit · sets done and hands the ticket back to Fleex';
  if (m.kind === 'bridge') return 'Bridge · two belts cross here without mixing';
  return 'Label';
}
const Stat = ({ label, value }: { label: string; value: string | number }) => <span className="text-[11px] text-[var(--theme-text-muted)]">{label} <b className="font-mono font-medium text-[var(--theme-text-primary)]">{value}</b></span>;

/** The tickets a machine holds, as small squares: click one to select it. */
function Wire({ tickets, onSelect }: { tickets: FactoryTicket[]; onSelect: (s: Selection) => void }) {
  if (tickets.length === 0) return null;
  return (
    <div className="flex max-h-[42px] flex-wrap gap-[3px] overflow-hidden">
      {tickets.slice(0, 40).map((t) => (
        <button key={t.ticketId} type="button" onClick={() => onSelect({ ticket: t.ticketId })} title={`#${t.info?.displayId ?? '?'} ${t.info?.title ?? ''} · ${PHASE[t.phase]}`}
          aria-label={`Ticket ${t.info?.displayId ?? ''}`} className={cn('h-[18px] w-[18px] flex-none rounded-[5px] border-2', needsHuman(t) ? 'border-[var(--theme-warning)]' : 'border-[var(--theme-bg-base)]')}
          style={{ background: TYPE_COLORS[t.info?.type ?? ''] ?? '#8b949e' }} />
      ))}
      {tickets.length > 40 && <span className="self-center pl-1 font-mono text-[10px] text-[var(--theme-text-muted)]">+{tickets.length - 40}</span>}
    </div>
  );
}

export function FactoryConsole({ view, snapshot, layout, selection, onSelect, commands, title, hint, groups, onGroup, miniRef, lens, onLens, onFit }: {
  view: FactoryView | null; snapshot: FactorySnapshot | null; layout: FactoryLayout | null; selection: Selection; onSelect: (s: Selection) => void;
  commands: Command[]; title: string; hint: string; groups: Selection[]; onGroup: (index: number, save: boolean) => void; miniRef: React.RefObject<HTMLCanvasElement | null>;
  lens: Lens; onLens: (lens: Lens) => void; onFit: () => void;
}) {
  const boards = useTicketStore((s) => s.boards);
  const down = useRef(false);
  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || !layout) return;
    const r = e.currentTarget.getBoundingClientRect(), w = view.miniToWorld(e.clientX - r.left, e.clientY - r.top);
    if (w) { view.cam.x = Math.max(0, Math.min(layout.w, w.x)); view.cam.y = Math.max(0, Math.min(layout.h, w.y)); }
  };
  const zoom = (f: number) => view?.zoomAt(view.w / 2, view.h / 2, f);
  const tickets = snapshot?.tickets ?? [], now = snapshot?.serverTime ?? '';
  const machine = selection && 'machine' in selection && layout ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const ticket = selection && 'ticket' in selection ? tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  const inside = machine ? tickets.filter((t) => t.machineId === machine.id).sort((a, b) => a.since.localeCompare(b.since)) : [];
  const waiting = tickets.filter((t) => needsHuman(t));
  const many = selection && 'machines' in selection ? selection.machines.length : 0;
  const groupName = (g: Selection): string => {
    if (!g) return '';
    if ('machines' in g) return `${g.machines.length} machines`;
    if ('ticket' in g) { const t = tickets.find((q) => q.ticketId === g.ticket); return t ? `#${t.info?.displayId ?? '?'}` : 'gone'; }
    const m = layout?.machines.find((q) => q.id === g.machine); return m ? m.name || m.kind : 'gone';
  };
  const box = 'rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)]';

  return (
    <div className="flex h-[176px] flex-shrink-0 gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2" aria-label="Factory console">
      {/* minimap */}
      <div className={cn(box, 'flex flex-none gap-1.5 p-1.5')}>
        <canvas ref={miniRef} className="h-full w-[200px] cursor-crosshair touch-none rounded-md" aria-label="Minimap: click to go there"
          onPointerDown={(e) => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e) => { if (down.current) go(e); }} onPointerUp={() => { down.current = false; }} />
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

      {/* selection */}
      <div className={cn(box, 'flex min-w-0 flex-1 flex-col gap-1.5 p-2')}>
        <div className="flex flex-none gap-1.5 overflow-hidden" aria-label="Saved selections">
          {groups.map((g, i) => (
            <button key={i} type="button" onClick={(e) => onGroup(i, e.shiftKey || !g)} title={g ? `${(i + 1) % 10}: recall · Shift+${(i + 1) % 10}: replace` : `Shift+${(i + 1) % 10}: save the selection here`}
              className={cn('flex h-6 flex-none items-center gap-1.5 rounded-md border px-1.5 text-[11px]', g ? 'border-[var(--theme-border-input)] text-[var(--theme-text-primary)]' : 'border-dashed border-[var(--theme-border)] text-[var(--theme-text-faint)]',
                g && JSON.stringify(g) === JSON.stringify(selection) && 'border-[var(--theme-text-primary)]')}>
              <span className="font-mono text-[10px] text-[var(--theme-text-muted)]">{(i + 1) % 10}</span>{g && <span className="max-w-[72px] truncate">{groupName(g)}</span>}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 gap-2.5 border-t border-[var(--theme-border)] pt-2">
          <div className={cn('grid h-[58px] w-[58px] flex-none place-items-center rounded-lg border-2 bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)]',
            ticket && needsHuman(ticket) ? 'border-[var(--theme-warning)]' : 'border-[var(--theme-border-input)]')}>
            {ticket ? <TicketSquare info={ticket.info} size={34} /> : <FIcon name={machine ? machineIcon(machine) : 'floor'} size={30} />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {ticket ? (
              <>
                <div className="truncate text-sm font-semibold text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-xs font-normal text-[var(--theme-text-muted)]">#{ticket.info?.displayId ?? '?'}</span>{ticket.info?.title ?? ticket.ticketId}</div>
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
                <div className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{machine.name || (machine.kind === 'label' ? machine.text : machine.kind)}</div>
                <div className="truncate text-xs text-[var(--theme-text-secondary)]">{machineSub(machine, view)}</div>
                {(machine.kind === 'station' || machine.kind === 'zone') && (
                  <div className="flex flex-wrap gap-x-3"><Stat label="inside" value={machine.kind === 'station' ? `${inside.length}/${machine.cap}` : inside.length} /><Stat label="waiting for you" value={inside.filter((t) => needsHuman(t)).length} /><Stat label="leaves by" value={`${view.takersOf(machine).length} arm(s)`} /></div>
                )}
                <Wire tickets={inside} onSelect={onSelect} />
              </>
            ) : (
              <>
                <div className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{many ? `${many} machines selected` : title}</div>
                <div className="line-clamp-2 text-xs text-[var(--theme-text-secondary)]">{many ? 'Drag one of them to move them all. Delete removes them.' : hint}</div>
                <div className="flex flex-wrap gap-x-3"><Stat label="tickets" value={tickets.length} /><Stat label="running" value={snapshot?.running ?? 0} /><Stat label="runs this hour" value={`${snapshot?.runsLastHour ?? 0}/${snapshot?.floor.settings.maxRunsPerHour ?? 0}`} /><Stat label="waiting for you" value={waiting.length} /></div>
                <Wire tickets={waiting} onSelect={onSelect} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* command card */}
      <div className={cn(box, 'flex flex-none flex-col gap-1 p-1.5')}>
        <div className="max-w-[366px] truncate text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">{many ? `${many} machines` : ticket ? `#${ticket.info?.displayId ?? '?'}` : machine ? machine.name || machine.kind : title}</div>
        <div className="grid grid-cols-6 gap-1" role="toolbar" aria-label="Factory commands">
          {Array.from({ length: SLOTS }, (_, i) => {
            const c = commands[i];
            if (!c) return <span key={i} className="h-[44px] w-[58px] rounded-md border border-dashed border-[var(--theme-border)] opacity-50" />;
            return (
              <Button key={i} size="sm" variant={c.primary ? 'primary' : c.danger ? 'danger' : 'secondary'} disabled={c.disabled} onClick={c.run} aria-pressed={c.active}
                title={`${c.title ?? c.label} (${c.keyText ?? keyLabel(c.key)})`} className={cn('relative h-[44px] w-[58px] flex-col justify-end gap-0 px-0.5 pb-[3px] pt-0', c.active && 'ring-2 ring-[var(--theme-accent)]')}>
                <kbd className="absolute left-1 top-0.5 font-mono text-[8.5px] font-bold opacity-80">{c.keyText ?? keyLabel(c.key)}</kbd>
                <FIcon name={c.icon} size={17} />
                <span className="max-w-full truncate text-[9px] leading-tight">{c.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
