import { useEffect, useMemo, useState } from 'react';
import { TICKET_PRIORITIES, TICKET_TYPE_LABELS, TICKET_TYPES, type TicketStatus } from '@fleex/shared';
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
import { blankOp, choicesFor, incompleteOp, SET_FIELD_LABEL, SET_FIELDS, TAG_OP_HINT, TAG_OP_LABEL, type AnyField, type SetOp } from './setOps';
import { TAG_OPS, type TagOp } from './tags';
import { ANY_REPO, incompleteLine, scriptOf, scriptOutcomes, targetName, WORKSPACE, type ScriptLine, type ScriptSpec } from './script';
import { useSettingsStore } from '../stores/settingsStore';
import { arrivalOf, arrivalsOn, departuresOf, portName, portOwnColor } from './teleport';
import { FactoryPromptEditor } from './FactoryPromptEditor';
import { FactoryPopup } from './FactoryPopup';
import { MachineFigures, PeriodSelect } from './FactoryStatsBits';
import { TicketGlyphs, TicketToken } from './FactoryTicketMeta';
import { since, span } from './format';
import { FIcon } from './icons';
import { MAX_PLACES } from './layoutOps';
import { ITEM_SOURCES, refOf, SOURCE_LABEL } from './items';
import { COMMON_FIELDS, opsFor, PULLED_SOURCES, SOURCE_FIELDS, type SourceField } from './itemSources';
import { FactoryMailSetup, useMailStatus } from './FactoryMailSetup';
import { toast } from '../lib/toast';
import { canSetAside, LABEL_COLORS, needsHuman, PALETTE, QUESTION_OUTCOME, RUNS, SET_ASIDE, type AreaLabel, type ArmSpec, type DeskSpec, type Dir, type IntakeSpec, type ItemFields, type ItemRule, type FactoryRun, type FactoryTicket, type MachineSpec, type StationExec, type StationSpec, type TeleporterSpec } from './types';

const REFRESH_MS = 4000;
const STATUS_OPTIONS = [{ value: '', label: 'none' }, ...(['backlog', 'todo', 'doing', 'reviewing'] as TicketStatus[]).map((s) => ({ value: s, label: s }))];
const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'waiting to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'run failed', aside: 'set aside by you', out: 'done, waiting for an arm', zone: 'waiting', port: 'in the teleporter',
};
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], SIDE = ['East', 'South', 'West', 'North'];
/** Where an area's name can be written. */
const AREA_LABEL_OPTIONS: { value: AreaLabel; label: string }[] = [
  { value: 'tl', label: 'Top left, inside' }, { value: 'tr', label: 'Top right, inside' }, { value: 'bl', label: 'Bottom left, inside' }, { value: 'br', label: 'Bottom right, inside' },
  { value: 'above', label: 'Above it' }, { value: 'below', label: 'Below it' },
];
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/** What a machine is, in a word or two. */
export function machineKind(m: MachineSpec): string {
  if (m.kind === 'belt' && m.toll) return 'Toll';
  if (m.kind === 'belt' && m.set !== undefined) return 'Set gantry';
  if (m.kind === 'station') return m.exec === 'human_gate' ? 'Gate' : m.exec === 'native' ? 'Status station' : `${m.exec[0]!.toUpperCase()}${m.exec.slice(1)} station`;
  if (m.kind === 'teleporter') return m.role === 'arrival' ? 'Arrival teleporter' : 'Departure teleporter';
  if (m.kind === 'intake') return `${SOURCE_LABEL[m.source]} intake`;
  return m.kind === 'zone' && m.inbound ? 'Inbound zone' : `${m.kind[0]!.toUpperCase()}${m.kind.slice(1)}`;
}
export const machineIcon = (m: MachineSpec): string => (m.kind === 'belt' && m.toll ? 'toll' : m.kind === 'belt' && m.set !== undefined ? 'set' : m.kind === 'station' ? (m.exec === 'human_gate' ? 'gate' : m.exec) : m.kind === 'zone' && m.inbound ? 'inbound' : m.kind);

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
 * The colour of a machine that can be given one (an arm, a teleporter): its own unless one of the sixteen is picked.
 * `own` is what "Automatic" gives it, `ownTitle` says why.
 */
function ColourPicker({ label, value, own, ownTitle, hint, onChange }: { label: string; value: string | undefined; own: string; ownTitle: string; hint: string; onChange: (color: string | undefined) => void }) {
  const auto = !value, ring = (on: boolean) => (on ? 'border-[var(--theme-text-primary)]' : 'border-transparent');
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Colour</span>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={auto} title={ownTitle} onClick={() => onChange(undefined)}
          className={cn('flex h-6 items-center gap-1.5 rounded-full border-2 bg-[var(--theme-bg-overlay)] px-2 text-[11px] text-[var(--theme-text-secondary)]', ring(auto))}>
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: own }} />
          Automatic
        </button>
        {PALETTE.map((c) => (
          <button key={c.hex} type="button" role="radio" aria-checked={value === c.hex} aria-label={c.name} title={c.name} onClick={() => onChange(c.hex)}
            className={cn('h-6 w-6 rounded-full border-2', ring(value === c.hex))} style={{ background: c.hex }} />
        ))}
      </div>
      <Hint>{hint}</Hint>
    </div>
  );
}
/**
 * The colour of an arm. Left to itself it is grey, and amber once it has a condition; one of the sixteen can be
 * picked instead, to tell at a glance the arm that takes what failed from the one that takes what passed.
 */
const ArmColour = ({ arm, onChange }: { arm: ArmSpec; onChange: (color: string | undefined) => void }) => (
  <ColourPicker label="Arm colour" value={arm.color} own={isConditional(arm) ? 'var(--theme-warning)' : 'var(--theme-text-secondary)'} ownTitle="Grey, and amber once the arm has a condition"
    hint="Its quay, the arrow under it and its tag take the same colour." onChange={onChange} />
);

