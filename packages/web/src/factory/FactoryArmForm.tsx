import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Select } from '../components/ui/Select';
import { useTicketStore } from '../stores/ticketStore';
import { arity, blank, conditionsOf, FIELD_LABEL, FIELDS, incomplete, opLabel, OPS_BY_FIELD, optionsFor, withOp } from './armRules';
import type { FactoryView } from './renderer';
import { DX, DY, type ArmCondition, type ArmField, type ArmOp, type ArmSpec, type FactoryLayout } from './types';

const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/** Free text for the fields that have no finite list (tags): saved when left, or on Enter. */
function TextValues({ id, values, onCommit, label = 'Values, comma separated', placeholder = 'one, or several separated by commas' }: { id: string; values: string[]; onCommit: (v: string[]) => void; label?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(values.join(', '));
  useEffect(() => setDraft(values.join(', ')), [values]);
  return (
    <Input id={id} aria-label={label} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (list(draft).join() !== values.join()) onCommit(list(draft)); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

/**
 * What an arm takes: a list of conditions, all of which must hold. Each one is
 * a field, an operator the field makes sense with, and values picked from the
 * list of what that field can be whenever that list is finite.
 *
 * A condition that has nothing to compare to yet stays in this form only: the
 * floor is saved with the complete ones, so a half-filled row never changes
 * what the arm does.
 */
export function FactoryArmForm({ arm, view, layout, onChange, heading = 'Takes a ticket when', any = false }: { arm: ArmSpec; view: FactoryView; layout: FactoryLayout; onChange: (when: ArmCondition[]) => void; /** What the conditions are for, when it is not an arm that takes. */ heading?: string; /** One condition is enough (a toll), where an arm needs them all. */ any?: boolean }) {
  const boards = useTicketStore((s) => s.boards);
  const saved = conditionsOf(arm), savedKey = JSON.stringify(saved);
  const [rows, setRows] = useState<ArmCondition[]>(saved);
  /* follow the floor when it changes under the form (an undo, another tab), unless that is just this form's own save coming back */
  useEffect(() => { setRows((cur) => (JSON.stringify(cur.filter((c) => !incomplete(c))) === savedKey ? cur : (JSON.parse(savedKey) as ArmCondition[]))); }, [savedKey]);

  const src = view.at(arm.x - DX[arm.dir], arm.y - DY[arm.dir]);
  const source = useMemo(() => (src?.kind === 'station' ? src.outcomes : []), [src]);
  const ctx = useMemo(() => ({ boards: boards.map((b) => ({ id: b.id, name: b.name })), layout, source }), [boards, layout, source]);

  const commit = (next: ArmCondition[]) => {
    setRows(next);
    const complete = next.filter((c) => !incomplete(c));
    if (JSON.stringify(complete) !== savedKey) onChange(complete);
  };
  const patch = (i: number, c: ArmCondition) => commit(rows.map((r, k) => (k === i ? c : r)));
  /* a field already used is still offered: "priority at least High" and "priority is not Urgent" go together */
  const add = () => commit([...rows, blank(src?.kind === 'station' && !rows.some((r) => r.field === 'outcome') ? 'outcome' : 'type')]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-[var(--theme-text-secondary)]">{heading}</div>
      {rows.length === 0 && <p className="text-xs text-[var(--theme-text-muted)]">{any ? 'No condition: it rejects nothing, every ticket goes on.' : 'No condition: it takes anything, or what the conditions of the arms next to it leave.'}</p>}
      {rows.map((c, i) => {
        const options = optionsFor(c.field, c.op, ctx), n = arity(c.field, c.op), label = (v: string) => options?.find((o) => o.value === v)?.label ?? v;
        const pick = (id: string, value: string, set: (v: string) => void, what: string) => (
          <Select id={id} aria-label={what} value={value} onChange={(e) => set(e.target.value)}
            options={[{ value: '', label: 'choose' }, ...(options ?? []), ...(value && !options?.some((o) => o.value === value) ? [{ value, label: value }] : [])]} />
        );
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-md border border-[var(--theme-border)] p-2" role="group" aria-label={`Condition ${i + 1}`}>
            <div className="flex items-center gap-1.5">
              {i > 0 && <span className="flex-none text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{any ? 'or' : 'and'}</span>}
              <div className="min-w-0 flex-1">
                <Select id={`f-cond-field-${i}`} aria-label="What the arm looks at" value={c.field} onChange={(e) => patch(i, blank(e.target.value as ArmField))} options={FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] }))} />
              </div>
              <Button size="sm" variant="ghost" aria-label={`Remove condition ${i + 1}`} title="Remove this condition" onClick={() => commit(rows.filter((_, k) => k !== i))}>×</Button>
            </div>
            <Select id={`f-cond-op-${i}`} aria-label="How it compares" value={c.op} onChange={(e) => patch(i, withOp(c, e.target.value as ArmOp))} options={OPS_BY_FIELD[c.field].map((op) => ({ value: op, label: opLabel(c.field, op) }))} />
            {n === 'many' && options && (
              <>
                <MultiSelect label={FIELD_LABEL[c.field]} allLabel={options.length ? 'Choose' : 'Nothing to choose from yet'} values={c.values} options={options} onChange={(values) => patch(i, { ...c, values })} searchable={options.length > 8} />
                {c.values.length > 0 && <div className="text-[11px] text-[var(--theme-text-secondary)]">{c.values.map(label).join(c.op === 'is_not' ? ', nor ' : ' or ')}</div>}
              </>
            )}
            {n === 'many' && !options && <TextValues id={`f-cond-values-${i}`} values={c.values} onCommit={(values) => patch(i, { ...c, values })} />}
            {n === 'keyed' && (
              <div className="grid grid-cols-2 gap-1.5">
                <TextValues id={`f-cond-key-${i}`} label="Key" placeholder="key, such as passes" values={c.values[0] ? [c.values[0]] : []} onCommit={(v) => patch(i, { ...c, values: [(v[0] ?? '').replace(/:.*$/, ''), c.values[1] ?? ''] })} />
                <TextValues id={`f-cond-keyval-${i}`} label="Compared to" placeholder="a value, such as 3" values={c.values[1] ? [c.values[1]] : []} onCommit={(v) => patch(i, { ...c, values: [c.values[0] ?? '', v[0] ?? ''] })} />
              </div>
            )}
            {n === 'one' && pick(`f-cond-value-${i}`, c.values[0] ?? '', (v) => patch(i, { ...c, values: v ? [v] : [] }), 'Compared to')}
            {n === 'two' && (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                {pick(`f-cond-from-${i}`, c.values[0] ?? '', (v) => patch(i, { ...c, values: [v, c.values[1] ?? ''] }), 'From')}
                <span className="text-xs text-[var(--theme-text-muted)]">and</span>
                {pick(`f-cond-to-${i}`, c.values[1] ?? '', (v) => patch(i, { ...c, values: [c.values[0] ?? '', v] }), 'To')}
              </div>
            )}
            {incomplete(c) && <div className="text-[11px] text-[var(--theme-warning)]">Choose what to compare to: until then this condition is not applied.</div>}
            {c.field === 'tagkey' && <div className="text-[11px] text-[var(--theme-text-muted)]">The value of a tag written key:value. Compared as numbers when both are; a ticket without that key counts as 0.</div>}
            {(c.field === 'complexity' && c.op !== 'is' && c.op !== 'is_not') && <div className="text-[11px] text-[var(--theme-text-muted)]">A ticket that is not estimated is neither above nor below: it does not pass.</div>}
          </div>
        );
      })}
      <div><Button size="sm" onClick={add}>Add a condition</Button></div>
      {rows.length > 1 && <p className="text-xs text-[var(--theme-text-muted)]">{any ? 'One condition that holds is enough to reject the ticket.' : 'All the conditions must hold. For "either this or that", use one arm for each.'}</p>}
    </div>
  );
}
