import { useMemo } from 'react';
import type {
  WorkflowEdge, WorkflowStep, EdgeOperator, EdgeConditionClause, EdgeFieldSuggestion,
} from '@fleex/shared';
import {
  edgeConditionSuggestions, validateEdgeConditions, normalizeEdgeCondition,
  operatorLabel, operatorsForType, isUnaryOperator, isListOperator,
} from '@fleex/shared';
import { TagInput } from '../ui/TagInput';

/**
 * Config UI for an edge's routing condition.
 *
 * Everything the author picks — the field, the operators offered for it, the
 * allowed values — comes from `@fleex/shared`, computed off the graph's output
 * schemas. That is the whole point: an author never retypes a field name they
 * already declared three steps back, and can never build a condition the server
 * then refuses on save.
 */

interface Props {
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
  onDelete: () => void;
  /** The rest of the graph — a condition's field list is derived from it. */
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
}

const inputStyle = {
  background: 'var(--theme-bg-surface)',
  borderColor: 'var(--theme-border)',
  color: 'var(--theme-text-primary)',
};

/** Identifies a suggestion in a <select>; a clause without stepId reads the source step. */
const suggestionKey = (stepId: string | undefined, field: string) => `${stepId ?? ''}::${field}`;

export function EdgeConfigPanel({ edge, onChange, onDelete, steps, edges, entryStepId }: Props) {
  const suggestions = useMemo(
    () => edgeConditionSuggestions(edge, steps, edges, entryStepId),
    [edge, steps, edges, entryStepId],
  );

  // Same validator the server runs on save, so the panel and Save always agree.
  const issues = useMemo(
    () => validateEdgeConditions(steps, edges, entryStepId).byEdge[edge.id],
    [steps, edges, entryStepId, edge.id],
  );

  // Reading through the normalizer means a legacy single-condition edge opens
  // as a one-clause group; the first save from here rewrites it in the new shape.
  const group = normalizeEdgeCondition(edge) ?? { match: 'all' as const, clauses: [] };
  const clauses = group.clauses;

  const setClauses = (next: EdgeConditionClause[]) => onChange({
    ...edge,
    condition: undefined,
    conditionGroup: { match: group.match, clauses: next },
  });

  const patchClause = (index: number, patch: Partial<EdgeConditionClause>) => {
    setClauses(clauses.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addClause = () => {
    const first = suggestions[0];
    setClauses([...clauses, {
      stepId: first?.stepId,
      field: first?.field ?? '',
      operator: 'eq',
      value: '',
    }]);
  };

  const toggleDefault = (checked: boolean) => {
    if (checked) {
      onChange({ ...edge, isDefault: true, condition: undefined, conditionGroup: undefined });
      return;
    }
    const first = suggestions[0];
    onChange({
      ...edge,
      isDefault: false,
      condition: undefined,
      conditionGroup: clauses.length > 0
        ? { match: group.match, clauses }
        : { match: 'all', clauses: [{ stepId: first?.stepId, field: first?.field ?? '', operator: 'eq', value: '' }] },
    });
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs space-y-1">
        <span style={{ color: 'var(--theme-text-muted)' }}>Label (optional)</span>
        <input
          value={edge.label ?? ''}
          onChange={(e) => onChange({ ...edge, label: e.target.value || undefined })}
          className="w-full h-8 px-2 text-xs rounded border"
          style={inputStyle}
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Default (fallback) edge</span>
        <input type="checkbox" checked={edge.isDefault} onChange={(e) => toggleDefault(e.target.checked)} />
      </div>

      {!edge.isDefault && (
        <>
          {clauses.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--theme-text-muted)' }}>Match</span>
              {(['all', 'any'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onChange({
                    ...edge,
                    condition: undefined,
                    conditionGroup: { match: mode, clauses },
                  })}
                  className="px-2 py-0.5 rounded border text-[11px] uppercase"
                  style={{
                    borderColor: group.match === mode ? 'var(--theme-accent)' : 'var(--theme-border)',
                    color: group.match === mode ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                  }}
                >
                  {mode === 'all' ? 'All (AND)' : 'Any (OR)'}
                </button>
              ))}
            </div>
          )}

          {clauses.map((clause, index) => (
            <ClauseRow
              key={index}
              index={index}
              clause={clause}
              suggestions={suggestions}
              onChange={(patch) => patchClause(index, patch)}
              onRemove={() => setClauses(clauses.filter((_, i) => i !== index))}
            />
          ))}

          <button
            onClick={addClause}
            className="text-xs px-3 py-1 rounded border w-full"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          >
            + Add condition
          </button>
        </>
      )}

      {issues?.errors.map((msg) => (
        <div key={msg} className="text-[10px] text-[var(--theme-danger)]">{msg}</div>
      ))}
      {issues?.warnings.map((msg) => (
        <div key={msg} className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>⚠ {msg}</div>
      ))}

      <button
        onClick={onDelete}
        className="text-xs px-3 py-1 rounded border text-[var(--theme-danger)]"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        Delete edge
      </button>
    </div>
  );
}

// ── One condition ─────────────────────────────────────────────────────────────

interface ClauseRowProps {
  index: number;
  clause: EdgeConditionClause;
  suggestions: EdgeFieldSuggestion[];
  onChange: (patch: Partial<EdgeConditionClause>) => void;
  onRemove: () => void;
}