/**
 * A Set gantry: the list of what it does to every ticket that goes under it, in order. An operation that has nothing
 * to set yet stays in this form only: the floor is saved with the complete ones.
 */
function GantrySettings({ ops, toll, onChange, onRemove, children }: { ops: SetOp[]; toll: boolean; onChange: (ops: SetOp[]) => void; onRemove: () => void; children?: React.ReactNode }) {
  const boards = useTicketStore((s) => s.boards), list = useMemo(() => boards.map((b) => ({ id: b.id, name: b.name })), [boards]);
  const savedKey = JSON.stringify(ops);
  const [rows, setRows] = useState<SetOp[]>(ops), [adding, setAdding] = useState<AnyField>('tag');
  useEffect(() => { setRows((cur) => (JSON.stringify(cur.filter((o) => !incompleteOp(o))) === savedKey ? cur : (JSON.parse(savedKey) as SetOp[]))); }, [savedKey]);
  const commit = (next: SetOp[]) => { setRows(next); const complete = next.filter((o) => !incompleteOp(o)); if (JSON.stringify(complete) !== savedKey) onChange(complete); };
  const patch = (i: number, o: SetOp) => commit(rows.map((r, k) => (k === i ? o : r)));
  return (
    <>
      <Hint>{toll
        ? 'A toll: a gantry over a belt, with an arm of its own. It sets things on every ticket that goes under it, then takes off the belt the ones it rejects. No agent runs here.'
        : 'A gantry over a belt. A ticket goes under it without leaving the line: it stops the time it takes to write these changes on it, then goes on. No agent runs here.'}</Hint>
      <div className="text-xs font-medium text-[var(--theme-text-secondary)]">On every ticket, in this order</div>
      {rows.length === 0 && <Hint>Nothing yet: tickets go under it unchanged.</Hint>}
      {rows.map((o, i) => {
        const choices = choicesFor(o.field, list);
        return (
          <div key={i} className="flex items-center gap-1.5" role="group" aria-label={`Operation ${i + 1}`}>
            <span className="w-20 flex-none text-xs text-[var(--theme-text-primary)]">{SET_FIELD_LABEL[o.field]}</span>
            {o.field === 'tag' && (
              <div className="w-36 flex-none"><Select id={`f-set-op-${i}`} aria-label="What to do with the tag" value={o.op} onChange={(e) => patch(i, { ...o, op: e.target.value as TagOp })} options={TAG_OPS.map((t) => ({ value: t, label: TAG_OP_LABEL[t] }))} /></div>
            )}
            <div className="min-w-0 flex-1">
              {choices
                ? <Select id={`f-set-value-${i}`} aria-label={`${SET_FIELD_LABEL[o.field]} to set`} value={o.value} onChange={(e) => patch(i, { ...o, value: e.target.value })} options={[...choices, ...(o.value && !choices.some((c) => c.value === o.value) ? [{ value: o.value, label: o.value }] : [])]} />
                : <CommitInput id={`f-set-value-${i}`} label="" value={o.value} placeholder={o.field === 'tag' ? TAG_OP_HINT[o.op] : ''} onCommit={(v) => patch(i, { ...o, value: v.trim() })} />}
            </div>
            <Button size="sm" variant="ghost" aria-label={`Remove operation ${i + 1}`} title="Remove this operation" onClick={() => commit(rows.filter((_, k) => k !== i))}>×</Button>
          </div>
        );
      })}
      {rows.some((o) => incompleteOp(o)) && <p className="text-xs text-[var(--theme-warning)]">An operation with nothing to set is not applied. A value to set on a key is written key:value.</p>}
      <div className="flex items-center gap-1.5">
        <div className="w-36"><Select id="f-set-add" aria-label="Field to set" value={adding} onChange={(e) => setAdding(e.target.value as AnyField)} options={SET_FIELDS.map((f) => ({ value: f, label: SET_FIELD_LABEL[f] }))} /></div>
        <Button size="sm" onClick={() => commit([...rows, blankOp(adding, list)])}>Add an operation</Button>
      </div>
      <Hint>A tag written key:value has one value per key: "set" replaces it, "add 1" counts on it from nothing, "remove key" clears it. An arm can then sort on that value.</Hint>
      {children}
      <div><Button size="sm" variant="ghost" onClick={onRemove} title="The belt stays, without it">{toll ? 'Remove the toll' : 'Remove the gantry'}</Button></div>
    </>
  );
}

/**
 * A script station: an optional default action, lines of its own (for a repository, for any repository, or for the
 * ticket's workspace), and what it concludes when it has nothing to run for a repository. A line with no command yet
 * stays in this form only.
 */
