import type { WorkflowEdge, EdgeOperator } from '@fleex/shared';

interface Props {
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
  onDelete: () => void;
}

const OPERATORS: EdgeOperator[] = ['eq', 'neq', 'in', 'gt', 'lt', 'contains'];

export function EdgeConfigPanel({ edge, onChange, onDelete }: Props) {
  const isDefault = edge.isDefault;
  const condition = edge.condition;

  return (
    <div className="space-y-3">
      <label className="block text-xs space-y-1">
        <span style={{ color: 'var(--theme-text-muted)' }}>Label (optional)</span>
        <input
          value={edge.label ?? ''}
          onChange={(e) => onChange({ ...edge, label: e.target.value || undefined })}
          className="w-full h-8 px-2 text-xs rounded border"
          style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Default (fallback) edge</span>
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => onChange({
            ...edge,
            isDefault: e.target.checked,
            condition: e.target.checked ? undefined : (condition ?? { field: '', operator: 'eq', value: '' }),
          })}
        />
      </div>

      {!isDefault && (
        <>
          <label className="block text-xs space-y-1">
            <span style={{ color: 'var(--theme-text-muted)' }}>Field (from output schema)</span>
            <input
              value={condition?.field ?? ''}
              onChange={(e) => onChange({ ...edge, condition: { ...(condition ?? { operator: 'eq' as EdgeOperator, value: '' }), field: e.target.value } })}
              placeholder="e.g. path, outcome, deliverable.status"
              className="w-full h-8 px-2 text-xs font-mono rounded border"
              style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: 'var(--theme-text-muted)' }}>Operator</span>
            <select
              value={condition?.operator ?? 'eq'}
              onChange={(e) => onChange({ ...edge, condition: { ...(condition ?? { field: '', value: '' }), operator: e.target.value as EdgeOperator } })}
              className="w-full h-8 px-2 text-xs rounded border"
              style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            >
              {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: 'var(--theme-text-muted)' }}>
              Value{condition?.operator === 'in' ? ' (comma-separated)' : ''}
            </span>
            <input
              value={Array.isArray(condition?.value) ? condition!.value.join(', ') : (condition?.value ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                const value = condition?.operator === 'in' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
                onChange({ ...edge, condition: { ...(condition ?? { field: '', operator: 'eq' as EdgeOperator }), value } });
              }}
              className="w-full h-8 px-2 text-xs font-mono rounded border"
              style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            />
          </label>
        </>
      )}

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
