import { useEffect, useMemo, useState } from 'react';
import type { TicketStatus } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ModelSelect } from '../components/agents/ModelSelect';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useSkillStore } from '../stores/skillStore';
import { usePanelStore } from '../stores/panelStore';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import type { FactoryView } from './renderer';
import { acceptsOutcome, armTag, isConditional, takesQuestions } from './armRules';
import { bridgeFlow, flowLabel } from './bridges';
import { FactoryArmForm } from './FactoryArmForm';
import { FactoryPromptEditor } from './FactoryPromptEditor';
import { FactoryPopup } from './FactoryPopup';
import { MachineFigures, PeriodSelect } from './FactoryStatsBits';
import { TicketGlyphs, TicketToken } from './FactoryTicketMeta';
import { since, span } from './format';
import { FIcon } from './icons';
import { MAX_PLACES } from './layoutOps';
import { canSetAside, LABEL_COLORS, needsHuman, PALETTE, QUESTION_OUTCOME, RUNS, SET_ASIDE, type ArmSpec, type FactoryRun, type FactoryTicket, type MachineSpec, type StationExec, type StationSpec } from './types';

const REFRESH_MS = 4000;
const STATUS_OPTIONS = [{ value: '', label: 'none' }, ...(['backlog', 'todo', 'doing', 'reviewing'] as TicketStatus[]).map((s) => ({ value: s, label: s }))];
const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'waiting to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'run failed', aside: 'set aside by you', out: 'done, waiting for an arm', zone: 'waiting',
};
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/** What a machine is, in a word or two. */
export function machineKind(m: MachineSpec): string {
  if (m.kind === 'station') return m.exec === 'human_gate' ? 'Gate' : m.exec === 'native' ? 'Status station' : `${m.exec[0]!.toUpperCase()}${m.exec.slice(1)} station`;
  return m.kind === 'zone' && m.inbound ? 'Inbound zone' : `${m.kind[0]!.toUpperCase()}${m.kind.slice(1)}`;
}
export const machineIcon = (m: MachineSpec): string => (m.kind === 'station' ? (m.exec === 'human_gate' ? 'gate' : m.exec) : m.kind === 'zone' && m.inbound ? 'inbound' : m.kind);

/** A text field that saves when you leave it or press Enter, not on every keystroke. Escape takes back what was typed. */
export function CommitInput({ id, label, value, onCommit, placeholder }: { id: string; label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input id={id} label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); const n = e.currentTarget; window.setTimeout(() => n.blur()); } }} />
  );
}
const Head = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{children}</h3>{right}</div>
);
const Hint = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-[var(--theme-text-muted)]">{children}</p>;

/**
 * The colour of an arm. Left to itself it is grey, and amber once it has a condition; one of the sixteen can be
 * picked instead, to tell at a glance the arm that takes what failed from the one that takes what passed.
 */
function ArmColour({ arm, onChange }: { arm: ArmSpec; onChange: (color: string | undefined) => void }) {
  const auto = !arm.color, ring = (on: boolean) => (on ? 'border-[var(--theme-text-primary)]' : 'border-transparent');
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Colour</span>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Arm colour">
        <button type="button" role="radio" aria-checked={auto} title="Grey, and amber once the arm has a condition" onClick={() => onChange(undefined)}
          className={cn('flex h-6 items-center gap-1.5 rounded-full border-2 bg-[var(--theme-bg-overlay)] px-2 text-[11px] text-[var(--theme-text-secondary)]', ring(auto))}>
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: isConditional(arm) ? 'var(--theme-warning)' : 'var(--theme-text-secondary)' }} />
          Automatic
        </button>
        {PALETTE.map((c) => (
          <button key={c.hex} type="button" role="radio" aria-checked={arm.color === c.hex} aria-label={c.name} title={c.name} onClick={() => onChange(c.hex)}
            className={cn('h-6 w-6 rounded-full border-2', ring(arm.color === c.hex))} style={{ background: c.hex }} />
        ))}
      </div>
      <Hint>Its quay, the arrow under it and its tag take the same colour.</Hint>
    </div>
  );
}
const Column = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('flex min-h-0 flex-col gap-3 overflow-y-auto p-4', className)}>{children}</div>;