function ScriptSettings({ script, onChange }: { script: ScriptSpec | undefined; onChange: (s: ScriptSpec) => void }) {
  const named = useSettingsStore((s) => s.settings.namedActions) ?? [], repos = useSettingsStore((s) => s.settings.resolvedRepositories ?? s.settings.repositories) ?? [];
  const saved = scriptOf(script), savedKey = JSON.stringify(saved.lines);
  const [rows, setRows] = useState<ScriptLine[]>(saved.lines), [target, setTarget] = useState(ANY_REPO);
  useEffect(() => { setRows((cur) => (JSON.stringify(cur.filter((l) => !incompleteLine(l))) === savedKey ? cur : (JSON.parse(savedKey) as ScriptLine[]))); }, [savedKey]);
  const put = (patch: Partial<ScriptSpec>) => onChange({ ...saved, ...patch });
  const commit = (next: ScriptLine[]) => { setRows(next); const complete = next.filter((l) => !incompleteLine(l)); if (JSON.stringify(complete) !== savedKey) put({ lines: complete }); };
  const line = (i: number, l: ScriptLine) => commit(rows.map((r, k) => (k === i ? l : r)));
  const free = [ANY_REPO, WORKSPACE, ...repos].filter((t) => !rows.some((r) => r.target === t));
  const pick = free.includes(target) ? target : free[0] ?? '';
  return (
    <>
      <Hint>Runs shell commands when a ticket or an item arrives: in each of the ticket's worktrees, or in its workspace (for an item, a folder of its own: only the workspace lines run). No agent runs here. It ends "ok" when every command exits with 0, "ko" when one does not; on an item, what the commands printed is the station's answer.</Hint>
      <Select id="f-script-action" label="Default action" value={saved.action ?? ''} onChange={(e) => put({ action: e.target.value || undefined })}
        options={[{ value: '', label: 'none' }, ...named.map((a) => ({ value: a.name, label: a.name })), ...(saved.action && !named.some((a) => a.name === saved.action) ? [{ value: saved.action, label: `${saved.action} (no longer in the list)` }] : [])]} />
      <Hint>{saved.action ? `Each repository of the ticket runs its own "${saved.action}", unless a line below says otherwise.` : 'With none, only the lines below are run.'}{named.length === 0 ? ' Named actions are created in Settings, under General, then filled in repository by repository.' : ''}</Hint>
      <div className="text-xs font-medium text-[var(--theme-text-secondary)]">Lines of this station</div>
      {rows.length === 0 && <Hint>None.</Hint>}
      {rows.map((l, i) => (
        <div key={l.target} className="flex flex-col gap-1.5 rounded-md border border-[var(--theme-border)] p-2" role="group" aria-label={`Line for ${targetName(l.target)}`}>
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--theme-text-primary)]">{targetName(l.target)}</span>
            {l.target !== WORKSPACE && (
              <div className="w-36 flex-none"><Select id={`f-script-kind-${i}`} aria-label="What it runs" value={l.kind} onChange={(e) => line(i, { ...l, kind: e.target.value as ScriptLine['kind'], value: '' })} options={[{ value: 'command', label: 'a command' }, { value: 'action', label: 'a named action' }]} /></div>
            )}
            <Button size="sm" variant="ghost" aria-label={`Remove the line for ${targetName(l.target)}`} onClick={() => commit(rows.filter((_, k) => k !== i))}>×</Button>
          </div>
          {l.kind === 'action'
            ? <Select id={`f-script-value-${i}`} aria-label="Named action" value={l.value} onChange={(e) => line(i, { ...l, value: e.target.value })} options={[{ value: '', label: 'choose' }, ...named.map((a) => ({ value: a.name, label: a.name })), ...(l.value && !named.some((a) => a.name === l.value) ? [{ value: l.value, label: l.value }] : [])]} />
            : <CommitInput id={`f-script-value-${i}`} label="" placeholder={l.target === WORKSPACE ? 'a command, run once in the workspace of the ticket' : 'a command, run in the worktree'} value={l.value} onCommit={(v) => line(i, { ...l, value: v.trim() })} />}
        </div>
      ))}
      {free.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1"><Select id="f-script-target" aria-label="What the line is for" value={pick} onChange={(e) => setTarget(e.target.value)} options={free.map((t) => ({ value: t, label: targetName(t) }))} /></div>
          <Button size="sm" onClick={() => commit([...rows, { target: pick, kind: 'command', value: '' }])}>Add a line</Button>
        </div>
      )}
      <Select id="f-script-missing" label="A repository it has nothing to run for" value={saved.missing} onChange={(e) => put({ missing: e.target.value as ScriptSpec['missing'] })}
        options={[{ value: 'ignore', label: 'is skipped' }, { value: 'ko', label: 'counts as a failure' }, { value: 'own', label: 'sends the ticket out by "unconfigured"' }]} />
      <div className="grid grid-cols-2 gap-2">
        <Select id="f-script-fail" label="After a command fails" value={saved.onFail} onChange={(e) => put({ onFail: e.target.value as ScriptSpec['onFail'] })} options={[{ value: 'all', label: 'run the others anyway' }, { value: 'stop', label: 'stop there' }]} />
        <CommitInput id="f-script-timeout" label="Time allowed per command (seconds)" value={String(saved.timeoutSec ?? 300)} onCommit={(v) => put({ timeoutSec: Math.max(1, Math.min(1800, Math.floor(Number(v)) || 300)) })} />
      </div>
      <Hint>A command gets the ticket in its environment: FLEEX_TICKET_NUMBER, FLEEX_TICKET_TITLE, FLEEX_TICKET_ID, FLEEX_REPO, FLEEX_WORKSPACE.</Hint>
      <Hint>Or the item: FLEEX_ITEM_KEY (its key in its source: a Gmail thread id), FLEEX_ITEM_SOURCE, FLEEX_ITEM_TITLE, FLEEX_ITEM_AUTHOR, FLEEX_ITEM_URL, FLEEX_ITEM_TAGS, FLEEX_ITEM_ID, each field of its source as FLEEX_ITEM_FIELD_&lt;NAME&gt; (FLEEX_ITEM_FIELD_LABELS…), and the whole item as FLEEX_ITEM_JSON. Quote them: a mail's subject is written by anyone. Example: <span className="font-mono">gog gmail archive "$FLEEX_ITEM_KEY"</span></Hint>
    </>
  );
}

const QUIET = [0, 30, 60, 120, 300, 600, 1800, 3600];
const quietLabel = (s: number) => (s === 0 ? 'at once' : s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);
const OP_LABEL: Record<ItemRule['op'], string> = { contains: 'contains', is: 'is', is_not: 'is not' };

