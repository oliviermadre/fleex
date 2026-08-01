import { useMemo, useState } from 'react';
import type {
  WorkflowStep, WorkflowEdge, NativeAction, NativeOperationParam, ReferenceSuggestion,
} from '@fleex/shared';
import {
  NATIVE_OPERATIONS, getNativeOperation, nativeReferenceSuggestions, validateNativeSteps,
} from '@fleex/shared';
import { TagInput } from '../ui/TagInput';

/**
 * Config UI for a `native` step: an ordered list of operations.
 *
 * Every field below is generated from the operation's `params` descriptors in
 * `@fleex/shared` — there is no per-operation React code. Adding an operation to
 * the registry makes it appear here, with a working form, for free (that is the
 * whole point of the open/closed registry).
 */

interface Props {
  step: WorkflowStep;
  /** All steps of the template — needed to offer upstream outputs as references. */
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  onChange: (next: WorkflowStep) => void;
}

const inputStyle = {
  background: 'var(--theme-bg-surface)',
  borderColor: 'var(--theme-border)',
  color: 'var(--theme-text-primary)',
};

let actionSeq = 0;
const newActionId = () => `a-${Date.now().toString(36)}-${(actionSeq++).toString(36)}`;

function defaultParams(operationId: string): Record<string, unknown> {
  const op = getNativeOperation(operationId);
  const params: Record<string, unknown> = {};
  for (const p of op?.params ?? []) {
    if (p.defaultValue !== undefined) params[p.name] = p.defaultValue;
  }
  return params;
}