/** Everything that is set on a machine. The same fields whatever opens them; they save as they are left. */
function Settings({ m, view, onPatch, onSelect }: { m: MachineSpec; view: FactoryView; onPatch: (patch: Partial<MachineSpec>) => void; onSelect: (machineId: string) => void }) {
  const layout = useFactoryStore((s) => s.layout)!;
  const [editing, setEditing] = useState(false);
  const personas = useAgentPersonaStore((s) => s.personas), skills = useSkillStore((s) => s.skills), panels = usePanelStore((s) => s.panels);
  const takers = view.takersOf(m);
  const persona = m.kind === 'station' && m.exec === 'agent' ? personas.find((p) => p.name === m.ref) ?? null : null;
  /* what the station runs stays listed even when its persona, skill or panel is not (yet) known here: the field never shows "choose" over a station that is set */
  const refs = (exec: StationExec, mine: string) => [...new Set([mine, ...(exec === 'agent' ? personas.map((p) => p.name) : exec === 'skill' ? skills.map((s) => s.commandName) : exec === 'panel' ? panels.map((p) => p.name) : [])])].filter(Boolean);
  const beyond = (a: MachineSpec & { kind: 'arm' }) => view.leadsTo(view.at(a.x + DX[a.dir]!, a.y + DY[a.dir]!));
  return (
    <>
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
      {m.kind === 'belt' && <Hint>One tile, one ticket. It pushes it to the tile it points at when that tile is free. Leads to: {view.leadsTo(m)?.name ?? 'nowhere'}.</Hint>}
      {m.kind === 'bridge' && (() => {
        const flow = bridgeFlow((px, py) => view.at(px, py), m);
        return <Hint>Where two belts cross: a ticket crosses it the way it arrives. Over (east-west): {flowLabel(flow.over)}. Under (north-south): {flowLabel(flow.under)}.</Hint>;
      })()}
      {(m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit') && <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />}

      {m.kind === 'arm' && (
        <>
          <Hint>Takes a ticket from the tile behind it and drops it on the tile in front, if that one is free. Leads to: {beyond(m)?.name ?? 'the next tile'}.</Hint>
          <FactoryArmForm key={m.id} arm={m} view={view} layout={layout} onChange={(cond) => onPatch({ when: cond, filter: null })} />
          <ArmColour arm={m} onChange={(color) => onPatch({ color })} />
        </>
      )}

      {m.kind === 'station' && (
        <>
          {RUNS.includes(m.exec) && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select id="f-exec" label="Runs" value={m.exec} onChange={(e) => onPatch({ exec: e.target.value as StationExec, ref: '' } as Partial<StationSpec>)}
                  options={[{ value: 'agent', label: 'an agent (persona)' }, { value: 'skill', label: 'a skill' }, { value: 'panel', label: 'a panel' }]} />
                <Select id="f-ref" label={m.exec === 'agent' ? 'Persona' : m.exec === 'skill' ? 'Skill' : 'Panel'} value={m.ref ?? ''} onChange={(e) => onPatch({ ref: e.target.value } as Partial<StationSpec>)}
                  options={[{ value: '', label: 'choose' }, ...refs(m.exec, m.ref ?? '').map((r) => ({ value: r, label: r }))]} />
              </div>
              {!m.ref && <div className="text-xs text-[var(--theme-danger)]">Choose what this station runs: without it, every run fails.</div>}
              {m.exec === 'agent' && (
                <div className="grid grid-cols-2 gap-2">
                  <Select id="f-mode" label="Mode" value={m.mode ?? 'edit'} onChange={(e) => onPatch({ mode: e.target.value as 'talk' | 'plan' | 'edit' } as Partial<StationSpec>)}
                    options={[{ value: 'edit', label: 'edit (can change code)' }, { value: 'plan', label: 'plan' }, { value: 'talk', label: 'talk (no workspace)' }]} />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Model</span>
                    <ModelSelect id="f-model" ariaLabel="Model this station runs on" value={m.model ?? ''} onChange={(v) => onPatch({ model: v || undefined } as Partial<StationSpec>)}
                      leadingOption={{ value: '', label: persona?.model ? `The persona's own (${persona.model})` : "The persona's own" }} />
                  </div>
                </div>
              )}
              {m.exec === 'agent' && m.model && <Hint>Runs on this model here, whatever {m.ref || 'the persona'} is set to elsewhere.</Hint>}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Instructions for this station</span>
                <button type="button" onClick={() => setEditing(true)} title="Open the editor"
                  className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-left text-sm hover:border-[var(--theme-accent)]">
                  {m.prompt?.trim()
                    ? <span className="line-clamp-[10] whitespace-pre-wrap text-[var(--theme-text-primary)]">{m.prompt}</span>
                    : <span className="text-[var(--theme-text-muted)]">What the agent should do here</span>}
                </button>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--theme-text-muted)]">{m.prompt?.trim() ? `${m.prompt.split('\n').length} lines · ${m.prompt.length.toLocaleString('en-US')} characters` : 'None yet'}</span>
                  <Button size="sm" onClick={() => setEditing(true)}>Edit in a large window</Button>
                </div>
                {editing && <FactoryPromptEditor title={m.name || 'Station'} value={m.prompt ?? ''} onSave={(v) => onPatch({ prompt: v } as Partial<StationSpec>)} onClose={() => setEditing(false)} />}
              </div>
            </>
          )}
          {m.exec === 'native' && <Select id="f-sets" label="Sets the ticket status to" value={m.sets ?? 'doing'} onChange={(e) => onPatch({ sets: e.target.value as TicketStatus } as Partial<StationSpec>)} options={STATUS_OPTIONS.slice(1)} />}
          {m.exec !== 'native' && <CommitInput id="f-outcomes" label="Outcomes, comma separated (the first is the way forward)" value={m.outcomes.join(', ')} onCommit={(v) => onPatch({ outcomes: list(v).length ? list(v) : ['ok'] } as Partial<StationSpec>)} />}
          <CommitInput id="f-cap" label="Places (tickets worked on at once)" value={String(m.cap)} onCommit={(v) => onPatch({ cap: Math.max(1, Math.min(RUNS.includes(m.exec) ? MAX_PLACES : 50, Number(v) || 2)) } as Partial<StationSpec>)} />
          <Head>Where each outcome leaves</Head>
          <div className="flex flex-col gap-1">
            {m.outcomes.map((o) => {
              const arm = takers.find((a) => acceptsOutcome(a, o)) ?? takers.find((a) => !isConditional(a)), dest = arm ? beyond(arm) : null;
              return <div key={o} className="flex justify-between gap-2 text-xs"><span className="font-mono text-[var(--theme-text-primary)]">{o}</span><span className={arm ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-danger)]'}>{arm ? `→ ${dest?.name ?? dest?.kind ?? 'the next tile'}` : 'no arm takes it'}</span></div>;
            })}
            {m.exec !== 'human_gate' && m.exec !== 'native' && (() => {
              const arm = takers.find((a) => takesQuestions(a)), dest = arm ? beyond(arm) : null;
              return <div className="flex justify-between gap-2 text-xs"><span className="font-mono text-[var(--theme-warning)]">{QUESTION_OUTCOME}</span><span className="text-[var(--theme-text-secondary)]">{arm ? `→ ${dest?.name ?? dest?.kind ?? 'the next tile'}` : 'stays here until answered'}</span></div>;
            })()}
          </div>
          <Hint>An outcome leaves through the arm that asks for it (a condition on the outcome); an arm with no condition takes the rest.</Hint>
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
          <Head>Leaves through {takers.length} arm{takers.length === 1 ? '' : 's'}</Head>
          {takers.length === 0 && (m.kind === 'zone' && m.inbound
            ? <Hint>No arm here, and none is needed: drag tickets out by hand. Put an arm against a side to let released tickets leave on their own.</Hint>
            : <div className="text-xs text-[var(--theme-danger)]">No arm takes from here: tickets will pile up. Put an arm against one of its sides.</div>)}
          {takers.map((a) => <button key={a.id} type="button" className="text-left text-xs text-[var(--theme-text-secondary)] hover:underline" title="Open this arm" onClick={() => onSelect(a.id)}>arm · {armTag(a, takers) || 'anything'}</button>)}
        </>
      )}
    </>
  );
}

