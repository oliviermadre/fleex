import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { toast } from '../lib/toast';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import type { FactoryView } from './renderer';
import { armTag, takesQuestions } from './armRules';
import { CloseButton, ConsoleTabs, EmptyState, FactoryConsolePopup, Plate, SectionHead, Skeleton, type Counter, type TabSpec } from './FactoryConsolePopup';
import { CommitInput, DX, DY, machineIcon, machineKind, PHASE, ScriptSettings, sizesOf, STATUS_OPTIONS, when } from './FactoryMachinePopup';
import { FactoryPromptEditor } from './FactoryPromptEditor';
import { PeriodSelect, periodLabel } from './FactoryStatsBits';
import { TicketGlyphs, TicketToken } from './FactoryTicketMeta';
import { money, since, span } from './format';
import { FIcon } from './icons';
import { MAX_PLACES } from './layoutOps';
import { refOf, SOURCE_LABEL } from './items';
import { scriptOutcomes, whatRuns, scriptOf } from './script';
import {
  armFor, badgesOf, familyOf, lampOf, machineColour, normalizeOutcome, openingTab, outcomeSuggestions, rememberTab, runBars, TABS, waitingOnYou, type TabId,
} from './stationConsole';
import { canSetAside, humanCall, QUESTION_OUTCOME, RUNS, SET_ASIDE, type ArmSpec, type FactoryRun, type FactoryTicket, type MachineSpec, type MachineStats, type StationExec, type StationSpec, type ZoneSpec } from './types';

const REFRESH_MS = 4000;
const TAB_LABEL: Record<TabId, { label: string; icon: string }> = {
  inside: { label: 'Inside', icon: 'stack' }, setup: { label: 'Setup', icon: 'build' }, routing: { label: 'Routing', icon: 'arm' }, activity: { label: 'Activity', icon: 'gauge' },
};
type Patch = (patch: Partial<MachineSpec>) => void;
type Box = StationSpec | ZoneSpec;

const Hint = ({ children, tone }: { children: ReactNode; tone?: 'warning' | 'danger' }) => (
  <p className={cn('text-xs', tone === 'danger' ? 'text-[var(--theme-danger)]' : tone === 'warning' ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{children}</p>
);
const FieldLabel = ({ children }: { children: ReactNode }) => <span className="fx-display text-xs font-medium text-[var(--theme-text-secondary)]">{children}</span>;
/** A panel of the console: a frame that groups what goes together. */
const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-base)]/40 p-3.5', className)}>{children}</div>
);
const Columns = ({ children, wide }: { children: ReactNode; wide?: 'left' | 'right' }) => (
  <div className={cn('grid grid-cols-1 gap-3', wide === 'left' ? '@min-[700px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : wide === 'right' ? '@min-[700px]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : '@min-[700px]:grid-cols-2')}>{children}</div>
);