/**
 * Rules on some of an intake's fields (the common ones, or its source's): each a way (drop if, keep only if), a field,
 * an operator that suits it and a value, a list of choices or yes and no where the field has them.
 */
function RuleList({ id, rules, fields, onChange }: { id: string; rules: ItemRule[]; fields: readonly SourceField[]; onChange: (rules: ItemRule[]) => void }) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const set = (i: number, patch: Partial<ItemRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  /* a new rule has no value yet: it decides nothing until it has one */
  const blank = (f: SourceField): ItemRule => ({ field: f.key, op: opsFor(f.kind)[0]!, value: f.kind === 'bool' ? 'yes' : f.kind === 'choice' ? f.choices![0]! : '' });
  return (
    <>
      {rules.map((r, i) => {
        const f = byKey.get(r.field) ?? fields[0]!;
        return (
          <div key={i} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,8rem)_minmax(0,6rem)_minmax(0,1fr)_auto] items-end gap-1.5">
            <Select id={`${id}-${i}-way`} label={i === 0 ? 'Way' : ''} value={r.keep ? 'keep' : 'drop'} onChange={(e) => set(i, { keep: e.target.value === 'keep' || undefined })}
              options={[{ value: 'drop', label: 'Drop if' }, { value: 'keep', label: 'Keep only if' }]} />
            <Select id={`${id}-${i}-field`} label={i === 0 ? 'Field' : ''} value={f.key} onChange={(e) => set(i, blank(byKey.get(e.target.value)!))}
              options={fields.map((x) => ({ value: x.key, label: x.label }))} />
            <Select id={`${id}-${i}-op`} label={i === 0 ? 'Operator' : ''} value={r.op} onChange={(e) => set(i, { op: e.target.value as ItemRule['op'] })}
              options={opsFor(f.kind).map((o) => ({ value: o, label: OP_LABEL[o] }))} />
            {f.kind === 'bool' ? (
              <Select id={`${id}-${i}-value`} label={i === 0 ? 'Value' : ''} value={r.value} onChange={(e) => set(i, { value: e.target.value })} options={[{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }]} />
            ) : f.kind === 'choice' && !r.value.includes(',') ? (
              <Select id={`${id}-${i}-value`} label={i === 0 ? 'Value' : ''} value={r.value} onChange={(e) => set(i, { value: e.target.value })} options={f.choices!.map((c) => ({ value: c, label: c }))} />
            ) : (
              <CommitInput id={`${id}-${i}-value`} label={i === 0 ? 'Value' : ''} value={r.value} placeholder={f.hint ?? (r.op === 'contains' ? 'newsletter, noreply@…' : 'one, or several separated by commas')}
                onCommit={(v) => set(i, { value: v })} />
            )}
            <Button size="sm" variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))} title="Remove this rule">Remove</Button>
          </div>
        );
      })}
      <div><Button size="sm" onClick={() => onChange([...rules, blank(fields[0]!)])}>Add a rule</Button></div>
    </>
  );
}

/**
 * An intake, in two parts. What every intake has, whatever its source: a name, its source, how long an item must have
 * been quiet before it leaves. Then what only its source has: rules on that source's own fields (a Slack channel,
 * Gmail labels, a GitHub repository), which its connector fills; what every item has (who it is from, its title, its
 * text) is too broad to filter on. A drop rule drops what it matches; keep rules let in only what one of them matches;
 * what is dropped never reaches the floor. Making an item by hand has its popup of its own (New item).
 */
const EVERY = [60, 300, 900, 1800, 3600];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * The order the intakes of a source are served in, when several see the same item: this one's place, and a move one
 * place earlier or later (the two swap, in one layout save). An item waiting on the dock of an intake served later is
 * taken over by one served first that sees it too; once an arm took it out, it stays on its lane.
 */
