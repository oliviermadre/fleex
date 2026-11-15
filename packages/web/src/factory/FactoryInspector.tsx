import { useEffect, useState } from 'react';
import type { TicketStatus } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useSkillStore } from '../stores/skillStore';
import { usePanelStore } from '../stores/panelStore';
import { openTicketInWork } from '../components/work/openInWork';
import { tint } from '../lib/tints';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { armTag, type FactoryView } from './renderer';
import { MachineFigures, PeriodSelect, Tile } from './FactoryStatsBits';
import { money, span } from './format';
import { LENS_LABEL, standing } from './lens';
import { byRunAt, needsHuman, QUESTION_OUTCOME, type ArmFilterField, type Lens, type FactoryRun, type FactoryTicket, type MachineSpec, type StationExec, type StationSpec } from './types';

export type Selection = { machine: string } | { machines: string[] } | { ticket: string } | null;

/** Colours a label can take on the floor. */
export const LABEL_COLORS = ['#a1a1aa', '#c084fc', '#60a5fa', '#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#f87171'];

const STATUS_OPTIONS = [{ value: '', label: 'none' }, ...(['backlog', 'todo', 'doing', 'reviewing'] as TicketStatus[]).map((s) => ({ value: s, label: s }))];
const PHASE_LABEL: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'waiting to run', running: 'running', review: 'waiting for a decision',
  question: 'agent asked a question', failed: 'run failed', out: 'done, waiting for an arm', zone: 'in a zone',
};