/** A choice drawn as cards, each with its icon (a radio group: arrows move between them). */
function CardChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; sub: string; icon: string }[]; onChange: (v: T) => void }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    onChange(next.value);
    const group = e.currentTarget.parentElement;
    window.setTimeout(() => group?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1.5">
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} data-value={o.value} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={(e) => move(e, i)}
              className={cn('flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]',
                on ? 'border-[var(--mc)] bg-[color-mix(in_srgb,var(--mc)_14%,transparent)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-border-input)]')}>
              <span className={on ? 'text-[var(--mc)]' : 'text-[var(--theme-text-muted)]'}><FIcon name={o.icon} size={18} /></span>
              <span className="text-xs font-semibold">{o.label}</span>
              <span className="text-[11px] leading-tight text-[var(--theme-text-muted)]">{o.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The phase of a ticket, as a coloured pill. */
function PhasePill({ t }: { t: FactoryTicket }) {
  const text = t.phase === 'zone' && t.released ? 'released, waits for an arm' : t.phase === 'review' ? 'waits for your decision' : t.phase === 'question' ? 'asked a question' : PHASE[t.phase];
  const tone = t.phase === 'running' ? 'var(--theme-success)' : t.phase === 'failed' ? 'var(--theme-danger)' : t.phase === 'review' || t.phase === 'question' ? 'var(--theme-warning)' : 'var(--theme-text-muted)';
  return (
    <span className="fx-display flex-none rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider" style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 50%, transparent)` }}>{text}</span>
  );
}

/** One cell per place, full for the places taken. */
const PlaceCells = ({ cap, used }: { cap: number; used: number }) => (
  <span className="flex flex-wrap gap-0.5" role="img" aria-label={`${Math.min(used, cap)} of ${cap} places taken`}>
    {Array.from({ length: Math.min(cap, 50) }, (_, i) => (
      <span key={i} className={cn('h-2.5 w-2.5 rounded-[3px] border', i < used ? 'border-[var(--mc)] bg-[var(--mc)]' : 'border-[var(--theme-border-input)]')} />
    ))}
  </span>
);

/** The tickets a station or a zone holds: what each waits for and since when, with the action it needs. */
function InsideTab({ m, tickets, now, onOpenTicket }: { m: Box; tickets: FactoryTicket[]; now: string; onOpenTicket: (ticketId: string) => void }) {
  const store = useFactoryStore();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? tickets.filter((t) => (t.info?.title ?? '').toLowerCase().includes(needle) || String(t.info?.displayId ?? '').includes(needle)) : tickets;
  const held = tickets.filter((t) => t.phase === 'zone' && !t.released);
  return (
    <div className="flex flex-col gap-3">
      <SectionHead icon="stack" right={held.length > 1 ? <Button size="sm" variant="primary" onClick={() => { for (const t of held) void store.release(t.ticketId); }}>Release all {held.length}</Button> : undefined}>
        {tickets.length} ticket{tickets.length === 1 ? '' : 's'} inside{m.kind === 'station' ? ` of ${m.cap}` : ''}
      </SectionHead>
      {m.kind === 'station' && <PlaceCells cap={m.cap} used={tickets.length} />}
      {tickets.length > 6 && <Input id="factory-machine-search" aria-label="Filter the tickets" placeholder="Filter by title or number" value={q} onChange={(e) => setQ(e.target.value)} />}
      {tickets.length === 0 && <EmptyState icon="stack" title="Nothing here right now." sub={m.kind === 'zone' && m.inbound ? 'Tickets you hand over land here.' : 'Tickets show up here when an arm brings them in.'} />}
      {tickets.length > 0 && shown.length === 0 && <EmptyState icon="stack" title="No ticket matches." />}
      <ul className="flex flex-col gap-1.5">
        {shown.map((t) => {
          const you = humanCall(t) !== null;
          return (
            <li key={t.ticketId} className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border px-2.5 py-2',
              you ? 'border-[color-mix(in_srgb,var(--theme-warning)_55%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)]' : 'border-[var(--theme-border)]')}>
              <TicketToken info={t.info} size={22} />
              <button type="button" onClick={() => onOpenTicket(t.ticketId)} className="min-w-0 flex-1 basis-48 text-left" title="Open the ticket">
                <div className="truncate text-xs font-medium hover:underline"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">{refOf(t.info)}</span>{t.info?.title ?? t.ticketId}</div>
                {(t.note || t.outcome) && (
                  <div className={cn('truncate text-[11px]', you ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{[t.outcome, t.note].filter(Boolean).join(' · ')}</div>
                )}
              </button>
              <PhasePill t={t} />
              <TicketGlyphs info={t.info ? { ...t.info, favorite: false } : null} />
              <span className="flex flex-none items-center gap-1 font-mono text-[11px] text-[var(--theme-text-secondary)]" title={`Here since ${when(t.since)}`}><FIcon name="clock" size={12} />{span(since(t.since, now))}</span>
              <span className="flex flex-none flex-wrap items-center gap-1">
                {t.phase === 'review' && m.kind === 'station' && <span className="text-[11px] text-[var(--theme-text-muted)]">Leave by</span>}
                {t.phase === 'review' && m.kind === 'station' && m.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => store.resolve(t.ticketId, o)}>{o}</Button>)}
                {t.phase === 'zone' && !t.released && <Button size="sm" variant="primary" onClick={() => store.release(t.ticketId)}>Release</Button>}
                {t.phase === 'question' && <Button size="sm" variant="primary" onClick={() => onOpenTicket(t.ticketId)}>Answer</Button>}
                {SET_ASIDE.includes(t.phase) && t.phase !== 'question' && <Button size="sm" variant="primary" onClick={() => store.putBack(t.ticketId)}>Run again</Button>}
                {canSetAside(t, m) && <Button size="sm" onClick={() => store.setAside(t.ticketId)} title={t.phase === 'running' ? 'Stops the run and keeps the ticket here until you put it back' : 'Keeps the ticket here until you put it back'}>Set aside</Button>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The size of a station that has one to choose. */
function SizeField({ m, onPatch }: { m: MachineSpec; onPatch: Patch }) {
  const list = sizesOf(m);
  if (!list) return null;
  const now = `${m.w}x${m.h}`, known = list.some(([w, h]) => `${w}x${h}` === now);
  return (
    <div className="flex flex-col gap-1">
      <Select id="f-size" label="Size" value={now} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); onPatch({ w, h } as Partial<MachineSpec>); }}
        options={[...list.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` })), ...(known ? [] : [{ value: now, label: `${m.w} × ${m.h} (as built)` }])]} />
      <Hint>Odd, so that what comes in and goes out lines up on its middle. It grows down and right; where there is no room, it says so.</Hint>
    </div>
  );
}