function IntakeOrder({ m, onSelect }: { m: IntakeSpec; onSelect: (machineId: string) => void }) {
  const layout = useFactoryStore((s) => s.layout);
  const peers = (layout?.machines ?? []).filter((q): q is IntakeSpec => q.kind === 'intake' && q.source === m.source).sort((a, b) => (a.priority ?? 1e9) - (b.priority ?? 1e9));
  if (peers.length < 2) return null;
  const i = peers.findIndex((q) => q.id === m.id), source = SOURCE_LABEL[m.source];
  const swap = (j: number) => {
    if (!layout || j < 0 || j >= peers.length) return;
    const a = peers[i]!, b = peers[j]!, pa = a.priority ?? i + 1, pb = b.priority ?? j + 1;
    void useFactoryStore.getState().setLayout({ ...layout, machines: layout.machines.map((q) => (q.id === a.id ? { ...q, priority: pb } : q.id === b.id ? { ...q, priority: pa } : q)) as MachineSpec[] });
  };
  return (
    <>
      <Head right={<span className="flex gap-1"><Button size="sm" variant="secondary" disabled={i === 0} onClick={() => swap(i - 1)} title="Served one place earlier">Earlier</Button><Button size="sm" variant="secondary" disabled={i === peers.length - 1} onClick={() => swap(i + 1)} title="Served one place later">Later</Button></span>}>
        Served {ordinal(i + 1)} of {peers.length} {source} intakes
      </Head>
      <Hint>One {source} conversation is one item. When several intakes see it, the one served first keeps it: while it waits on the dock of one served later, one served earlier takes it over. Once an arm took it out, it stays on its lane.</Hint>
      <ol className="flex flex-col gap-0.5 text-xs">
        {peers.map((q, k) => (
          <li key={q.id}>
            <button type="button" disabled={q.id === m.id} onClick={() => onSelect(q.id)} className={cn('text-left', q.id === m.id ? 'font-semibold text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)] hover:underline')}>
              {k + 1}. {q.name || `${source} intake`}{q.query ? <span className="font-mono text-[var(--theme-text-muted)]"> · {q.query}</span> : null}
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** A pulled intake's own part (Gmail): gogcli, its search, how often it is run, its last pull, and a pull now. */
function PulledSettings({ m, onPatch }: { m: IntakeSpec; onPatch: (patch: Partial<MachineSpec>) => void }) {
  const pulled = PULLED_SOURCES[m.source]!, state = useFactoryStore((s) => s.snapshot?.intakes?.[m.id]), now = useFactoryStore((s) => s.snapshot?.serverTime);
  const mail = useMailStatus(), [pulling, setPulling] = useState(false), every = m.everySec ?? pulled.everySec;
  const pull = async () => {
    setPulling(true);
    try {
      const r = await useFactoryStore.getState().pullIntake(m.id);
      if (!r) return;
      if (r.error) toast.error('The pull failed', { detail: r.error });
      else if (!state?.pulledAt) toast.info('Pulls from now on: what was in the mailbox before stays there');
      else toast.success(r.pulled ? `${r.pulled} message${r.pulled === 1 ? '' : 's'}: ${r.new} new, ${r.updated} updated${r.moved ? `, ${r.moved} taken over` : ''}` : 'Nothing new');
    } finally { setPulling(false); }
  };
  const ago = state?.pulledAt ? span(Math.max(0, Date.parse(now ?? new Date().toISOString()) - Date.parse(state.pulledAt))) : null;
  return (
    <>
      <FactoryMailSetup mail={mail} />
      <div className="flex flex-col gap-1">
        <CommitInput id="f-intake-query" label={pulled.query} value={m.query ?? ''} placeholder="everything that comes in" onCommit={(v) => onPatch({ query: v.trim().slice(0, 1000) } as Partial<MachineSpec>)} />
        <Hint>{pulled.hint}. It is the filter: only what it finds comes in. Empty: every message.</Hint>
      </div>
      <Select id="f-intake-every" label="Pulls every" value={String(every)} onChange={(e) => onPatch({ everySec: Number(e.target.value) } as Partial<MachineSpec>)}
        options={[...new Set([...EVERY, every])].sort((a, b) => a - b).map((s) => ({ value: String(s), label: quietLabel(s) }))} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={state?.pullError ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-muted)]'} title={state?.pullError ?? undefined}>
          {state?.pullError ? `Last pull failed: ${state.pullError}` : ago ? `Last pull ${ago} ago` : 'Not pulled yet: it starts from the first pull'}
        </span>
        <Button size="sm" disabled={pulling} onClick={() => void pull()} title="Ask the mailbox now, without waiting for the interval">{pulling ? 'Pulling…' : 'Pull now'}</Button>
      </div>
    </>
  );
}

function IntakeSettings({ m, onPatch, takers, onSelect, onNewItem }: { m: IntakeSpec; onPatch: (patch: Partial<MachineSpec>) => void; takers: ArmSpec[]; onSelect: (machineId: string) => void; onNewItem?: (intakeId: string) => void }) {
  const quiet = m.quietSec ?? 120, dropped = useFactoryStore((s) => s.snapshot?.intakes?.[m.id]?.dropped ?? 0);
  const own = SOURCE_FIELDS[m.source], source = SOURCE_LABEL[m.source], ownKeys = new Set(own.map((f) => f.key)), pulled = !!PULLED_SOURCES[m.source];
  const rules = (m.rules ?? []).filter((r) => ownKeys.has(r.field));
  return (
    <>
      <Hint>{pulled
        ? `Where ${source} items come in: Fleex asks ${source} for what came since its last pull, with the search below. An item waits here while its conversation moves, and leaves once it has been quiet for the delay below: an arm then takes it.`
        : 'Where items of one source come in. An item waits here while it moves, and leaves once it has been quiet for the delay below: an arm then takes it. With several intakes of one source, an item goes to the first served that lets it in. This source is not connected yet: items come in through POST /api/factory/items, or by hand (New item).'}</Hint>
      <Head right={pulled ? undefined : <span className="text-xs text-[var(--theme-text-muted)]">{dropped} dropped in 24 h</span>}>Every source</Head>
      <CommitInput id="f-name" label="Name" value={m.name ?? ''} placeholder={source} onCommit={(v) => onPatch({ name: v.trim().slice(0, 40) })} />
      <div className="grid grid-cols-2 gap-2">
        <Select id="f-intake-source" label="Source" value={m.source} onChange={(e) => onPatch({ source: e.target.value, rules: [], drop: undefined, query: undefined, everySec: undefined, priority: undefined } as Partial<MachineSpec>)}
          options={ITEM_SOURCES.map((s) => ({ value: s, label: PULLED_SOURCES[s] ? `${SOURCE_LABEL[s]} (gogcli)` : SOURCE_LABEL[s] }))} />
        <Select id="f-intake-quiet" label="Leaves once quiet for" value={String(quiet)} onChange={(e) => onPatch({ quietSec: Number(e.target.value) } as Partial<MachineSpec>)}
          options={[...new Set([...QUIET, quiet])].sort((a, b) => a - b).map((s) => ({ value: String(s), label: quietLabel(s) }))} />
      </div>
      <IntakeOrder m={m} onSelect={onSelect} />
      <Head>{source} only</Head>
      {pulled
        ? <PulledSettings key={m.id} m={m} onPatch={onPatch} />
        : own.length === 0
          ? <Hint>An item made by hand has nothing more than what every item has: everything comes in.</Hint>
          : <>
              <Hint>{own.map((f) => f.label).join(', ')}: what {source} says of an item, filled by its connector. No rule: everything comes in. A drop rule drops what it matches; keep rules let in only what one of them matches.</Hint>
              <RuleList id="f-own" rules={rules} fields={own} onChange={(next) => onPatch({ rules: next, drop: undefined } as Partial<MachineSpec>)} />
            </>}
      <Head>Leaves through {takers.length} arm{takers.length === 1 ? '' : 's'}</Head>
      {takers.length === 0 && <div className="text-xs text-[var(--theme-danger)]">No arm takes from here: items will pile up. Put an arm against one of its sides.</div>}
      {takers.map((a) => <button key={a.id} type="button" className="text-left text-xs text-[var(--theme-text-secondary)] hover:underline" title="Open this arm" onClick={() => onSelect(a.id)}>arm · {armTag(a, takers) || 'anything'}</button>)}
      {onNewItem && <div className="border-t border-[var(--theme-border)] pt-3"><Button size="sm" onClick={() => onNewItem(m.id)} title="Make an item of this source by hand, as its connector would send it">New item…</Button></div>}
    </>
  );
}

/**
 * A desk: its name, and what the creation form opened on it starts with (board, type, priority). Each can be changed
 * in the form; a "Bug desk" set to Fix and wired to a line of fixes routes what is created at it.
 */
function DeskSettings({ m, onPatch, takers, onSelect }: { m: DeskSpec; onPatch: (patch: Partial<MachineSpec>) => void; takers: ArmSpec[]; onSelect: (machineId: string) => void }) {
  const boards = useTicketStore((s) => s.boards), d = m.defaults ?? {};
  const set = (k: 'boardId' | 'type' | 'priority', v: string) => {
    const next = { ...d, [k]: v || undefined };
    for (const key of Object.keys(next) as (keyof typeof next)[]) if (!next[key]) delete next[key];
    onPatch({ defaults: Object.keys(next).length ? next : undefined } as Partial<MachineSpec>);
  };
  return (
    <>
      <Hint>Where tickets are born. New ticket on the command card (or a double-click on the desk) opens the creation form; the ticket it creates is handed over to the Factory here, and an arm takes it out at once.</Hint>
      <CommitInput id="f-name" label="Name" value={m.name ?? ''} placeholder="Desk" onCommit={(v) => onPatch({ name: v.trim().slice(0, 40) })} />
      <Head>The form starts with</Head>
      <Select id="f-desk-board" label="Board" value={d.boardId ?? ''} onChange={(e) => set('boardId', e.target.value)}
        options={[{ value: '', label: 'the first board' }, ...boards.map((b) => ({ value: b.id, label: b.name }))]} />
      <div className="grid grid-cols-2 gap-2">
        <Select id="f-desk-type" label="Type" value={d.type ?? ''} onChange={(e) => set('type', e.target.value)}
          options={[{ value: '', label: 'Build (the form\'s own)' }, ...TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_LABELS[t] ?? t }))]} />
        <Select id="f-desk-priority" label="Priority" value={d.priority ?? ''} onChange={(e) => set('priority', e.target.value)}
          options={[{ value: '', label: 'none (the form\'s own)' }, ...TICKET_PRIORITIES.filter((p) => p !== 'none').map((p) => ({ value: p, label: p }))]} />
      </div>
      <Head>Leaves through {takers.length} arm{takers.length === 1 ? '' : 's'}</Head>
      {takers.length === 0 && <div className="text-xs text-[var(--theme-danger)]">No arm takes from here: what is created stays in the desk. Put an arm against one of its sides.</div>}
      {takers.map((a) => <button key={a.id} type="button" className="text-left text-xs text-[var(--theme-text-secondary)] hover:underline" title="Open this arm" onClick={() => onSelect(a.id)}>arm · {armTag(a, takers) || 'anything'}</button>)}
    </>
  );
}

/**
 * A teleporter: its name, which of the two it is, and for a departure the arrival it leads to. An arrival has nothing
 * to point at: it lists the departures that lead to it, each of which opens. Either says what it holds.
 */
function TeleporterSettings({ m, onPatch, onSelect }: { m: TeleporterSpec; onPatch: (patch: Partial<MachineSpec>) => void; onSelect: (machineId: string) => void }) {
  const layout = useFactoryStore((s) => s.layout), tickets = useFactoryStore((s) => s.snapshot?.tickets);
  const machines = layout?.machines ?? [], find = (id: string) => machines.find((q) => q.id === id);
  const dep = m.role === 'departure', arrival = arrivalOf(m, find), arrivals = arrivalsOn(machines), leading = dep ? [] : departuresOf(m, machines);
  const held = tickets?.find((t) => t.machineId === m.id) ?? null, busy = !!arrival && !!tickets?.some((t) => t.machineId === arrival.id);
  return (
    <>
      <Hint>{dep
        ? 'A departure takes one ticket at a time, from an arm, a belt or your hand, and sends it to its destination as soon as that arrival is free.'
        : 'An arrival receives from its departures only, one ticket at a time: nothing on the floor can drop a ticket here. An arm takes the ticket out.'}</Hint>
      <CommitInput id="f-name" label="Name" value={m.name ?? ''} placeholder={dep ? 'Departure' : 'Arrival'} onCommit={(v) => onPatch({ name: v.trim().slice(0, 40) })} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Role</span>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Role">
          <Button size="sm" role="radio" aria-checked={dep} variant={dep ? 'primary' : 'secondary'} onClick={() => { if (!dep) onPatch({ role: 'departure' }); }}>Departure</Button>
          <Button size="sm" role="radio" aria-checked={!dep} variant={dep ? 'secondary' : 'primary'} onClick={() => { if (dep) onPatch({ role: 'arrival', to: undefined }); }}>Arrival</Button>
        </div>
      </div>
      {dep ? (
        <>
          <Select id="f-to" label="Destination" value={arrival?.id ?? ''} onChange={(e) => onPatch({ to: e.target.value || undefined })}
            options={[{ value: '', label: arrivals.length ? 'choose an arrival' : 'no arrival on the floor yet' }, ...arrivals.map((a) => ({ value: a.id, label: portName(a) }))]} />
          {arrival
            ? <Hint>{busy && held ? `${portName(arrival)} holds a ticket: this one keeps its own and waits.` : 'While that arrival holds a ticket, this one keeps its own and waits. The ticket that has waited longest goes first.'}</Hint>
            : <p className="text-xs text-[var(--theme-danger)]">No destination: it keeps the ticket it is given. Put an arrival on the floor, then choose it here.</p>}
          {arrival && <div><Button size="sm" onClick={() => onSelect(arrival.id)}>Open {portName(arrival)}</Button></div>}
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Departures that lead here</span>
          {leading.length === 0 ? <Hint>None yet: choose this arrival as the destination of a departure.</Hint> : (
            <div className="flex flex-wrap gap-1.5">{leading.map((d) => <Button key={d.id} size="sm" onClick={() => onSelect(d.id)}>{portName(d)}</Button>)}</div>
          )}
        </div>
      )}
      <ColourPicker label="Teleporter colour" value={m.color} own={portOwnColor(m, find)} ownTitle={dep ? 'The colour of its destination' : 'Cyan'}
        hint={dep ? 'Automatic: the colour of its destination, so the two read as a pair.' : 'Its departures take its colour unless they have their own.'} onChange={(color) => onPatch({ color })} />
      <Hint>{held ? `Holds ${refOf(held.info)} ${held.info?.title ?? ''}` : 'Holds nothing right now.'}</Hint>
    </>
  );
}
const Column = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('flex min-h-0 flex-col gap-3 overflow-y-auto p-4', className)}>{children}</div>;

