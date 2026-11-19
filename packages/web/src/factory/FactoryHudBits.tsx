/**
 * Pieces of the console: the clock over the minimap, the saved selections in the notch over its middle, and the
 * selected things as one icon each.
 */
import { useEffect, useState } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { cn } from '../lib/cn';
import { FIcon } from './icons';
import { machineIcon, machineKind } from './FactoryMachinePopup';
import { TicketToken, typeLabel } from './FactoryTicketMeta';
import { machineIds, ticketIds } from './pick';
import type { FactoryLayout, FactoryTicket, MachineSpec, Selection } from './types';

/** The time it is, to the second: a floor that runs by itself is watched over hours. */
export function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  return <time dateTime={now.toISOString()} className={cn('font-mono text-[13px] font-bold tracking-wider text-[var(--theme-text-primary)]', className)} aria-label="Local time">{clockText(now)}</time>;
}
export const clockText = (d: Date): string => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

/** Two lines for a tooltip: what it is, and something about it. */
const Tip = ({ name, lines, foot }: { name: string; lines: string[]; foot?: string }) => (
  <span className="flex flex-col gap-1 py-0.5 text-left leading-none">
    <b className="font-semibold">{name}</b>
    {lines.map((l, i) => <span key={i} className="font-normal text-[var(--theme-text-secondary)]">{l}</span>)}
    {foot && <span className="pt-0.5 text-[10px] font-normal text-[var(--theme-text-muted)]">{foot}</span>}
  </span>
);

/** How many selected things the centre shows at once: three rows of eight. More come as pages. */
export const UNITS_PAGE = 24;
export interface Unit {
  id: string; face: React.ReactNode;
  /** What the tooltip says: its name, and a line about it. */
  name: string; sub: string;
  /** A small figure in its corner (a ticket's number), and whether it waits for someone. */
  mark?: string; warn?: boolean;
}
/**
 * The things selected together, one icon each. Pointing at one says what it is; a click keeps only it, Shift and a
 * click take it out of the selection.
 */
export function Units({ units, onPick }: { units: Unit[]; onPick: (id: string, shift: boolean) => void }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(units.length / UNITS_PAGE)), at = Math.min(page, pages - 1);
  return (
    <div className="flex min-h-0 items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-8 gap-1" role="group" aria-label="Selected">
        {units.slice(at * UNITS_PAGE, (at + 1) * UNITS_PAGE).map((u) => (
          <Tooltip key={u.id} placement="top" label={<Tip name={u.name} lines={[u.sub]} foot="Click: only it · Shift+click: take it out" />}>
            <button type="button" aria-label={u.name} onClick={(e) => onPick(u.id, e.shiftKey)}
              className={cn('relative grid aspect-square w-full max-w-[36px] place-items-center rounded-md border bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)]', u.warn ? 'border-[var(--theme-warning)]' : 'border-[var(--theme-border-input)] hover:border-[var(--theme-text-primary)]')}>
              {u.face}
              {u.mark && <span className="absolute bottom-px right-0.5 font-mono text-[8px] leading-none text-[var(--theme-text-muted)]">{u.mark}</span>}
            </button>
          </Tooltip>
        ))}
      </div>
      {pages > 1 && (
        <div className="flex flex-none flex-col gap-1" role="group" aria-label="Pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" aria-pressed={i === at} aria-label={`Page ${i + 1} of ${pages}`} onClick={() => setPage(i)}
              className={cn('h-5 w-6 rounded border font-mono text-[10px]', i === at ? 'border-transparent bg-[var(--theme-text-primary)] text-[var(--theme-bg-base)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>{i + 1}</button>
          ))}
        </div>
      )}
    </div>
  );
}

const ticketName = (t: FactoryTicket) => `#${t.info?.displayId ?? '?'} ${t.info?.title ?? ''}`.trim();
const machineName = (m: MachineSpec) => ('name' in m && m.name) || (m.kind === 'label' ? m.text : machineKind(m));

/**
 * The saved selections, as in a strategy game: ten places that never move, over the middle of the console. A place
 * shows only once something is saved in it, and is always the same size: its key, an icon, and a ticket's number or
 * how many things it holds. Pointing at one says what it holds.
 */
export function Groups({ groups, selection, tickets, layout, onGroup }: {
  groups: Selection[]; selection: Selection; tickets: FactoryTicket[]; layout: FactoryLayout | null; onGroup: (index: number, save: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 60px))` }} role="group" aria-label="Saved selections">
      {groups.map((g, i) => {
        const key = (i + 1) % 10;
        if (!g) return <span key={i} aria-hidden="true" />;
        const ts = ticketIds(g).map((id) => tickets.find((t) => t.ticketId === id)).filter((t): t is FactoryTicket => !!t);
        const ms = machineIds(g).map((id) => layout?.machines.find((m) => m.id === id)).filter((m): m is MachineSpec => !!m);
        const n = ts.length + ms.length, of = ticketIds(g).length ? 'tickets' : 'machines';
        const names = [...ts.map(ticketName), ...ms.map(machineName)];
        const tip = n === 0 ? <Tip name="Nothing left" lines={[`What was saved here is no longer on the floor`]} foot={`Shift+${key} replaces`} />
          : n === 1 ? <Tip name={names[0]!} lines={[ts[0] ? typeLabel(ts[0].info) : machineKind(ms[0]!)]} foot={`${key} selects, again goes there · Shift+${key} replaces`} />
          : <Tip name={`${n} ${of}`} lines={[...names.slice(0, 4), ...(n > 4 ? [`and ${n - 4} more`] : [])]} foot={`${key} selects, again goes there · Shift+${key} replaces`} />;
        return (
          <Tooltip key={i} placement="top" label={tip}>
            <button type="button" onClick={(e) => onGroup(i, e.shiftKey)} aria-label={`Group ${key}: ${n === 1 ? names[0] : `${n} ${of}`}`}
              className={cn('relative flex h-7 min-w-0 items-center gap-[3px] overflow-hidden rounded-t-md border border-b-0 bg-[var(--theme-bg-surface)] pl-[9px] pr-1 text-[var(--theme-text-secondary)]',
                JSON.stringify(g) === JSON.stringify(selection) ? 'border-[var(--theme-text-primary)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]')}>
              <kbd className="absolute left-[2px] top-[2px] font-mono text-[8px] font-bold leading-none text-[var(--theme-text-muted)]">{key}</kbd>
              <span className="grid flex-none place-items-center">{ts[0] ? <TicketToken info={ts[0].info ? { ...ts[0].info, favorite: false } : null} size={16} /> : ms[0] ? <FIcon name={machineIcon(ms[0])} size={15} /> : <FIcon name="stack" size={15} />}</span>
              <b className="min-w-0 overflow-hidden whitespace-nowrap font-mono text-[9.5px] font-bold text-[var(--theme-text-primary)]">{n > 1 ? `×${n}` : ts[0] ? `${ts[0].info?.displayId ?? '?'}` : n === 0 ? '–' : ''}</b>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
