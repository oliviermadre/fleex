import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { MachineFigures, PeriodSelect } from './FactoryStatsBits';
import { since, span } from './format';
import { FIcon } from './icons';
import { TicketGlyphs, TicketSquare } from './FactoryTicketMeta';
import { needsHuman, type FactoryRun, type FactoryTicket, type MachineSpec } from './types';

const REFRESH_MS = 4000;
const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'queueing to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'run failed', out: 'done, waiting for an arm', zone: 'waiting',
};
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const kindOf = (m: MachineSpec): string => (m.kind === 'station' ? (m.exec === 'human_gate' ? `Gate · ${m.outcomes.join(' / ')}` : m.exec === 'native' ? `Sets status ${m.sets ?? ''}` : `${m.exec} · ${m.ref || 'nothing chosen yet'}`)
  : m.kind === 'zone' ? (m.inbound ? 'Inbound · tickets handed over land here' : `Zone${m.status ? ` · sets ${m.status}` : ''} · leaves ${m.release === 'auto' ? 'automatically' : 'when released'}`) : m.kind);

/**
 * Everything a station or a zone holds, in one window: each ticket, what it
 * waits for and since when, with the action it needs; and what the machine did
 * lately. The side panel shows a machine; this shows its content.
 */
export function FactoryMachineModal({ machineId, onClose, onOpenTicket }: { machineId: string; onClose: () => void; onOpenTicket: (ticketId: string) => void }) {
  const store = useFactoryStore();
  const machine = store.layout?.machines.find((m) => m.id === machineId) ?? null;
  const known = useTicketStore((s) => s.tickets);
  const [runs, setRuns] = useState<FactoryRun[] | null>(null);
  const [q, setQ] = useState('');
  const now = store.snapshot?.serverTime ?? new Date().toISOString();
  const isStation = machine?.kind === 'station', gate = isStation && machine.exec === 'human_gate';

  useEffect(() => {
    if (!isStation) return;
    let live = true;
    const load = () => { factoryApi.machineRuns(machineId).then((r) => { if (live) setRuns(r); }).catch(() => { if (live) setRuns((cur) => cur ?? []); }); };
    load();
    const id = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(id); };
  }, [machineId, isStation]);
  useEffect(() => { if (!useFactoryStore.getState().stats) void useFactoryStore.getState().loadStats(); }, []);
  useEffect(() => { if (!machine) onClose(); }, [machine, onClose]);

  const inside = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (store.snapshot?.tickets ?? []).filter((t) => t.machineId === machineId)
      .filter((t) => !needle || (t.info?.title ?? '').toLowerCase().includes(needle) || String(t.info?.displayId ?? '').includes(needle))
      .sort((a, b) => a.since.localeCompare(b.since));
  }, [store.snapshot, machineId, q]);
  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of known) m.set(t.id, `#${t.displayId} ${t.title}`);
    for (const t of store.snapshot?.tickets ?? []) if (t.info) m.set(t.ticketId, `#${t.info.displayId} ${t.info.title}`);
    return m;
  }, [known, store.snapshot]);
  if (!machine) return null;

  const figures = store.stats?.machines.find((m) => m.machineId === machineId) ?? null;
  const held = inside.filter((t) => t.phase === 'zone' && !t.released);
  const total = (store.snapshot?.tickets ?? []).filter((t) => t.machineId === machineId).length;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-6xl">
      <div className="flex h-[84vh] flex-col">
        <div className="flex flex-none items-start gap-3 border-b border-[var(--theme-border)] pb-3">
          <span className="mt-0.5 text-[var(--theme-text-secondary)]"><FIcon name={isStation ? (gate ? 'gate' : machine.exec) : machine.kind === 'zone' && machine.inbound ? 'inbound' : machine.kind} size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-[var(--theme-text-primary)]">{machine.name || (isStation ? 'Station' : 'Zone')}</div>
            <div className="text-xs text-[var(--theme-text-secondary)]">{kindOf(machine)} · {total} ticket{total === 1 ? '' : 's'} inside{isStation ? ` of ${machine.cap}` : ''}</div>
          </div>
          {held.length > 1 && <Button size="sm" variant="primary" onClick={() => { for (const t of held) void store.release(t.ticketId); }}>Release all {held.length}</Button>}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-4 pt-3', isStation && 'md:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]')}>
          <div className="flex min-h-0 flex-col gap-2">
            <Input id="factory-machine-search" placeholder="Filter by title or number" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {inside.length === 0 && <div className="py-10 text-center text-xs text-[var(--theme-text-muted)]">{total === 0 ? 'Nothing here right now.' : 'No ticket matches.'}</div>}
              <ul className="flex flex-col gap-1">
                {inside.map((t) => {
                  const why = needsHuman(t), age = since(t.since, now);
                  return (
                    <li key={t.ticketId} className="flex items-center gap-2 rounded-md border border-[var(--theme-border)] px-2 py-1.5">
                      <TicketSquare info={t.info} size={22} />
                      <button type="button" onClick={() => onOpenTicket(t.ticketId)} className="min-w-0 flex-1 text-left" title="Open the ticket">
                        <div className="truncate text-xs font-medium text-[var(--theme-text-primary)] hover:underline"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>{t.info?.title ?? t.ticketId}</div>
                        <div className={cn('truncate text-[11px]', why ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>
                          {t.phase === 'zone' && t.released ? 'released, waiting for an arm' : PHASE[t.phase]}{t.outcome ? ` · ${t.outcome}` : ''}{t.info?.priority ? ` · ${t.info.priority}` : ''}{t.note ? ` · ${t.note}` : ''}
                        </div>
                      </button>
                      <TicketGlyphs info={t.info ? { ...t.info, favorite: false } : null} />
                      <span className="flex-none font-mono text-[11px] text-[var(--theme-text-secondary)]" title={`Here since ${when(t.since)}`}>{span(age)}</span>
                      <span className="flex flex-none gap-1">
                        {t.phase === 'review' && isStation && machine.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => store.resolve(t.ticketId, o)}>{o}</Button>)}
                        {t.phase === 'zone' && !t.released && <Button size="sm" variant="primary" onClick={() => store.release(t.ticketId)}>Release</Button>}
                        {(t.phase === 'failed' || t.phase === 'question') && <Button size="sm" variant={t.phase === 'failed' ? 'primary' : 'secondary'} onClick={() => (t.phase === 'question' ? onOpenTicket(t.ticketId) : store.retry(t.ticketId))}>{t.phase === 'question' ? 'Answer' : 'Run again'}</Button>}
                        <Button size="sm" variant="ghost" onClick={() => store.giveBack(t.ticketId)} title="Take this ticket out of the Factory">Give back</Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {isStation && (
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto md:border-l md:border-[var(--theme-border)] md:pl-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">What it did</h3>
                <PeriodSelect id="factory-machine-period" />
              </div>
              {store.stats ? <MachineFigures m={figures} gate={gate} /> : <p className="text-xs text-[var(--theme-text-muted)]">Loading…</p>}
              <h3 className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Latest {gate ? 'decisions' : 'runs'}</h3>
              {runs === null ? <p className="text-xs text-[var(--theme-text-muted)]">Loading…</p> : runs.length === 0 ? <p className="text-xs text-[var(--theme-text-muted)]">None yet.</p> : (
                <ol className="flex flex-col">
                  {runs.map((r) => (
                    <li key={r.id} className="border-t border-[var(--theme-border)] py-1.5 first:border-t-0">
                      <button type="button" onClick={() => onOpenTicket(r.ticketId)} className="flex w-full items-baseline gap-2 text-left text-xs">
                        <span className={cn('h-2 w-2 flex-none rounded-full', r.status === 'failed' || r.status === 'interrupted' ? 'bg-[var(--theme-danger)]' : r.status === 'running' ? 'bg-[var(--theme-success)]' : r.status === 'completed' ? 'bg-[var(--theme-text-muted)]' : 'bg-[var(--theme-warning)]')} />
                        <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)] hover:underline">{titles.get(r.ticketId) ?? r.ticketId.slice(0, 8)}</span>
                        <span className="flex-none font-mono text-[var(--theme-text-secondary)]">{r.outcome ?? (r.status === 'needs_review' ? 'waiting' : r.status)}</span>
                        <span className="flex-none font-mono text-[var(--theme-text-muted)]">{r.finishedAt ? span(since(r.startedAt, r.finishedAt)) : span(since(r.startedAt, now))}</span>
                      </button>
                      <div className="pl-4 text-[11px] text-[var(--theme-text-muted)]">{when(r.startedAt)}{r.error ? <span className="text-[var(--theme-danger)]"> · {r.error}</span> : null}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