/** Everything that is set on a machine. The same fields whatever opens them; they save as they are left. */
function Settings({ m, view, onPatch, onSelect, onNewItem }: { m: MachineSpec; view: FactoryView; onPatch: (patch: Partial<MachineSpec>) => void; onSelect: (machineId: string) => void; onNewItem?: (intakeId: string) => void }) {
  const layout = useFactoryStore((s) => s.layout)!;
  const [editing, setEditing] = useState(false);
  const personas = useAgentPersonaStore((s) => s.personas), skills = useSkillStore((s) => s.skills), panels = usePanelStore((s) => s.panels);
  const takers = view.takersOf(m);
  /* whose model the station runs on unless it chooses one: an agent's persona, or the persona a skill belongs to */
  const skill = m.kind === 'station' && m.exec === 'skill' ? skills.find((s) => s.commandName === m.ref) ?? null : null;
  const persona = m.kind === 'station' && m.exec === 'agent' ? personas.find((p) => p.name === m.ref) ?? null
    : skill ? personas.find((p) => p.id === skill.personaId) ?? null : null;
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
      {m.kind === 'area' && (
        <>
          <CommitInput id="f-area-name" label="Name" value={m.name} onCommit={(v) => onPatch({ name: v.trim() || 'Area' })} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Colour</span>
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Area colour">
              {PALETTE.map((c) => (
                <button key={c.hex} type="button" role="radio" aria-checked={m.color === c.hex} aria-label={c.name} title={c.name} onClick={() => onPatch({ color: c.hex })}
                  className={cn('h-6 w-6 rounded-full border-2', m.color === c.hex ? 'border-[var(--theme-text-primary)]' : 'border-transparent')} style={{ background: c.hex }} />
              ))}
            </div>
          </div>
          <Select id="f-area-label" label="Name written" value={m.label ?? 'bl'} onChange={(e) => onPatch({ label: e.target.value as AreaLabel })} options={AREA_LABEL_OPTIONS} />
          <Hint>{m.w} × {m.h} tiles. A part of the floor with a name: machines stand on it, nothing runs on it, and nothing links it to them. In build mode, drag its sides or corners to resize it and its name to move it; out of build mode it is decor.</Hint>
        </>
      )}
      {m.kind === 'belt' && m.set !== undefined && (
        <GantrySettings key={m.id} ops={m.set} toll={!!m.toll} onChange={(set) => onPatch({ set })} onRemove={() => onPatch({ set: undefined, toll: undefined })}>
          {m.toll && (
            <>
              <FactoryArmForm arm={{ id: m.id, kind: 'arm', x: m.x, y: m.y, w: 1, h: 1, dir: m.dir, when: m.toll.when }} view={view} layout={layout} heading="Then rejects the ticket when" any
                onChange={(when) => onPatch({ toll: { ...m.toll!, when } })} />
              <Select id="f-toll-out" label="Rejects to" value={String(m.toll.out)} onChange={(e) => onPatch({ toll: { ...m.toll!, out: Number(e.target.value) as Dir } })}
                options={[(m.dir + 1) % 4, (m.dir + 3) % 4].map((d) => ({ value: String(d), label: `${SIDE[d]!} · ${view.at(m.x + DX[d]!, m.y + DY[d]!)?.name ?? (view.at(m.x + DX[d]!, m.y + DY[d]!) ? 'a machine' : 'the floor')}` }))} />
              <Hint>Its own arm takes what is rejected off the belt, to the tile on that side. What is not rejected goes on along the belt. The operations above are applied first: with "add 1 to passes" and "passes above 3", a ticket goes round three times.</Hint>
            </>
          )}
        </GantrySettings>
      )}
      {m.kind === 'belt' && m.set === undefined && <Hint>One tile, one ticket. It pushes it to the tile it points at when that tile is free. Leads to: {view.leadsTo(m)?.name ?? 'nowhere'}.</Hint>}
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
      {m.kind === 'teleporter' && <TeleporterSettings m={m} onPatch={onPatch} onSelect={onSelect} />}
      {m.kind === 'intake' && <IntakeSettings m={m} onPatch={onPatch} takers={takers} onSelect={onSelect} onNewItem={onNewItem} />}
      {m.kind === 'desk' && <DeskSettings m={m} onPatch={onPatch} takers={takers} onSelect={onSelect} />}

      {m.kind === 'station' && (
        <>
          {m.exec === 'script' && <ScriptSettings key={m.id} script={m.script} onChange={(script) => onPatch({ script, outcomes: scriptOutcomes(script) } as Partial<StationSpec>)} />}
          {RUNS.includes(m.exec) && m.exec !== 'script' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select id="f-exec" label="Runs" value={m.exec} onChange={(e) => onPatch({ exec: e.target.value as StationExec, ref: '' } as Partial<StationSpec>)}
                  options={[{ value: 'agent', label: 'an agent (persona)' }, { value: 'skill', label: 'a skill' }, { value: 'panel', label: 'a panel' }]} />
                <Select id="f-ref" label={m.exec === 'agent' ? 'Persona' : m.exec === 'skill' ? 'Skill' : 'Panel'} value={m.ref ?? ''} onChange={(e) => onPatch({ ref: e.target.value } as Partial<StationSpec>)}
                  options={[{ value: '', label: 'choose' }, ...refs(m.exec, m.ref ?? '').map((r) => ({ value: r, label: r }))]} />
              </div>
              {!m.ref && <div className="text-xs text-[var(--theme-danger)]">Choose what this station runs: without it, every run fails.</div>}
              {(m.exec === 'agent' || m.exec === 'skill') && (
                <div className="grid grid-cols-2 gap-2">
                  {m.exec === 'agent' && <Select id="f-mode" label="Mode" value={m.mode ?? 'edit'} onChange={(e) => onPatch({ mode: e.target.value as 'talk' | 'plan' | 'edit' } as Partial<StationSpec>)}
                    options={[{ value: 'edit', label: 'edit (can change code)' }, { value: 'plan', label: 'plan' }, { value: 'talk', label: 'talk (no workspace)' }]} />}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--theme-text-secondary)]">Model</span>
                    <ModelSelect id="f-model" ariaLabel="Model this station runs on" value={m.model ?? ''} onChange={(v) => onPatch({ model: v || undefined } as Partial<StationSpec>)}
                      leadingOption={{ value: '', label: persona?.model ? `The persona's own (${persona.model})` : "The persona's own" }} />
                  </div>
                </div>
              )}
              {(m.exec === 'agent' || m.exec === 'skill') && m.model && <Hint>Runs on this model here, whatever {persona?.name || (m.exec === 'agent' && m.ref) || 'the persona'} is set to elsewhere.</Hint>}
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
          {m.exec !== 'native' && m.exec !== 'script' && <CommitInput id="f-outcomes" label="Outcomes, comma separated (the first is the way forward)" value={m.outcomes.join(', ')} onCommit={(v) => onPatch({ outcomes: list(v).length ? list(v) : ['ok'] } as Partial<StationSpec>)} />}
          <CommitInput id="f-cap" label="Places (tickets worked on at once)" value={String(m.cap)} onCommit={(v) => onPatch({ cap: Math.max(1, Math.min(RUNS.includes(m.exec) ? MAX_PLACES : 50, Number(v) || 2)) } as Partial<StationSpec>)} />
          <Head>Where each outcome leaves</Head>
          <div className="flex flex-col gap-1">
            {m.outcomes.map((o) => {
              const arm = takers.find((a) => acceptsOutcome(a, o)) ?? takers.find((a) => !isConditional(a)), dest = arm ? beyond(arm) : null;
              return <div key={o} className="flex justify-between gap-2 text-xs"><span className="font-mono text-[var(--theme-text-primary)]">{o}</span><span className={arm ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-danger)]'}>{arm ? `→ ${dest?.name ?? dest?.kind ?? 'the next tile'}` : 'no arm takes it'}</span></div>;
            })}
            {m.exec !== 'human_gate' && m.exec !== 'native' && m.exec !== 'script' && (() => {
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
                <div className="truncate text-xs font-medium text-[var(--theme-text-primary)] hover:underline"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">{refOf(t.info)}</span>{t.info?.title ?? t.ticketId}</div>
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
    for (const t of snapshot?.tickets ?? []) if (t.info) out.set(t.ticketId, `${refOf(t.info)} ${t.info.title}`);
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
                <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)] hover:underline">{titles.get(r.ticketId) ?? (r.item ? `${SOURCE_LABEL[r.item.source] ?? r.item.source} · ${r.item.title}` : r.ticketId.slice(0, 8))}</span>
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
 * tickets; an arm, an exit, a label or an area, which have only settings, a small popup. Everything a machine has to be set
 * is set here: the floor has no side panel.
 */
export function FactoryMachinePopup({ machineId, view, onClose, onPatch, onRemove, onOpenTicket, onOpenMachine, onNewItem }: {
  machineId: string; view: FactoryView; onClose: () => void; onPatch: (id: string, patch: Partial<MachineSpec>) => void; onRemove: (id: string) => void;
  onOpenTicket: (ticketId: string) => void; onOpenMachine: (machineId: string) => void;
  /** An intake's popup opens the one that makes an item by hand. */
  onNewItem?: (intakeId: string) => void;
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
      <Button size="sm" variant="ghost" onClick={() => { onRemove(m.id); onClose(); }} title={m.kind === 'area' ? 'Remove this area: the machines on it stay' : 'Remove this machine from the floor'}>Remove</Button>
    </>
  );
  const settings = <Settings m={m} view={view} onPatch={(p) => onPatch(m.id, p)} onSelect={onOpenMachine} onNewItem={onNewItem} />;
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