/** What an agent, skill or panel station runs, and its instructions. */
function SetupRuns({ m, onPatch }: { m: StationSpec; onPatch: Patch }) {
  const [editing, setEditing] = useState(false);
  const personas = useAgentPersonaStore((s) => s.personas), skills = useSkillStore((s) => s.skills), panels = usePanelStore((s) => s.panels);
  const skill = m.exec === 'skill' ? skills.find((s) => s.commandName === m.ref) ?? null : null;
  const persona = m.exec === 'agent' ? personas.find((p) => p.name === m.ref) ?? null : skill ? personas.find((p) => p.id === skill.personaId) ?? null : null;
  const refs = [...new Set([m.ref ?? '', ...(m.exec === 'agent' ? personas.map((p) => p.name) : m.exec === 'skill' ? skills.map((s) => s.commandName) : panels.map((p) => p.name))])].filter(Boolean);
  const what = m.exec === 'agent' ? 'persona' : m.exec;
  const prompt = m.prompt?.trim() ? m.prompt : '';
  return (
    <Columns>
      <Card>
        <SectionHead icon={m.exec}>What runs</SectionHead>
        <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />
        <CardChoice label="Runs" value={m.exec as 'agent' | 'skill' | 'panel'} onChange={(v) => { if (v !== m.exec) onPatch({ exec: v as StationExec, ref: '' } as Partial<StationSpec>); }}
          options={[{ value: 'agent', label: 'Agent', sub: 'an agent (persona)', icon: 'agent' }, { value: 'skill', label: 'Skill', sub: 'a skill', icon: 'skill' }, { value: 'panel', label: 'Panel', sub: 'a panel', icon: 'panel' }]} />
        <div className={cn('flex flex-col gap-1', !m.ref && '[&_select]:border-[var(--theme-warning)]')}>
          <Select id="f-ref" label={m.exec === 'agent' ? 'Persona' : m.exec === 'skill' ? 'Skill' : 'Panel'} value={m.ref ?? ''} onChange={(e) => onPatch({ ref: e.target.value } as Partial<StationSpec>)}
            options={[{ value: '', label: 'choose' }, ...refs.map((r) => ({ value: r, label: r }))]} />
          {!m.ref && <Hint tone="warning">No {what} chosen: this station takes tickets in and starts nothing on them.</Hint>}
        </div>
        {m.exec === 'agent' && (
          <CardChoice label="Mode" value={m.mode ?? 'edit'} onChange={(v) => onPatch({ mode: v } as Partial<StationSpec>)}
            options={[{ value: 'edit', label: 'edit', sub: 'can change code', icon: 'edit' }, { value: 'plan', label: 'plan', sub: 'reads, proposes', icon: 'plan' }, { value: 'talk', label: 'talk', sub: 'no workspace', icon: 'person' }]} />
        )}
        {(m.exec === 'agent' || m.exec === 'skill') && (
          <div className="flex flex-col gap-1">
            <FieldLabel>Model</FieldLabel>
            <ModelSelect id="f-model" ariaLabel="Model this station runs on" value={m.model ?? ''} onChange={(v) => onPatch({ model: v || undefined } as Partial<StationSpec>)}
              leadingOption={{ value: '', label: persona?.model ? `The persona's own (${persona.model})` : "The persona's own" }} />
            {m.model && <Hint>Runs on this model here, whatever {persona?.name || (m.exec === 'agent' && m.ref) || 'the persona'} is set to elsewhere.</Hint>}
          </div>
        )}
        <SizeField m={m} onPatch={onPatch} />
      </Card>
      <Card>
        <SectionHead icon="edit">Instructions for this station</SectionHead>
        <button type="button" onClick={() => setEditing(true)} title="Open the editor"
          className="relative max-h-[210px] overflow-hidden rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-left font-mono text-xs leading-relaxed hover:border-[var(--mc)]">
          {prompt ? <span className="whitespace-pre-wrap break-words">{prompt}</span> : <span className="font-sans text-[var(--theme-text-muted)]">What the agent should do here</span>}
          {prompt && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--theme-bg-base)] to-transparent" />}
        </button>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-[var(--theme-text-muted)]">{prompt ? `${prompt.split('\n').length} lines · ${prompt.length.toLocaleString('en-US')} characters` : 'None yet'}</span>
          <Button size="sm" onClick={() => setEditing(true)}>Edit in a large window</Button>
        </div>
        {editing && <FactoryPromptEditor title={m.name || 'Station'} value={m.prompt ?? ''} onSave={(v) => onPatch({ prompt: v } as Partial<StationSpec>)} onClose={() => setEditing(false)} colour={machineColour(m)} />}
      </Card>
    </Columns>
  );
}

/** A script station: its lines, wide; its name and what runs, narrow. */
function SetupScript({ m, onPatch }: { m: StationSpec; onPatch: Patch }) {
  const runs = whatRuns(scriptOf(m.script));
  return (
    <Columns wide="left">
      <Card><SectionHead icon="script">Lines</SectionHead><ScriptSettings key={m.id} script={m.script} onChange={(script) => onPatch({ script, outcomes: scriptOutcomes(script) } as Partial<StationSpec>)} /></Card>
      <Card>
        <SectionHead icon="script">What runs</SectionHead>
        <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5 text-xs">
          <div><span className="fx-display mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">A ticket</span><span className="font-mono">{runs.ticket.join(' · ') || 'nothing'}</span></div>
          <div><span className="fx-display mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">An item</span><span className="font-mono">{runs.item.join(' · ') || 'nothing'}</span></div>
        </div>
        <SizeField m={m} onPatch={onPatch} />
      </Card>
    </Columns>
  );
}