export function NativeActionsEditor({ step, steps, edges, entryStepId, onChange }: Props) {
  const actions = step.nativeActions ?? [];
  const [addingId, setAddingId] = useState<string>('');

  // Validated against the whole graph (references need the other steps), but only
  // this step's issues are surfaced — same code the server runs on save, so the
  // panel can never claim something is fine that Save then rejects.
  const issues = useMemo(
    () => validateNativeSteps(steps, edges, entryStepId).byStep[step.id],
    [steps, edges, entryStepId, step.id],
  );

  const suggestions = useMemo(
    () => nativeReferenceSuggestions(step, steps, edges, entryStepId),
    [step, steps, edges, entryStepId],
  );

  const setActions = (next: NativeAction[]) => onChange({ ...step, nativeActions: next });

  const patchAction = (index: number, patch: Partial<NativeAction>) => {
    setActions(actions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const setParam = (index: number, name: string, value: unknown) => {
    const current = actions[index];
    if (!current) return;
    const params = { ...current.params };
    if (value === undefined) delete params[name];
    else params[name] = value;
    patchAction(index, { params });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setActions(next);
  };

  const add = (operationId: string) => {
    if (!operationId) return;
    setActions([...actions, { id: newActionId(), operationId, params: defaultParams(operationId) }]);
    setAddingId('');
  };

  return (
    <div className="space-y-2">
      <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        Actions ({actions.length})
      </span>

      {actions.length === 0 && (
        <div className="text-[10px] italic" style={{ color: 'var(--theme-text-muted)' }}>
          A native step needs at least one action.
        </div>
      )}

      {actions.map((action, index) => {
        const op = getNativeOperation(action.operationId);
        return (
          <div
            key={action.id}
            className="rounded border p-2 space-y-2"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono w-4 shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                {index + 1}.
              </span>
              <span className="text-xs font-medium flex-1 truncate">{op?.label ?? action.operationId}</span>
              <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</IconButton>
              <IconButton label="Move down" disabled={index === actions.length - 1} onClick={() => move(index, 1)}>↓</IconButton>
              <IconButton
                label="Remove action"
                onClick={() => setActions(actions.filter((_, i) => i !== index))}
              >
                ✕
              </IconButton>
            </div>

            {op ? (
              <>
                {op.description && (
                  <p className="text-[10px] leading-tight" style={{ color: 'var(--theme-text-muted)' }}>
                    {op.description}
                  </p>
                )}
                {op.params.map((param) => (
                  <ParamField
                    key={param.name}
                    param={param}
                    value={action.params?.[param.name]}
                    suggestions={suggestions}
                    onChange={(v) => setParam(index, param.name, v)}
                  />
                ))}
              </>
            ) : (
              <p className="text-[10px] text-[var(--theme-danger)]">
                Unknown operation "{action.operationId}" — it was probably removed from the registry.
              </p>
            )}
          </div>
        );
      })}

      <select
        value={addingId}
        onChange={(e) => add(e.target.value)}
        className="w-full h-8 px-2 text-xs rounded border"
        style={inputStyle}
      >
        <option value="">Add an action…</option>
        {NATIVE_OPERATIONS.map((op) => (
          <option key={op.id} value={op.id}>{op.label}</option>
        ))}
      </select>

      {issues?.errors.map((msg) => (
        <div key={msg} className="text-[10px] text-[var(--theme-danger)]">{msg}</div>
      ))}
      {issues?.warnings.map((msg) => (
        <div key={msg} className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>⚠ {msg}</div>
      ))}
    </div>
  );
}

// ── Field rendering ───────────────────────────────────────────────────────────

interface ParamFieldProps {
  param: NativeOperationParam;
  value: unknown;
  suggestions: ReferenceSuggestion[];
  onChange: (value: unknown) => void;
}

function ParamField({ param, value, suggestions, onChange }: ParamFieldProps) {
  const canReference = param.allowReference !== false;
  // A referenced value is a string like "{{ output.priority }}", which no
  // enum/boolean/date widget can hold. So as soon as a reference is in play the
  // field degrades to a text input — that is what makes `{{ … }}` usable on
  // typed params at all.
  const isReferenced = typeof value === 'string' && value.includes('{{');

  const label = (
    <span style={{ color: 'var(--theme-text-muted)' }}>
      {param.label}{param.required ? ' *' : ''}
    </span>
  );

  const insert = (token: string) => {
    onChange(typeof value === 'string' && value.trim() !== '' && isReferenced ? `${value}${token}` : token);
  };

  const picker = canReference
    ? <ReferencePicker suggestions={suggestions} onInsert={insert} />
    : null;

  if (param.type === 'text') {
    return (
      <label className="block text-[11px] space-y-1">
        <div className="flex items-center justify-between gap-2">{label}{picker}</div>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className="w-full text-[11px] min-h-[60px] p-2 rounded border"
          style={inputStyle}
          placeholder={param.description}
        />
      </label>
    );
  }

  if (isReferenced || param.type === 'string') {
    return (
      <label className="block text-[11px] space-y-1">
        <div className="flex items-center justify-between gap-2">{label}{picker}</div>
        <input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className="w-full h-8 px-2 text-[11px] rounded border"
          style={inputStyle}
          placeholder={param.description}
        />
      </label>
    );
  }

  if (param.type === 'enum') {
    return (
      <label className="block text-[11px] space-y-1">
        <div className="flex items-center justify-between gap-2">{label}{picker}</div>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className="w-full h-8 px-2 text-[11px] rounded border"
          style={inputStyle}
        >
          <option value="">{param.required ? 'Select…' : '(unset)'}</option>
          {param.enum?.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
    );
  }

  if (param.type === 'boolean') {
    return (
      <label className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">{label}{picker}</div>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  }

  if (param.type === 'number') {
    return (
      <label className="block text-[11px] space-y-1">
        <div className="flex items-center justify-between gap-2">{label}{picker}</div>
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-full h-8 px-2 text-[11px] rounded border"
          style={inputStyle}
        />
      </label>
    );
  }

  if (param.type === 'date') {
    return (
      <label className="block text-[11px] space-y-1">
        <div className="flex items-center justify-between gap-2">{label}{picker}</div>
        <input
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className="w-full h-8 px-2 text-[11px] rounded border"
          style={inputStyle}
        />
      </label>
    );
  }

  // string[]
  return (
    <div className="text-[11px] space-y-1">
      <div className="flex items-center justify-between gap-2">{label}{picker}</div>
      <TagInput
        tags={Array.isArray(value) ? (value as string[]) : []}
        onChange={(next) => onChange(next.length === 0 ? undefined : next)}
        placeholder="Type a value, then Enter"
      />
    </div>
  );
}

/**
 * Inserts `{{ … }}` tokens. Deliberately shows step *names* while inserting step
 * *ids*: renaming a step must not break the references pointing at it.
 */
function ReferencePicker({
  suggestions, onInsert,
}: { suggestions: ReferenceSuggestion[]; onInsert: (token: string) => void }) {
  if (suggestions.length === 0) return null;
  const groups = ['Steps', 'Ticket', 'Workflow'] as const;
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onInsert(e.target.value); }}
      className="h-5 text-[10px] rounded border shrink-0"
      style={inputStyle}
      title="Insert a reference to an upstream value"
    >
      <option value="">{'{{ … }}'}</option>
      {groups.map((group) => {
        const items = suggestions.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <optgroup key={group} label={group}>
            {items.map((s) => (
              <option key={s.token} value={s.token}>
                {s.conditional ? `${s.label} (conditional)` : s.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function IconButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-5 h-5 text-[10px] rounded border shrink-0 disabled:opacity-30"
      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
    >
      {children}
    </button>
  );
}