/** The tickets a station or a zone holds: what each waits for and since when, with the action it needs. */
function Inside({ m, onOpenTicket }: { m: MachineSpec; onOpenTicket: (ticketId: string) => void }) {
  const store = useFactoryStore();
  const [q, setQ] = useState('');
  const now = store.snapshot?.serverTime ?? new Date().toISOString();
  const all = useMemo(() => (store.snapshot?.tickets ?? []).filter((t) => t.machineId === m.id).sort((a, b) => a.since.localeCompare(b.since)), [store.snapshot, m.id]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((t) => (t.info?.title ?? '').toLowerCase().includes(needle) || String(t.info?.displayId ?? '').includes(needle)) : all;
  const held = all.filter((t) => t.phase === 'zone' && !t.released);
  return (
    <>
      <Head right={held.length > 1 ? <Button size="sm" variant="primary" onClick={() => { for (const t of held) void store.release(t.ticketId); }}>Release all {held.length}</Button> : undefined}>
        {all.length} ticket{all.length === 1 ? '' : 's'} inside{m.kind === 'station' ? ` of ${m.cap}` : ''}
      </Head>
      {all.length > 6 && <Input id="factory-machine-search" aria-label="Filter the tickets" placeholder="Filter by title or number" value={q} onChange={(e) => setQ(e.target.value)} />}
      {shown.length === 0 && <div className="py-8 text-center text-xs text-[var(--theme-text-muted)]">{all.length === 0 ? 'Nothing here right now.' : 'No ticket matches.'}</div>}
      <ul className="flex flex-col gap-1">
        {shown.map((t) => {
          const why = needsHuman(t);
          return (
            <li key={t.ticketId} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--theme-border)] px-2 py-1.5">
              <TicketToken info={t.info} size={22} />
              <button type="button" onClick={() => onOpenTicket(t.ticketId)} className="min-w-0 flex-1 basis-48 text-left" title="Open the ticket">
                <div className="truncate text-xs font-medium text-[var(--theme-text-primary)] hover:underline"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>{t.info?.title ?? t.ticketId}</div>
                <div className={cn('truncate text-[11px]', why ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>
                  {t.phase === 'zone' && t.released ? 'released, waiting for an arm' : PHASE[t.phase]}{t.outcome ? ` · ${t.outcome}` : ''}{t.note ? ` · ${t.note}` : ''}
                </div>
              </button>
              <TicketGlyphs info={t.info ? { ...t.info, favorite: false } : null} />
              <span className="flex-none font-mono text-[11px] text-[var(--theme-text-secondary)]" title={`Here since ${when(t.since)}`}>{span(since(t.since, now))}</span>
              <span className="flex flex-none flex-wrap gap-1">
                {t.phase === 'review' && m.kind === 'station' && m.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => store.resolve(t.ticketId, o)}>{o}</Button>)}
                {t.phase === 'zone' && !t.released && <Button size="sm" variant="primary" onClick={() => store.release(t.ticketId)}>Release</Button>}
                {t.phase === 'question' && <Button size="sm" onClick={() => onOpenTicket(t.ticketId)}>Answer</Button>}
                {SET_ASIDE.includes(t.phase) && t.phase !== 'question' && <Button size="sm" variant="primary" onClick={() => store.putBack(t.ticketId)}>Run again</Button>}
                {canSetAside(t, m) && <Button size="sm" onClick={() => store.setAside(t.ticketId)} title={t.phase === 'running' ? 'Stops the run and keeps the ticket here until you put it back' : 'Keeps the ticket here until you put it back'}>Set aside</Button>}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** What a station did over the period, and its latest runs (or decisions, for a gate). */
function Did({ m, onOpenTicket }: { m: StationSpec; onOpenTicket: (ticketId: string) => void }) {
  const stats = useFactoryStore((s) => s.stats), snapshot = useFactoryStore((s) => s.snapshot);
  const known = useTicketStore((s) => s.tickets);
  const [runs, setRuns] = useState<FactoryRun[] | null>(null);
  const gate = m.exec === 'human_gate', now = snapshot?.serverTime ?? new Date().toISOString();
  useEffect(() => {
    let live = true;
    const load = () => { factoryApi.machineRuns(m.id).then((r) => { if (live) setRuns(r); }).catch(() => { if (live) setRuns((cur) => cur ?? []); }); };
    setRuns(null); load();
    const id = window.setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(id); };
  }, [m.id]);
  useEffect(() => { if (!useFactoryStore.getState().stats) void useFactoryStore.getState().loadStats(); }, []);
  const titles = useMemo(() => {
    const out = new Map<string, string>();
    for (const t of known) out.set(t.id, `#${t.displayId} ${t.title}`);
    for (const t of snapshot?.tickets ?? []) if (t.info) out.set(t.ticketId, `#${t.info.displayId} ${t.info.title}`);
    return out;
  }, [known, snapshot]);
  return (
    <>
      <Head right={<PeriodSelect id="factory-machine-period" />}>What it did</Head>
      {stats ? <MachineFigures m={stats.machines.find((q) => q.machineId === m.id) ?? null} gate={gate} /> : <Hint>Loading</Hint>}
      <Head>Latest {gate ? 'decisions' : 'runs'}</Head>
      {runs === null ? <Hint>Loading</Hint> : runs.length === 0 ? <Hint>None yet.</Hint> : (
        <ol className="flex flex-col">
          {runs.map((r) => (
            <li key={r.id} className="border-t border-[var(--theme-border)] py-1.5 first:border-t-0">
              <button type="button" onClick={() => onOpenTicket(r.ticketId)} className="flex w-full items-baseline gap-2 text-left text-xs">
                <span className={cn('h-2 w-2 flex-none rounded-full', r.status === 'failed' || r.status === 'interrupted' ? 'bg-[var(--theme-danger)]' : r.status === 'running' ? 'bg-[var(--theme-success)]' : r.status === 'completed' ? 'bg-[var(--theme-text-muted)]' : 'bg-[var(--theme-warning)]')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)] hover:underline">{titles.get(r.ticketId) ?? r.ticketId.slice(0, 8)}</span>
                <span className="flex-none font-mono text-[var(--theme-text-secondary)]">{r.outcome ?? (r.status === 'needs_review' ? 'waiting' : r.status)}</span>
                <span className="flex-none font-mono text-[var(--theme-text-muted)]">{span(since(r.startedAt, r.finishedAt ?? now))}</span>
              </button>
              <div className="pl-4 text-[11px] text-[var(--theme-text-muted)]">{when(r.startedAt)}{r.error ? <span className="text-[var(--theme-danger)]"> · {r.error}</span> : null}</div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * A machine, opened from the floor (a double-click, Enter, or Edit on the command card): a popup over the floor, as
 * for a ticket. A station shows its settings, the tickets it holds and what it did; a zone its settings and its
 * tickets; an arm, an exit or a label, which have only settings, a small popup. Everything a machine has to be set
 * is set here: the floor has no side panel.
 */
export function FactoryMachinePopup({ machineId, view, onClose, onPatch, onRemove, onOpenTicket, onOpenMachine }: {
  machineId: string; view: FactoryView; onClose: () => void; onPatch: (id: string, patch: Partial<MachineSpec>) => void; onRemove: (id: string) => void;
  onOpenTicket: (ticketId: string) => void; onOpenMachine: (machineId: string) => void;
}) {
  const layout = useFactoryStore((s) => s.layout), power = useFactoryStore((s) => s.power);
  const m = layout?.machines.find((q) => q.id === machineId) ?? null;
  useEffect(() => { if (!m) onClose(); }, [m, onClose]);
  if (!m || !layout) return null;
  /* the page gets a fresh copy of the layout at every poll: the view must read this one before it is asked about it */
  view.use(layout);
  const box = m.kind === 'station' || m.kind === 'zone', station = m.kind === 'station' && m.exec !== 'native' ? m : null;
  const switchable = m.kind === 'station' && RUNS.includes(m.exec);
  const title = ('name' in m && m.name) || (m.kind === 'label' ? m.text : machineKind(m));
  const bar = (
    <>
      <span className="flex-none text-[var(--theme-text-secondary)]"><FIcon name={machineIcon(m)} size={20} /></span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <b className="text-[var(--theme-text-primary)]">{title}</b>
        {title !== machineKind(m) && <span className="ml-2 text-xs text-[var(--theme-text-muted)]">{machineKind(m)}</span>}
      </span>
      {switchable && m.kind === 'station' && (
        <>
          <span className={cn('flex-none text-xs font-semibold', m.off ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-success)]')} title={m.off ? 'It takes tickets in and starts nothing on them.' : 'It runs on what comes in.'}>{m.off ? 'Stopped' : 'Running'}</span>
          <Button size="sm" variant={m.off ? 'primary' : 'secondary'} onClick={() => void power(m.id, !!m.off)} title={m.off ? 'It starts on the tickets it holds' : 'It keeps taking tickets in and starts nothing on them; what runs finishes'}>{m.off ? 'Start' : 'Stop'}</Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => { onRemove(m.id); onClose(); }} title="Remove this machine from the floor">Remove</Button>
    </>
  );
  const settings = <Settings m={m} view={view} onPatch={(p) => onPatch(m.id, p)} onSelect={onOpenMachine} />;
  if (!box) return <FactoryPopup label="Machine" onClose={onClose} bar={bar} size="fit" maxWidth="max-w-2xl"><Column>{settings}</Column></FactoryPopup>;
  return (
    <FactoryPopup label="Machine" onClose={onClose} bar={bar} size="large" maxWidth={station ? 'max-w-[1400px]' : 'max-w-5xl'}>
      <div className={cn('grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--theme-border)] overflow-y-auto lg:divide-x lg:divide-y-0 lg:overflow-hidden',
        station ? 'lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)_minmax(300px,400px)]' : 'lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]')}>
        <Column className="max-lg:overflow-visible"><Head>Settings</Head>{settings}</Column>
        <Column className="max-lg:overflow-visible"><Inside m={m} onOpenTicket={onOpenTicket} /></Column>
        {station && <Column className="max-lg:overflow-visible"><Did m={station} onOpenTicket={onOpenTicket} /></Column>}
      </div>
    </FactoryPopup>
  );
}