/** A text field that saves when you leave it or press Enter, not on every keystroke. */
function CommitInput({ id, label, value, onCommit, placeholder }: { id: string; label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input id={id} label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-2 border-t border-[var(--theme-border)] pt-3">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{title}</div>
    {children}
  </div>
);
const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-[var(--theme-text-muted)]">{children}</p>;
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function TicketRow({ t, onSelect }: { t: FactoryTicket; onSelect: () => void }) {
  const why = needsHuman(t);
  return (
    <button type="button" onClick={onSelect} className="flex w-full flex-col rounded-md border border-[var(--theme-border)] px-2 py-1.5 text-left hover:bg-[var(--theme-bg-overlay)]">
      <span className="truncate text-xs font-medium text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>{t.info?.title ?? t.ticketId}</span>
      <span className={cn('text-[11px]', why ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{PHASE_LABEL[t.phase]}{t.outcome ? ` · ${t.outcome}` : ''}</span>
    </button>
  );
}

function TicketActions({ t, machine }: { t: FactoryTicket; machine: MachineSpec | null }) {
  const store = useFactoryStore();
  return (
    <div className="flex flex-wrap gap-1.5">
      {t.phase === 'review' && machine?.kind === 'station' && machine.outcomes.map((o, i) => (
        <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => store.resolve(t.ticketId, o)}>{o}</Button>
      ))}
      {t.phase === 'zone' && !t.released && <Button size="sm" variant="primary" onClick={() => store.release(t.ticketId)}>Release</Button>}
      {(t.phase === 'failed' || t.phase === 'question') && <Button size="sm" variant="primary" onClick={() => store.retry(t.ticketId)}>Run again</Button>}
      <Button size="sm" onClick={() => openTicketInWork(t.ticketId)}>Open ticket</Button>
      <Button size="sm" variant="ghost" onClick={() => store.giveBack(t.ticketId)}>Give back to Fleex</Button>
    </div>
  );
}

function TicketPanel({ t, view }: { t: FactoryTicket; view: FactoryView }) {
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  useEffect(() => { let live = true; factoryApi.runs(t.ticketId).then((r) => { if (live) setRuns([...r].sort(byRunAt)); }).catch(() => {}); return () => { live = false; }; }, [t.ticketId, t.phase, t.machineId]);
  const machine = view.machine(t.machineId);
  return (
    <>
      <div>
        <div className="font-mono text-xs text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'} · {t.info?.status ?? ''} · {t.info?.type || 'no type'} · {t.info?.priority || 'no priority'}</div>
        <div className="text-sm font-semibold text-[var(--theme-text-primary)]">{t.info?.title ?? t.ticketId}</div>
        <div className="mt-1 text-xs text-[var(--theme-text-secondary)]">{machine ? `${machine.name || machine.kind} · ` : ''}{PHASE_LABEL[t.phase]}{t.outcome ? ` · outcome “${t.outcome}”` : ''}</div>
        {t.note && <div className="mt-1 text-xs text-[var(--theme-warning)]">{t.note}</div>}
      </div>
      <div className={cn('rounded-md px-2 py-1.5 text-xs', tint('green'))}>
        <b>Managed by the Factory.</b> Its status and agent runs are driven from this floor. Give it back to handle it the usual way.
      </div>
      <TicketActions t={t} machine={machine} />
      {t.phase === 'question' && <Hint>Open the ticket (V, or double-click it) to answer: the station runs again with your answer.</Hint>}
      <Section title="Station runs">
        {runs.length === 0 && <Hint>No station has run on this ticket yet.</Hint>}
        {runs.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-[var(--theme-text-primary)]">{r.machineName} <span className="text-[var(--theme-text-muted)]">{r.executor}</span></span>
            <span className={cn('flex-shrink-0 font-mono', r.status === 'failed' || r.status === 'interrupted' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-secondary)]')}>{r.outcome ?? r.status}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

function MachinePanel({ m, view, tickets, onPatch, onRemove, onSelect, onOpen, building }: {
  m: MachineSpec; view: FactoryView; tickets: FactoryTicket[]; onPatch: (patch: Partial<MachineSpec>) => void; onRemove: () => void; onSelect: (s: Selection) => void; onOpen: () => void; building: boolean;
}) {
  const stats = useFactoryStore((s) => s.stats);
  const personas = useAgentPersonaStore((s) => s.personas), skills = useSkillStore((s) => s.skills), panels = usePanelStore((s) => s.panels);
  const inside = tickets.filter((t) => t.machineId === m.id);
  const takers = view.takersOf(m);
  const refs = (exec: StationExec) => (exec === 'agent' ? personas.map((p) => p.name) : exec === 'skill' ? skills.map((s) => s.commandName) : exec === 'panel' ? panels.map((p) => p.name) : []);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold capitalize text-[var(--theme-text-primary)]">{m.kind === 'station' ? (m.exec === 'human_gate' ? 'Gate' : m.exec === 'native' ? 'Status' : `${m.exec} station`) : m.kind}</div>
        <Button size="sm" variant="ghost" onClick={onRemove} title="Remove from the floor (Delete)">Remove</Button>
      </div>
      {!building && <Hint>Press B to build: machines can then be dragged.</Hint>}
      {m.kind === 'belt' && <Hint>One tile, one ticket. It pushes it to the tile it points at when that tile is free. Leads to: {view.leadsTo(m)?.name ?? 'nowhere'}.</Hint>}
      {m.kind === 'label' && (
        <>
          <CommitInput id="f-text" label="Text" value={m.text} onCommit={(v) => onPatch({ text: v || 'Zone' })} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Colour</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Label colour">
              {LABEL_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={(m.color ?? LABEL_COLORS[0]) === c} aria-label={`Colour ${c}`} onClick={() => onPatch({ color: c })}
                  className={cn('h-6 w-6 rounded-full border-2', (m.color ?? LABEL_COLORS[0]) === c ? 'border-[var(--theme-text-primary)]' : 'border-transparent')} style={{ background: c }} />
              ))}
            </div>
          </div>
        </>
      )}
      {m.kind === 'bridge' && <Hint>Where two belts cross. A ticket that enters keeps going straight, so an east-west line and a north-south line pass over each other without mixing.</Hint>}
      {(m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit') && <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />}

      {m.kind === 'arm' && (
        <>
          <Hint>Takes a ticket from the tile behind it and drops it on the tile in front, if that one is free. Leads to: {view.leadsTo(view.at(m.x + [1, 0, -1, 0][m.dir]!, m.y + [0, 1, 0, -1][m.dir]!))?.name ?? 'the next tile'}.</Hint>
          <Select id="f-field" label="Only takes" value={m.filter?.field ?? ''} onChange={(e) => onPatch({ filter: e.target.value ? { field: e.target.value as ArmFilterField, values: m.filter?.values ?? [] } : null })}
            options={[{ value: '', label: 'anything (or what filtered arms leave)' }, { value: 'type', label: 'some ticket types' }, { value: 'priority', label: 'some priorities' }, { value: 'tag', label: 'some tags' }, { value: 'outcome', label: 'some outcomes of the station' }]} />
          {m.filter && <CommitInput id="f-values" label="Values, comma separated" value={m.filter.values.join(', ')} placeholder={m.filter.field === 'type' ? 'fix, build' : m.filter.field === 'outcome' ? `reject, ${QUESTION_OUTCOME}` : ''}
            onCommit={(v) => onPatch({ filter: { field: m.filter!.field, values: list(v) } })} />}
        </>
      )}

      {m.kind === 'station' && (
        <>
          {m.exec !== 'human_gate' && m.exec !== 'native' && (
            <>
              <Select id="f-exec" label="Runs" value={m.exec} onChange={(e) => onPatch({ exec: e.target.value as StationExec, ref: '' } as Partial<StationSpec>)}
                options={[{ value: 'agent', label: 'an agent (persona)' }, { value: 'skill', label: 'a skill' }, { value: 'panel', label: 'a panel' }]} />
              <Select id="f-ref" label={m.exec === 'agent' ? 'Persona' : m.exec === 'skill' ? 'Skill' : 'Panel'} value={m.ref ?? ''} onChange={(e) => onPatch({ ref: e.target.value } as Partial<StationSpec>)}
                options={[{ value: '', label: 'choose…' }, ...refs(m.exec).map((r) => ({ value: r, label: r }))]} />
              {m.exec === 'agent' && <Select id="f-mode" label="Mode" value={m.mode ?? 'edit'} onChange={(e) => onPatch({ mode: e.target.value as 'talk' | 'plan' | 'edit' } as Partial<StationSpec>)}
                options={[{ value: 'edit', label: 'edit (can change code)' }, { value: 'plan', label: 'plan' }, { value: 'talk', label: 'talk (no workspace)' }]} />}
              <CommitInput id="f-prompt" label="Instructions for this station" value={m.prompt ?? ''} placeholder="What the agent should do here" onCommit={(v) => onPatch({ prompt: v } as Partial<StationSpec>)} />
              {!m.ref && <div className="text-xs text-[var(--theme-danger)]">Choose what this station runs: without it, every run fails.</div>}
            </>
          )}
          {m.exec === 'native' && <Select id="f-sets" label="Sets the ticket status to" value={m.sets ?? 'doing'} onChange={(e) => onPatch({ sets: e.target.value as TicketStatus } as Partial<StationSpec>)} options={STATUS_OPTIONS.slice(1)} />}
          {m.exec !== 'native' && <CommitInput id="f-outcomes" label="Outcomes, comma separated (the first is the way forward)" value={m.outcomes.join(', ')} onCommit={(v) => onPatch({ outcomes: list(v).length ? list(v) : ['ok'] } as Partial<StationSpec>)} />}
          <CommitInput id="f-cap" label="Capacity (tickets inside at once)" value={String(m.cap)} onCommit={(v) => onPatch({ cap: Math.max(1, Math.min(50, Number(v) || 8)) } as Partial<StationSpec>)} />
          <Section title="Where each outcome leaves">
            {m.outcomes.map((o) => {
              const arm = takers.find((a) => a.filter?.field === 'outcome' && a.filter.values.includes(o)) ?? takers.find((a) => !a.filter?.values.length);
              const dest = arm ? view.leadsTo(view.at(arm.x + [1, 0, -1, 0][arm.dir]!, arm.y + [0, 1, 0, -1][arm.dir]!)) : null;
              return <div key={o} className="flex justify-between gap-2 text-xs"><span className="font-mono text-[var(--theme-text-primary)]">{o}</span><span className={arm ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-danger)]'}>{arm ? `→ ${dest?.name ?? dest?.kind ?? 'the next tile'}` : 'no arm takes it'}</span></div>;
            })}
            {m.exec !== 'human_gate' && (() => {
              const arm = takers.find((a) => a.filter?.field === 'outcome' && a.filter.values.includes(QUESTION_OUTCOME));
              const dest = arm ? view.leadsTo(view.at(arm.x + [1, 0, -1, 0][arm.dir]!, arm.y + [0, 1, 0, -1][arm.dir]!)) : null;
              return <div className="flex justify-between gap-2 text-xs"><span className="font-mono text-[var(--theme-warning)]">{QUESTION_OUTCOME}</span><span className="text-[var(--theme-text-secondary)]">{arm ? `→ ${dest?.name ?? dest?.kind ?? 'the next tile'}` : 'stays here until answered'}</span></div>;
            })()}
            <Hint>An outcome leaves through the arm whose “outcome” filter holds it; an arm with no filter takes the rest. When the agent asks a question instead, only an arm filtered on “{QUESTION_OUTCOME}” takes the ticket.</Hint>
          </Section>
        </>
      )}

      {m.kind === 'zone' && (
        <>
          <Hint>{m.inbound ? 'Inbound: every ticket you hand over lands here and waits. Drag it onto a belt or a machine to start it.' : 'Tickets wait here. An arm only takes a ticket that has been released.'}</Hint>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--theme-text-primary)]">
            <input type="checkbox" checked={m.inbound === true} onChange={(e) => onPatch({ inbound: e.target.checked })} className="accent-[var(--theme-accent)]" />
            Tickets handed over land here (Inbound)
          </label>
          <Select id="f-status" label="Sets the ticket status to" value={m.status ?? ''} onChange={(e) => onPatch({ status: e.target.value as TicketStatus | '' })} options={STATUS_OPTIONS} />
          <Select id="f-release" label="Tickets leave" value={m.release} onChange={(e) => onPatch({ release: e.target.value as 'manual' | 'auto' })}
            options={[{ value: 'manual', label: 'when you release them' }, { value: 'auto', label: 'automatically, one at a time' }]} />
          {m.release === 'auto' && m.status === 'todo' && <CommitInput id="f-limit" label="Stop releasing above this many tickets in doing or reviewing" value={String(m.limit ?? 12)} onCommit={(v) => onPatch({ limit: Math.max(1, Number(v) || 12) })} />}
        </>
      )}
      {m.kind === 'exit' && <Hint>A ticket that arrives here is set to done and handed back to plain Fleex.</Hint>}
      {(m.kind === 'zone' || m.kind === 'exit') && (
        <div className="grid grid-cols-2 gap-2">
          <CommitInput id="f-w" label="Width" value={String(m.w)} onCommit={(v) => onPatch({ w: Math.max(1, Math.min(30, Number(v) || m.w)) })} />
          <CommitInput id="f-h" label="Height" value={String(m.h)} onCommit={(v) => onPatch({ h: Math.max(1, Math.min(30, Number(v) || m.h)) })} />
        </div>
      )}

      {(m.kind === 'station' || m.kind === 'zone') && (
        <>
          <Section title={`Leaves through ${takers.length} arm${takers.length === 1 ? '' : 's'}`}>
            {takers.length === 0 && (m.kind === 'zone' && m.inbound
              ? <Hint>No arm here, and none is needed: drag tickets out by hand. Put an arm against a side to let released tickets leave on their own.</Hint>
              : <div className="text-xs text-[var(--theme-danger)]">No arm takes from here: tickets will pile up. Put an arm against one of its sides.</div>)}
            {takers.map((a) => <button key={a.id} type="button" className="text-left text-xs text-[var(--theme-text-secondary)] hover:underline" onClick={() => onSelect({ machine: a.id })}>arm · {armTag(a, takers) || 'anything'}</button>)}
          </Section>
          <Section title={`${inside.length} ticket${inside.length === 1 ? '' : 's'} inside`}>
            <Button size="sm" onClick={onOpen} title="Everything inside, with what each ticket waits for (V, or double-click the machine)">Open {m.name || (m.kind === 'zone' ? 'the zone' : 'the station')}…</Button>
            {inside.slice(0, 8).map((t) => <TicketRow key={t.ticketId} t={t} onSelect={() => onSelect({ ticket: t.ticketId })} />)}
            {inside.length > 8 && <Hint>and {inside.length - 8} more: open it to see them all.</Hint>}
          </Section>
          {m.kind === 'station' && m.exec !== 'native' && (
            <Section title="What it did">
              <PeriodSelect id="f-period-machine" />
              {stats ? <MachineFigures m={stats.machines.find((q) => q.machineId === m.id) ?? null} gate={m.exec === 'human_gate'} /> : <Hint>Loading…</Hint>}
            </Section>
          )}
        </>
      )}
    </>
  );
}

const LENSES: Exclude<Lens, 'none'>[] = ['load', 'cost', 'time', 'human'];

export function FactoryInspector({ selection, view, onSelect, onPatch, onRemove, onTransfer, onOpenMachine, lens, onLens, building }: {
  selection: Selection; view: FactoryView | null; onSelect: (s: Selection) => void; onPatch: (id: string, patch: Partial<MachineSpec>) => void; onRemove: (id: string) => void; onTransfer: () => void;
  onOpenMachine: (id: string) => void; lens: Lens; onLens: (lens: Lens) => void; building: boolean;
}) {
  const snapshot = useFactoryStore((s) => s.snapshot), layout = useFactoryStore((s) => s.layout), setSettings = useFactoryStore((s) => s.setSettings), stats = useFactoryStore((s) => s.stats);
  if (!snapshot || !layout || !view) return null;
  const tickets = snapshot.tickets;
  const machine = selection && 'machine' in selection ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const ticket = selection && 'ticket' in selection ? tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  const waiting = tickets.filter((t) => needsHuman(t));
  const many = selection && 'machines' in selection ? selection.machines : null;
  const jams = standing(layout, tickets, snapshot.serverTime);
  return (
    <aside className="flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3" aria-label="Factory inspector">
      {many ? (
        <>
          <div className="text-sm font-semibold text-[var(--theme-text-primary)]">{many.length} machines selected</div>
          <Hint>Drag any of them to move them all together: belts, arms and stations keep their tickets. Delete removes them. Escape clears the selection.</Hint>
        </>
      ) : ticket ? <TicketPanel t={ticket} view={view} />
        : machine ? <MachinePanel m={machine} view={view} tickets={tickets} onPatch={(p) => onPatch(machine.id, p)} onRemove={() => onRemove(machine.id)} onSelect={onSelect} onOpen={() => onOpenMachine(machine.id)} building={building} />
        : (
          <>
            <div>
              <div className="text-sm font-semibold text-[var(--theme-text-primary)]">Factory floor</div>
              <Hint>Click a machine or a ticket. Drag a ticket to drop it elsewhere: it follows whatever it stands on.</Hint>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Tickets', tickets.length], ['Running', snapshot.running], ['Runs / h', `${snapshot.runsLastHour}/${snapshot.floor.settings.maxRunsPerHour}`]].map(([l, v]) => (
                <div key={String(l)} className="rounded-md border border-[var(--theme-border)] px-1 py-1.5"><div className="text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]">{l}</div><div className="font-mono text-sm text-[var(--theme-text-primary)]">{v}</div></div>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={onTransfer}>Hand tickets over…</Button>
            <Section title={`Waiting for you · ${waiting.length}`}>
              {waiting.length === 0 && <Hint>Nothing waits for a human.</Hint>}
              {waiting.map((t) => <TicketRow key={t.ticketId} t={t} onSelect={() => onSelect({ ticket: t.ticketId })} />)}
            </Section>
            <Section title="Where tickets stand">
              {jams.length === 0 && <Hint>Nothing stands in a station or a zone.</Hint>}
              {jams.slice(0, 5).map((j) => (
                <button key={j.machineId} type="button" onClick={() => onSelect({ machine: j.machineId })} className="flex w-full flex-col rounded-md border border-[var(--theme-border)] px-2 py-1.5 text-left hover:bg-[var(--theme-bg-overlay)]">
                  <span className="flex items-baseline justify-between gap-2 text-xs"><span className="min-w-0 truncate font-medium text-[var(--theme-text-primary)]">{j.name}</span><span className="flex-none font-mono text-[var(--theme-text-secondary)]">{j.count} · {span(j.oldestMs)}</span></span>
                  <span className={cn('text-[11px]', j.human ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{j.why}</span>
                </button>
              ))}
              {jams.length > 0 && <Hint>Count, and how long the oldest has been there. The worst first.</Hint>}
            </Section>
            <Section title="Read the floor">
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Lens">
                {LENSES.map((l) => <Button key={l} size="sm" variant={lens === l ? 'primary' : 'secondary'} aria-pressed={lens === l} onClick={() => onLens(lens === l ? 'none' : l)}>{LENS_LABEL[l]}</Button>)}
              </div>
              <Hint>A lens tints every station and zone: yellow is little, red is the most on the floor.</Hint>
            </Section>
            <Section title="What the floor did">
              <PeriodSelect id="f-period" />
              {!stats ? <Hint>Loading…</Hint> : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Tile label="Shipped" value={stats.totals.shipped} />
                    <Tile label="Lead time" value={span(stats.totals.avgLeadMs)} />
                    <Tile label="Cost" value={money(stats.totals.costUsd)} />
                    <Tile label="Runs" value={stats.totals.runs} />
                    <Tile label="Failed" value={stats.totals.failed} tone={stats.totals.failed ? 'danger' : undefined} />
                    <Tile label="Human wait" value={span(stats.totals.humanMs)} />
                  </div>
                  {stats.totals.shipped > 0 && stats.totals.costUsd > 0 && <Hint>{money(stats.totals.costUsd / stats.totals.shipped)} per ticket shipped.</Hint>}
                  {stats.machines.filter((q) => q.costUsd > 0).slice(0, 4).map((q) => (
                    <button key={q.machineId} type="button" disabled={!q.onFloor} onClick={() => onSelect({ machine: q.machineId })} className="flex items-baseline justify-between gap-2 text-left text-xs enabled:hover:underline">
                      <span className="min-w-0 truncate text-[var(--theme-text-primary)]">{q.name}{q.onFloor ? '' : ' (removed)'}</span>
                      <span className="flex-none font-mono text-[var(--theme-text-secondary)]">{money(q.costUsd)} · {q.runs} run{q.runs === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                  {stats.totals.runs === 0 && stats.totals.shipped === 0 && <Hint>Nothing ran over this period.</Hint>}
                </>
              )}
            </Section>
            <Section title="Safety limits">
              <CommitInput id="f-rph" label="Station runs the Factory may start per hour" value={String(snapshot.floor.settings.maxRunsPerHour)} onCommit={(v) => setSettings({ maxRunsPerHour: Number(v) })} />
              <CommitInput id="f-conc" label="Station runs in flight at once" value={String(snapshot.floor.settings.maxConcurrentRuns)} onCommit={(v) => setSettings({ maxConcurrentRuns: Number(v) })} />
              <Hint>On top of the global agent concurrency. Past the hourly limit, tickets wait in their station.</Hint>
            </Section>
          </>
        )}
    </aside>
  );
}