/** The arms a machine leaves through, each opening; or what it means when there is none. */
function Takers({ m, takers, onOpenMachine }: { m: Box; takers: ArmSpec[]; onOpenMachine: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionHead icon="arm">Leaves through {takers.length} arm{takers.length === 1 ? '' : 's'}</SectionHead>
      {takers.length === 0 && (m.kind === 'zone' && m.inbound
        ? <Hint>No arm here, and none is needed: drag tickets out by hand. Put an arm against a side to let released tickets leave on their own.</Hint>
        : <Hint tone="danger">No arm takes from here: tickets will pile up. Put an arm against one of its sides.</Hint>)}
      <div className="flex flex-wrap gap-1.5">
        {takers.map((a) => (
          <button key={a.id} type="button" title="Open this arm" onClick={() => onOpenMachine(a.id)}
            className="flex items-center gap-1 rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-xs text-[var(--theme-text-secondary)] hover:border-[var(--mc)] hover:text-[var(--theme-text-primary)]">
            <FIcon name="arm" size={12} />arm · {armTag(a, takers) || 'anything'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The places of a station as bays: one per place, a ticket in each taken one, the queue beyond. Past twelve, cells.
 * One fewer or one more, saved at once, within the bounds the station always had.
 */
function Places({ m, tickets, onPatch }: { m: StationSpec; tickets: FactoryTicket[]; onPatch: Patch }) {
  const max = RUNS.includes(m.exec) ? MAX_PLACES : 50, set = (cap: number) => onPatch({ cap: Math.max(1, Math.min(max, cap)) } as Partial<StationSpec>);
  const extra = tickets.length - m.cap;
  return (
    <div className="flex flex-col gap-2">
      <SectionHead icon="stack" right={
        <span className="flex items-center gap-1">
          <Button size="sm" variant="secondary" aria-label="One place fewer" disabled={m.cap <= 1} onClick={() => set(m.cap - 1)}>−</Button>
          <span className="w-7 text-center font-mono text-sm tabular-nums" aria-live="polite" aria-label={`${m.cap} places`}>{m.cap}</span>
          <Button size="sm" variant="secondary" aria-label="One place more" disabled={m.cap >= max} onClick={() => set(m.cap + 1)}>+</Button>
        </span>}>Places (tickets worked on at once)</SectionHead>
      {m.cap > 12 ? (
        <div className="flex items-center gap-2"><PlaceCells cap={m.cap} used={tickets.length} /><span className="text-xs text-[var(--theme-text-muted)]">{Math.min(tickets.length, m.cap)} of {m.cap} taken</span></div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: m.cap }, (_, i) => {
            const t = tickets[i];
            return t ? (
              <div key={i} className="flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-[var(--mc)] bg-[color-mix(in_srgb,var(--mc)_10%,transparent)]">
                <TicketToken info={t.info} size={20} /><span className="font-mono text-[10px]">{refOf(t.info)}</span>
              </div>
            ) : (
              <div key={i} className="flex h-14 w-16 items-center justify-center rounded-lg border border-[var(--theme-border-input)] text-[10px] uppercase tracking-wider text-[var(--theme-text-muted)]"
                style={{ backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--theme-text-muted) 14%, transparent) 6px 7px)' }}>free</div>
            );
          })}
          {extra > 0 && (
            <div className="flex h-14 w-16 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--theme-warning)] text-[var(--theme-warning)]">
              <span className="font-mono text-sm">+{extra}</span><span className="text-[9px] leading-tight">queue on the belt</span>
            </div>
          )}
        </div>
      )}
      <Hint>Each bay holds one ticket being worked on. Past that, tickets queue on the belt.</Hint>
    </div>
  );
}

/**
 * The doors out of a station: one line per outcome, from the station through the arm that takes it to what lies
 * beyond. The first is the way forward; ☆ makes another one so, × takes one off (never the last). An outcome no arm
 * takes stays here, done, until an arm takes it. A script's doors are what its script gives.
 */
function Doors({ m, takers, view, onPatch, onOpenMachine }: { m: StationSpec; takers: ArmSpec[]; view: FactoryView; onPatch: Patch; onOpenMachine: (id: string) => void }) {
  const machines = useFactoryStore((s) => s.layout?.machines) ?? [];
  const [typed, setTyped] = useState('');
  const fixed = m.exec === 'script', asks = m.exec !== 'script' && m.exec !== 'human_gate';
  const beyond = (a: ArmSpec) => view.leadsTo(view.at(a.x + DX[a.dir]!, a.y + DY[a.dir]!));
  const save = (outcomes: string[]) => onPatch({ outcomes } as Partial<StationSpec>);
  const add = (raw: string) => {
    const name = normalizeOutcome(raw);
    if (!name || name === QUESTION_OUTCOME) return;
    setTyped('');
    if (m.outcomes.includes(name)) return;
    save([...m.outcomes, name]);
    toast.info(`${name} added: until an arm takes it, its tickets stay here.`);
  };
  const norm = normalizeOutcome(typed), reserved = norm === QUESTION_OUTCOME;
  const hints = reserved ? [] : outcomeSuggestions(m, machines, typed);
  const fresh = !!norm && !reserved && !m.outcomes.includes(norm) && !hints.some((h) => h.name === norm);
  const rows: { o: string; arm: ArmSpec | null; question?: boolean }[] = [
    ...m.outcomes.map((o) => ({ o, arm: armFor(takers, o) })),
    ...(asks ? [{ o: QUESTION_OUTCOME, arm: takers.find((a) => takesQuestions(a)) ?? null, question: true }] : []),
  ];
  const Dest = ({ arm, question }: { arm: ArmSpec | null; question?: boolean }) => {
    if (!arm) {
      return question
        ? <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-dashed border-[var(--theme-border-input)] px-2 py-1.5 text-xs"><FIcon name={machineIcon(m)} size={14} /><span className="truncate">This station</span></div>
        : <div className="flex min-w-0 flex-col rounded-lg border border-dashed border-[var(--theme-warning)] px-2 py-1 text-xs"><span className="font-semibold text-[var(--theme-warning)]">Stays here</span><span className="truncate text-[10.5px] text-[var(--theme-text-muted)]">done, waits for an arm</span></div>;
    }
    const d = beyond(arm);
    return (
      <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] px-2 py-1.5 text-xs">
        {d && <span className="text-[var(--theme-text-secondary)]"><FIcon name={machineIcon(d)} size={14} /></span>}
        <span className="truncate">{d ? ('name' in d && d.name) || machineKind(d) : 'the next tile'}</span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2.5">
      <SectionHead icon="exit">Outcomes: the doors out of this station</SectionHead>
      {takers.length === 0 && <Hint tone="danger">No arm takes from here: tickets will pile up. Put an arm against one of its sides.</Hint>}
      <div className="grid grid-cols-[minmax(0,92px)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 @max-[700px]:grid-cols-[28px_minmax(0,1fr)_24px_minmax(0,1fr)]">
        <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-[var(--mc)] bg-[color-mix(in_srgb,var(--mc)_10%,transparent)] p-2 text-[var(--mc)]"
          style={{ gridRow: `1 / span ${rows.length}` }}>
          <FIcon name={machineIcon(m)} size={22} />
          <span className="w-full truncate text-center text-[11px] font-medium text-[var(--theme-text-primary)] @max-[700px]:hidden">{m.name || machineKind(m)}</span>
        </div>
        {rows.map(({ o, arm, question }, i) => {
          const orphan = !arm && !question;
          return [
            <div key={`${o}-door`} className={cn('flex min-w-0 items-center gap-1 rounded-lg border px-2 py-1.5',
              question ? 'border-dashed border-[var(--theme-warning)]' : orphan ? 'border-[var(--theme-warning)]' : i === 0 ? 'border-[var(--theme-success)]' : 'border-[var(--theme-border)]')}>
              {!question && !fixed && (i === 0
                ? <span className="text-[var(--theme-success)]" title="The way forward" aria-label="The way forward">★</span>
                : <button type="button" className="text-[var(--theme-text-muted)] hover:text-[var(--theme-success)]" title="Make it the way forward" aria-label={`Make ${o} the way forward`}
                    onClick={() => save([o, ...m.outcomes.filter((x) => x !== o)])}>☆</button>)}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{o}</span>
              {i === 0 && !question && <span className="fx-display text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-success)] @max-[700px]:hidden">way forward</span>}
              {question && <span className="fx-display text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-warning)]">built in</span>}
              {!question && !fixed && m.outcomes.length > 1 && (
                <button type="button" className="text-[var(--theme-text-muted)] hover:text-[var(--theme-danger)]" title="Take this outcome off" aria-label={`Remove ${o}`} onClick={() => save(m.outcomes.filter((x) => x !== o))}>×</button>
              )}
            </div>,
            arm ? (
              <button key={`${o}-wire`} type="button" title="Open this arm" onClick={() => onOpenMachine(arm.id)}
                className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]">
                <span aria-hidden className="h-0.5 min-w-3 flex-1 bg-[var(--theme-text-muted)]" /><FIcon name="arm" size={13} />
                <span className="truncate @max-[700px]:hidden">arm · {armTag(arm, takers) || 'anything'}</span>
                <span aria-hidden className="h-0.5 min-w-3 flex-1 bg-[var(--theme-text-muted)]" />
              </button>
            ) : (
              <div key={`${o}-wire`} className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--theme-warning)]">
                <span aria-hidden className="min-w-3 flex-1 border-t-2 border-dashed border-current" />
                <span className="truncate @max-[700px]:hidden">{question ? 'stays here until answered' : 'no arm'}</span>
                <span aria-hidden className="min-w-3 flex-1 border-t-2 border-dashed border-current" />
              </div>
            ),
            <Dest key={`${o}-dest`} arm={arm} question={question} />,
          ];
        })}
      </div>
      {fixed ? <Hint>Deduced from the script: not edited by hand.</Hint> : (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--theme-border-input)] p-2.5">
          <Input id="f-outcome-add" aria-label="Add an outcome" placeholder="Add an outcome: type a name, or pick one already used" value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(typed); } }} />
          {reserved ? <Hint tone="warning">question is built in: a ticket that asks a question stays here.</Hint> : (hints.length > 0 || fresh) && (
            <div className="flex flex-col gap-1.5">
              {hints.length > 0 && <span className="text-[11px] text-[var(--theme-text-muted)]">Already used on the floor: same name, same meaning everywhere</span>}
              <div className="flex flex-wrap gap-1.5">
                {hints.map((h) => (
                  <button key={h.name} type="button" onClick={() => add(h.name)} className="flex items-center gap-1.5 rounded-full border border-[var(--theme-border-input)] px-2 py-0.5 text-xs hover:border-[var(--mc)]">
                    <span className="font-mono">+ {h.name}</span><span className="text-[10.5px] text-[var(--theme-text-muted)]">{h.stations} station{h.stations === 1 ? '' : 's'}</span>
                  </button>
                ))}
                {fresh && (
                  <button type="button" onClick={() => add(typed)} className="flex items-center gap-1.5 rounded-full border border-dashed border-[var(--theme-border-input)] px-2 py-0.5 text-xs hover:border-[var(--mc)]">
                    <span className="font-mono">+ {norm}</span><span className="text-[10.5px] text-[var(--theme-text-muted)]">new name · Enter</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <Hint>An outcome leaves through the arm that asks for it (a condition on the outcome); an arm with no condition takes the rest. With no arm, the ticket stays here, done, until an arm takes it or you set it aside.</Hint>
    </div>
  );
}

/** A gate: its name, its places, its doors, and the arms it leaves through. */
function SetupGate({ m, tickets, takers, view, onPatch, onOpenMachine }: { m: StationSpec; tickets: FactoryTicket[]; takers: ArmSpec[]; view: FactoryView; onPatch: Patch; onOpenMachine: (id: string) => void }) {
  return (
    <Columns wide="right">
      <Card>
        <SectionHead icon="gate">Setup</SectionHead>
        <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />
        <Places m={m} tickets={tickets} onPatch={onPatch} />
        <SizeField m={m} onPatch={onPatch} />
        <Takers m={m} takers={takers} onOpenMachine={onOpenMachine} />
      </Card>
      <Card><Doors m={m} takers={takers} view={view} onPatch={onPatch} onOpenMachine={onOpenMachine} /></Card>
    </Columns>
  );
}

/** A zone: every field it has, in two columns. */
function SetupZone({ m, takers, onPatch, onOpenMachine }: { m: ZoneSpec; takers: ArmSpec[]; onPatch: Patch; onOpenMachine: (id: string) => void }) {
  return (
    <Columns>
      <Card>
        <SectionHead icon={machineIcon(m)}>Setup</SectionHead>
        <CommitInput id="f-name" label="Name" value={m.name ?? ''} onCommit={(v) => onPatch({ name: v })} />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={m.inbound === true} onChange={(e) => onPatch({ inbound: e.target.checked })} className="accent-[var(--theme-accent)]" />
          Tickets handed over land here (Inbound)
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={m.needsYou === true} onChange={(e) => onPatch({ needsYou: e.target.checked || undefined })} className="mt-0.5 accent-[var(--theme-accent)]" />
          <span>Its tickets wait for me<span className="block text-[var(--theme-text-muted)]">They are listed under Needs you, top left, for as long as they stay here. N goes to them.</span></span>
        </label>
        <Hint>{m.inbound ? 'Inbound: every ticket you hand over lands here and waits. Drag it onto a belt or a machine to start it.' : 'Tickets wait here. An arm only takes a ticket that has been released.'}</Hint>
      </Card>
      <Card>
        <SectionHead icon="exit">Tickets leave</SectionHead>
        <Select id="f-status" label="Sets the ticket status to" value={m.status ?? ''} onChange={(e) => onPatch({ status: e.target.value as TicketStatus | '' })} options={STATUS_OPTIONS} />
        <Select id="f-release" label="Tickets leave" value={m.release} onChange={(e) => onPatch({ release: e.target.value as 'manual' | 'auto' })}
          options={[{ value: 'manual', label: 'when you release them' }, { value: 'auto', label: 'automatically, one at a time' }]} />
        {m.release === 'auto' && m.status === 'todo' && <CommitInput id="f-limit" label="Stop releasing above this many tickets in doing or reviewing" value={String(m.limit ?? 12)} onCommit={(v) => onPatch({ limit: Math.max(1, Number(v) || 12) })} />}
        <div className="grid grid-cols-2 gap-2">
          <CommitInput id="f-w" label="Width" value={String(m.w)} onCommit={(v) => onPatch({ w: Math.max(1, Math.min(30, Number(v) || m.w)) })} />
          <CommitInput id="f-h" label="Height" value={String(m.h)} onCommit={(v) => onPatch({ h: Math.max(1, Math.min(30, Number(v) || m.h)) })} />
        </div>
        <Takers m={m} takers={takers} onOpenMachine={onOpenMachine} />
      </Card>
    </Columns>
  );
}

/* ------------------------------------------------------------------ activity */

/** A half-dial with a needle, over a fixed scale; amber from two thirds of it. */
function Dial({ label, ms, max, warn }: { label: string; ms: number | null; max: number; warn?: boolean }) {
  const f = ms == null ? 0 : Math.min(1, Math.max(0, ms / max)), a = Math.PI * (1 - f), tone = warn || f >= 2 / 3 ? 'var(--theme-warning)' : 'var(--theme-success)';
  return (
    <Gauge label={label} value={span(ms)}>
      <svg viewBox="0 0 100 56" className="h-14 w-full" role="img" aria-label={`${label}: ${span(ms)}`}>
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="var(--theme-bg-overlay)" strokeWidth="7" strokeLinecap="round" />
        {f > 0 && <path d={`M8 50 A42 42 0 0 1 ${50 + 42 * Math.cos(a)} ${50 - 42 * Math.sin(a)}`} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" />}
        <line x1="50" y1="50" x2={50 + 34 * Math.cos(a)} y2={50 - 34 * Math.sin(a)} stroke="var(--theme-text-primary)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3.5" fill="var(--theme-text-primary)" />
      </svg>
    </Gauge>
  );
}
const Gauge = ({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-[var(--theme-border)] p-2">
    {children}
    <span className="font-mono text-base tabular-nums">{value}</span>
    <span className="fx-display text-[9.5px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{label}</span>
    {sub && <span className="text-[10.5px] text-[var(--theme-text-muted)]">{sub}</span>}
  </div>
);
const LampTile = ({ label, value, on, tone }: { label: string; value: ReactNode; on: boolean; tone: string }) => (
  <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5" style={on ? { borderColor: `color-mix(in srgb, ${tone} 50%, transparent)` } : undefined}>
    <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={on ? { background: tone, boxShadow: `0 0 6px ${tone}` } : { background: 'var(--theme-bg-overlay)' }} />
    <span className="fx-display min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{label}</span>
    <span className="font-mono text-sm tabular-nums" style={on ? { color: tone } : undefined}>{value}</span>
  </div>
);

/** The runs of the period as tokens on a belt, coloured by how they ended, with a legend. */
function OutcomeBelt({ s, order }: { s: MachineStats; order: string[] }) {
  const counts = Object.entries(s.outcomes);
  if (s.failed && !s.outcomes.failed) counts.push(['failed', s.failed]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (!total) return <Hint>Nothing ran here over this period.</Hint>;
  const colour = (o: string) => (o === 'failed' ? 'var(--theme-danger)' : order.indexOf(o) === 0 ? 'var(--theme-success)' : order.indexOf(o) === 1 ? 'var(--theme-accent)' : 'var(--theme-text-muted)');
  /* at most 40 tokens, shared out as the runs are */
  const scale = Math.min(1, 40 / total), tokens = counts.flatMap(([o, c]) => Array.from({ length: Math.max(1, Math.round(c * scale)) }, () => o));
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const lane = tokens.map((o, i) => <span key={i} className="h-3.5 w-3.5 flex-none rounded-[4px]" style={{ background: colour(o) }} />);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="fx-belt-stripes overflow-hidden rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-1.5" role="img" aria-label={sorted.map(([o, c]) => `${o}: ${c}`).join(', ')}>
        <div className="fx-belt-run flex w-max gap-2 px-1">{lane}{lane.map((t, i) => <span key={`b${i}`} className="contents">{t}</span>)}</div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--theme-text-secondary)]">
        {sorted.map(([o, c]) => <span key={o} className="flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: colour(o) }} /><span className="font-mono text-[var(--theme-text-primary)]">{o}</span> {c} · {Math.round((c / total) * 100)}%</span>)}
      </div>
    </div>
  );
}

/** What a station (or a gate) did over the period, and its latest runs (decisions). */
function ActivityTab({ m, onOpenTicket }: { m: StationSpec; onOpenTicket: (ticketId: string) => void }) {
  const stats = useFactoryStore((s) => s.stats), days = useFactoryStore((s) => s.statsDays), snapshot = useFactoryStore((s) => s.snapshot);
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
  const titles = useMemo(() => {
    const out = new Map<string, string>();
    for (const t of known) out.set(t.id, `#${t.displayId} ${t.title}`);
    for (const t of snapshot?.tickets ?? []) if (t.info) out.set(t.ticketId, `${refOf(t.info)} ${t.info.title}`);
    return out;
  }, [known, snapshot]);
  const s = stats ? stats.machines.find((q) => q.machineId === m.id) ?? null : undefined;
  const dearest = stats ? Math.max(0, ...stats.machines.filter((q) => q.onFloor).map((q) => q.costUsd)) : 0;
  const hist = runs ? runBars(runs, days, now) : null, peak = hist ? Math.max(1, ...hist.bars) : 1;
  return (
    <Columns>
      <Card>
        <SectionHead icon="gauge" right={<PeriodSelect id="factory-machine-period" />}>What it did</SectionHead>
        {s === undefined ? (
          <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Gauge label={gate ? 'Decisions' : hist?.truncated ? 'Runs · latest 60' : 'Runs'} value={s?.runs ?? 0}>
                <div className="flex h-14 w-full items-end gap-px" role="img" aria-label={`${s?.runs ?? 0} ${gate ? 'decisions' : 'runs'} over ${periodLabel(days).toLowerCase()}`}>
                  {(hist?.bars ?? []).map((b, i, all) => (
                    <span key={i} className={cn('min-w-px flex-1 rounded-t-[2px]', b ? 'bg-[var(--mc)]' : 'bg-[var(--theme-bg-overlay)]')}
                      style={{ height: `${Math.max(6, (b / peak) * 100)}%`, boxShadow: i === all.length - 1 && b ? '0 0 6px var(--mc)' : undefined }} />
                  ))}
                </div>
              </Gauge>
              <Dial label={gate ? 'Avg decision' : 'Avg run'} ms={gate ? s?.avgHumanMs ?? null : s?.avgRunMs ?? null} max={gate ? 2 * 3_600_000 : 15 * 60_000} />
              {gate ? <Dial label="Human wait" ms={s?.humanMs ?? null} max={12 * 3_600_000} warn /> : (
                <Gauge label="Cost" value={money(s?.costUsd ?? 0)} sub={s?.runs ? `${money((s.costUsd ?? 0) / s.runs)}/run` : undefined}>
                  <div className="relative h-14 w-9 overflow-hidden rounded-md border-2 border-[var(--theme-border-input)]" role="img" aria-label={`Cost ${money(s?.costUsd ?? 0)}, against the dearest station of the floor`}>
                    <span className="absolute inset-x-0 bottom-0 bg-[var(--mc)] opacity-80" style={{ height: `${dearest ? ((s?.costUsd ?? 0) / dearest) * 100 : 0}%` }} />
                  </div>
                </Gauge>
              )}
            </div>
            {!gate && (
              <div className="grid grid-cols-3 gap-2 @max-[700px]:grid-cols-1">
                <LampTile label="Failed" value={s?.failed ?? 0} on={!!s?.failed} tone="var(--theme-danger)" />
                <LampTile label="Questions" value={s?.questions ?? 0} on={!!s?.questions} tone="var(--theme-warning)" />
                <LampTile label="Human wait" value={s?.humanWaits ? span(s.humanMs) : '–'} on={!!s?.humanWaits} tone="var(--theme-warning)" />
              </div>
            )}
            {s ? <OutcomeBelt s={s} order={m.outcomes} /> : <Hint>Nothing ran here over this period.</Hint>}
          </>
        )}
      </Card>
      <Card>
        <SectionHead icon="list">Latest {gate ? 'decisions' : 'runs'}</SectionHead>
        {runs === null ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          : runs.length === 0 ? <EmptyState icon="gauge" title="None yet." /> : (
          <ol className="flex flex-col">
            {runs.map((r) => {
              const bad = r.status === 'failed' || r.status === 'interrupted';
              return (
                <li key={r.id} className="border-t border-[var(--theme-border)] py-1.5 first:border-t-0">
                  <button type="button" onClick={() => onOpenTicket(r.ticketId)} className="flex w-full items-center gap-2 text-left text-xs">
                    <span aria-hidden className={cn('h-2 w-2 flex-none', bad ? 'rounded-[1px] bg-[var(--theme-danger)]' : 'rounded-full',
                      r.status === 'running' ? 'bg-[var(--theme-success)] shadow-[0_0_6px_var(--theme-success)]' : r.status === 'completed' ? 'bg-[var(--theme-success)] opacity-50' : !bad ? 'bg-[var(--theme-warning)]' : '')} />
                    <span className="min-w-0 flex-1 truncate hover:underline">{titles.get(r.ticketId) ?? (r.item ? `${SOURCE_LABEL[r.item.source] ?? r.item.source} · ${r.item.title}` : r.ticketId.slice(0, 8))}</span>
                    <span className={cn('flex-none font-mono', r.status === 'failed' ? 'font-semibold text-[var(--theme-danger)]' : 'text-[var(--theme-text-secondary)]')}>{r.outcome ?? (r.status === 'needs_review' ? 'waiting' : r.status)}</span>
                    <span className="flex-none font-mono text-[var(--theme-text-muted)]">{span(since(r.startedAt, r.finishedAt ?? now))}</span>
                  </button>
                  <div className="pl-4 text-[11px] text-[var(--theme-text-muted)]">{when(r.startedAt)}</div>
                  {r.error && <div className="whitespace-pre-wrap break-all pl-4 font-mono text-[11px] text-[var(--theme-danger)]">{r.error}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </Columns>
  );
}

/* ------------------------------------------------------------------ the popup */

/**
 * A station, a gate or a zone, opened from the floor: an identity plate (what it is, its lamp, what needs you, its
 * figures, its actions) over tabs, each a part of it: the tickets inside, its setup, where its outcomes leave, what it
 * did. The tab it opens on is the one that needs you, else the last one used for this kind of machine.
 */
export function FactoryMachineConsole({ m, view, onClose, onPatch, onRemove, onOpenTicket, onOpenMachine }: {
  m: Box; view: FactoryView; onClose: () => void; onPatch: Patch; onRemove: () => void;
  onOpenTicket: (ticketId: string) => void; onOpenMachine: (machineId: string) => void;
}) {
  const snapshot = useFactoryStore((s) => s.snapshot), stats = useFactoryStore((s) => s.stats), days = useFactoryStore((s) => s.statsDays), power = useFactoryStore((s) => s.power);
  const now = snapshot?.serverTime ?? new Date().toISOString(), halted = snapshot?.floor.settings.halted === true;
  const tickets = useMemo(() => (snapshot?.tickets ?? []).filter((t) => t.machineId === m.id).sort((a, b) => a.since.localeCompare(b.since)), [snapshot, m.id]);
  const takers = view.takersOf(m), family = familyOf(m), station = m.kind === 'station' ? m : null;
  const [tab, setTab] = useState<TabId>(() => openingTab(m, tickets));
  useEffect(() => { if (m.kind === 'station' && !useFactoryStore.getState().stats) void useFactoryStore.getState().loadStats(); }, [m.kind]);
  const change = useCallback((t: TabId) => {
    /* what is being typed is saved first, as when the field is left */
    const el = document.activeElement as HTMLElement | null;
    if (el && el.closest('.fx-console') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur();
    setTab(t); rememberTab(family, t);
  }, [family]);
  const ids = TABS[family], badges = badgesOf(m, tickets, takers);
  const onKey = useCallback((e: KeyboardEvent) => { const i = Number(e.key) - 1; if (Number.isInteger(i) && ids[i]) { e.preventDefault(); change(ids[i]!); } }, [ids, change]);
  const tabs: TabSpec[] = ids.map((id) => ({ id, ...TAB_LABEL[id], badge: badges[id] }));

  const lamp = lampOf(m, halted), mine = stats?.machines.find((q) => q.machineId === m.id) ?? null, period = periodLabel(days);
  const counters: Counter[] = !station
    ? [{ value: tickets.filter((t) => !t.released).length, label: 'held' }, { value: tickets.filter((t) => t.released).length, label: 'released' }]
    : station.exec === 'human_gate'
      ? [{ value: `${tickets.length}/${station.cap}`, label: 'inside' }, { value: mine?.runs ?? 0, label: 'decisions', title: period, loading: !stats }, { value: mine?.humanMs ? span(mine.humanMs) : '–', label: 'human wait', title: period, loading: !stats }]
      : [{ value: `${tickets.length}/${station.cap}`, label: 'inside' }, { value: mine?.runs ?? 0, label: 'runs', title: period, loading: !stats }, { value: money(mine?.costUsd ?? 0), label: 'cost', title: period, loading: !stats }];
  const switchable = !!station && RUNS.includes(station.exec);
  const plate = (
    <Plate icon={machineIcon(m)} name={m.name || machineKind(m)} kind={<>{machineKind(m)}{station?.ref ? <span className="font-mono"> · {station.ref}</span> : null}</>}
      lamp={lamp} needs={waitingOnYou(tickets)} counters={counters}
      actions={<>
        {switchable && station && (
          <Button size="sm" variant={station.off ? 'primary' : 'secondary'} onClick={() => void power(station.id, !!station.off)}
            title={station.off ? 'It starts on the tickets it holds' : 'It keeps taking tickets in and starts nothing on them; what runs finishes'}>
            <FIcon name={station.off ? 'play' : 'stop'} size={13} />{station.off ? 'Start' : 'Stop'}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => { onRemove(); onClose(); }} title="Remove this machine from the floor">
          <FIcon name="trash" size={13} /><span className="@max-[700px]:hidden">Remove</span>
        </Button>
        <CloseButton onClose={onClose} />
      </>} />
  );
  return (
    <FactoryConsolePopup label="Machine" colour={machineColour(m)} plate={plate} onClose={onClose} onKey={onKey} size="large"
      maxWidth={station ? 'max-w-[1080px]' : 'max-w-5xl'} tabs={<ConsoleTabs tabs={tabs} active={tab} onChange={change} idBase={`fx-${m.id}`} />}>
      <div id={`fx-${m.id}-panel`} role="tabpanel" aria-labelledby={`fx-${m.id}-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        {tab === 'inside' && <InsideTab m={m} tickets={tickets} now={now} onOpenTicket={onOpenTicket} />}
        {tab === 'setup' && (m.kind === 'zone'
          ? <SetupZone m={m} takers={takers} onPatch={onPatch} onOpenMachine={onOpenMachine} />
          : m.exec === 'human_gate' ? <SetupGate m={m} tickets={tickets} takers={takers} view={view} onPatch={onPatch} onOpenMachine={onOpenMachine} />
          : m.exec === 'script' ? <SetupScript m={m} onPatch={onPatch} />
          : <SetupRuns m={m} onPatch={onPatch} />)}
        {tab === 'routing' && station && (
          <Columns wide="left">
            <Card><Doors m={station} takers={takers} view={view} onPatch={onPatch} onOpenMachine={onOpenMachine} /></Card>
            <Card><Places m={station} tickets={tickets} onPatch={onPatch} />{takers.length > 0 && <Takers m={station} takers={takers} onOpenMachine={onOpenMachine} />}</Card>
          </Columns>
        )}
        {tab === 'activity' && station && <ActivityTab m={station} onOpenTicket={onOpenTicket} />}
      </div>
    </FactoryConsolePopup>
  );
}