function ClauseRow({ index, clause, suggestions, onChange, onRemove }: ClauseRowProps) {
  const selected = suggestions.find(
    (s) => s.stepId === clause.stepId && s.field === clause.field,
  );
  // A field the graph doesn't know about (hand-typed deep path, or a step whose
  // schema changed) stays editable rather than being silently dropped.
  const isCustom = !selected;
  const operators = operatorsForType(selected?.type);

  // Group the dropdown by step, preserving the suggestion order (source step
  // first, then ancestors nearest-first).
  const groups: { name: string; items: EdgeFieldSuggestion[] }[] = [];
  for (const s of suggestions) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.stepName) last.items.push(s);
    else groups.push({ name: s.stepName, items: [s] });
  }

  const pickField = (key: string) => {
    if (key === '__custom__') {
      onChange({ stepId: undefined, field: '' });
      return;
    }
    const next = suggestions.find((s) => suggestionKey(s.stepId, s.field) === key);
    if (!next) return;
    // Changing field can invalidate the operator (a text operator on a number,
    // say) — fall back to the first one this type actually allows.
    const allowed = operatorsForType(next.type);
    const operator = allowed.includes(clause.operator) ? clause.operator : (allowed[0] ?? 'eq');
    onChange({ stepId: next.stepId, field: next.field, operator, value: resetValue(operator) });
  };

  const setOperator = (operator: EdgeOperator) => {
    onChange({ operator, value: keepValue(clause, operator) });
  };

  return (
    <div className="rounded border p-2 space-y-2" style={{ borderColor: 'var(--theme-border)' }}>
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-mono w-4 shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
          {index + 1}.
        </span>
        {selected?.conditional && (
          <span
            className="text-[10px]"
            title="This step is on a branch that may not run — the condition is false when it was skipped"
          >
            ⚠
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={onRemove}
          title="Remove condition"
          className="text-[10px] px-1 rounded"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          ✕
        </button>
      </div>

      <select
        value={isCustom ? '__custom__' : suggestionKey(clause.stepId, clause.field)}
        onChange={(e) => pickField(e.target.value)}
        className="w-full h-8 px-2 text-[11px] rounded border"
        style={inputStyle}
      >
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.items.map((s) => (
              <option key={suggestionKey(s.stepId, s.field)} value={suggestionKey(s.stepId, s.field)}>
                {s.field}{s.enum ? ` (${s.enum.join(' | ')})` : s.type ? ` — ${s.type}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__custom__">Other field…</option>
      </select>

      {isCustom && (
        <input
          value={clause.field}
          onChange={(e) => onChange({ field: e.target.value })}
          placeholder="e.g. deliverable.status"
          className="w-full h-8 px-2 text-[11px] font-mono rounded border"
          style={inputStyle}
        />
      )}

      <select
        value={clause.operator}
        onChange={(e) => setOperator(e.target.value as EdgeOperator)}
        className="w-full h-8 px-2 text-[11px] rounded border"
        style={inputStyle}
      >
        {operators.map((op) => <option key={op} value={op}>{operatorLabel(op)}</option>)}
      </select>

      <ValueField clause={clause} suggestion={selected} onChange={onChange} />

      {(selected?.type === 'string' || isCustom) && !isUnaryOperator(clause.operator) && (
        <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          <input
            type="checkbox"
            checked={clause.caseInsensitive === true}
            onChange={(e) => onChange({ caseInsensitive: e.target.checked || undefined })}
          />
          Ignore case
        </label>
      )}
    </div>
  );
}

// ── Value widget ──────────────────────────────────────────────────────────────

function ValueField({
  clause, suggestion, onChange,
}: {
  clause: EdgeConditionClause;
  suggestion?: EdgeFieldSuggestion;
  onChange: (patch: Partial<EdgeConditionClause>) => void;
}) {
  // Unary operators have no right-hand side at all.
  if (isUnaryOperator(clause.operator)) return null;

  const options = suggestion?.enum;

  if (isListOperator(clause.operator)) {
    const values = Array.isArray(clause.value) ? clause.value : [];
    if (options && options.length > 0) {
      return (
        <div className="flex flex-wrap gap-1">
          {options.map((option) => {
            const on = values.includes(option);
            return (
              <button
                key={option}
                onClick={() => onChange({
                  value: on ? values.filter((v) => v !== option) : [...values, option],
                })}
                className="text-[10px] px-2 py-0.5 rounded border"
                style={{
                  borderColor: on ? 'var(--theme-accent)' : 'var(--theme-border)',
                  color: on ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <TagInput
        tags={values}
        onChange={(next) => onChange({ value: next })}
        placeholder="Type a value, then Enter"
      />
    );
  }

  if (options && options.length > 0 && (clause.operator === 'eq' || clause.operator === 'neq')) {
    return (
      <select
        value={typeof clause.value === 'string' ? clause.value : ''}
        onChange={(e) => onChange({ value: e.target.value })}
        className="w-full h-8 px-2 text-[11px] rounded border"
        style={inputStyle}
      >
        <option value="">Select…</option>
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  return (
    <input
      value={typeof clause.value === 'string' ? clause.value : ''}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={clause.operator === 'matches' ? 'regular expression' : 'value'}
      className="w-full h-8 px-2 text-[11px] font-mono rounded border"
      style={inputStyle}
    />
  );
}

// ── Value shape helpers ───────────────────────────────────────────────────────

function resetValue(operator: EdgeOperator): string | string[] | undefined {
  if (isUnaryOperator(operator)) return undefined;
  return isListOperator(operator) ? [] : '';
}

/** Carry the value across an operator change whenever its shape still fits. */
function keepValue(clause: EdgeConditionClause, operator: EdgeOperator): string | string[] | undefined {
  if (isUnaryOperator(operator)) return undefined;
  if (isListOperator(operator)) {
    if (Array.isArray(clause.value)) return clause.value;
    return typeof clause.value === 'string' && clause.value !== '' ? [clause.value] : [];
  }
  if (Array.isArray(clause.value)) return clause.value[0] ?? '';
  return clause.value ?? '';
}
