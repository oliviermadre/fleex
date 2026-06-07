import { useMemo, useState } from 'react';
import type { StatusAnchor, StatusColor, StatusColumn, StatusModel, TicketStatus } from '@fleex/shared';
import { slugify, validateStatusModel } from '@fleex/shared';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/cn';
import { PALETTE } from '../../lib/statusColors';
import { useStatusModelStore } from '../../stores/statusModelStore';
import * as api from '../../services/api';

const COLOR_NAMES = Object.keys(PALETTE) as StatusColor[];
const ANCHORS: { key: StatusAnchor; label: string; help: string }[] = [
  { key: 'defaultNew', label: 'New tickets land in', help: 'Where a freshly created ticket starts.' },
  { key: 'workStart', label: 'Work starts in', help: 'A startable ticket moves here when a session/agent launches.' },
  { key: 'agentQueue', label: 'Agents pull from', help: 'Column the agent picks its next ticket from.' },
  { key: 'mergeLanding', label: 'Merged PRs land in', help: 'Must be a completed terminal column.' },
];

/** Editable shape: a column without its anchors (anchors are managed separately). */
type EditCol = Omit<StatusColumn, 'anchors' | 'order'>;

function ColorSwatch({ color }: { color: StatusColor }) {
  return <span className={cn('inline-block h-3 w-3 rounded-[3px]', PALETTE[color].bar)} />;
}

export function StatusColumnsTab() {
  const model = useStatusModelStore((s) => s.model);
  const applyModel = useStatusModelStore((s) => s.applyModel);

  const initial = useMemo(() => [...model.columns].sort((a, b) => a.order - b.order), [model]);
  const originalKeys = useMemo(() => new Set(initial.map((c) => c.key)), [initial]);

  const [cols, setCols] = useState<EditCol[]>(() =>
    initial.map((c) => ({ key: c.key, label: c.label, color: c.color, startable: c.startable, active: c.active, terminal: c.terminal, outcome: c.outcome, collapsedByDefault: c.collapsedByDefault })),
  );
  const [anchors, setAnchors] = useState<Record<StatusAnchor, string>>(() => {
    const map = {} as Record<StatusAnchor, string>;
    for (const a of ANCHORS) {
      map[a.key] = initial.find((c) => c.anchors.includes(a.key))?.key ?? '';
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const built: StatusModel = useMemo(() => ({
    columns: cols.map((c, i) => ({
      ...c,
      order: i,
      outcome: c.terminal ? (c.outcome ?? 'completed') : null,
      anchors: ANCHORS.map((a) => a.key).filter((a) => anchors[a] === c.key),
    })),
  }), [cols, anchors]);

  const validation = useMemo(() => validateStatusModel(built), [built]);

  const update = (i: number, patch: Partial<EditCol>) =>
    setCols((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const move = (i: number, dir: -1 | 1) =>
    setCols((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const addColumn = () => {
    let key = `status-${cols.length + 1}`;
    let n = cols.length + 1;
    while (cols.some((c) => c.key === key)) key = `status-${++n}`;
    setCols((prev) => [...prev, { key: key as TicketStatus, label: 'New column', color: 'gray', startable: false, active: false, terminal: false, outcome: null, collapsedByDefault: false }]);
  };

  const removeColumn = (i: number) =>
    setCols((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!validation.ok) return;
    setSaving(true);
    setSaved(false);
    try {
      // Tickets sitting in a removed column are moved to the new-tickets column.
      const newKeys = new Set(built.columns.map((c) => c.key));
      const fallback = anchors.defaultNew || built.columns[0]?.key || '';
      const reassign: Record<string, string> = {};
      for (const k of originalKeys) {
        if (!newKeys.has(k)) reassign[k] = fallback;
      }
      const result = await api.updateStatusModel(built, reassign);
      applyModel(result);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const removedKeys = [...originalKeys].filter((k) => !cols.some((c) => c.key === k));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-[var(--theme-text-muted)]">
        Define the kanban columns and their behaviour. Column <em>keys</em> are stable identifiers stored on tickets;
        edit labels, colors, order and roles freely. Automations follow the roles below, never the names.
      </p>

      {/* Anchor roles */}
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <p className="mb-3 text-sm font-medium text-[var(--theme-text-secondary)]">Roles</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ANCHORS.map((a) => (
            <label key={a.key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--theme-text-secondary)]">{a.label}</span>
              <select
                className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                value={anchors[a.key]}
                onChange={(e) => setAnchors((prev) => ({ ...prev, [a.key]: e.target.value }))}
              >
                <option value="">—</option>
                {cols.map((c) => (
                  <option key={c.key} value={c.key}>{c.label || c.key}</option>
                ))}
              </select>
              <span className="text-[10px] text-[var(--theme-text-muted)]">{a.help}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--theme-text-secondary)]">Columns ({cols.length})</span>
          <Button variant="secondary" size="sm" onClick={addColumn}>+ Add Column</Button>
        </div>

        {cols.map((c, i) => {
          const isNew = !originalKeys.has(c.key);
          return (
            <div key={c.key} className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">▲</button>
                  <button className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] disabled:opacity-30" disabled={i === cols.length - 1} onClick={() => move(i, 1)} title="Move down">▼</button>
                </div>
                <div className="flex-1">
                  <Input label="Label" value={c.label} onChange={(e) => update(i, { label: e.target.value })} />
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-[var(--theme-text-secondary)]">Color</span>
                  <select
                    className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                    value={c.color}
                    onChange={(e) => update(i, { color: e.target.value as StatusColor })}
                  >
                    {COLOR_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <ColorSwatch color={c.color} />
                <button className="ml-1 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-danger)]" onClick={() => removeColumn(i)} title="Remove column">✕</button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4 pl-8">
                <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
                  {isNew ? <input className="w-24 bg-transparent text-[var(--theme-text-secondary)] outline-none" value={c.key} onChange={(e) => update(i, { key: (slugify(e.target.value) as TicketStatus) || c.key })} /> : c.key}
                </code>
                <label className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
                  <input type="checkbox" checked={c.startable} onChange={(e) => update(i, { startable: e.target.checked })} /> startable
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
                  <input type="checkbox" checked={c.active} onChange={(e) => update(i, { active: e.target.checked })} /> active
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
                  <input type="checkbox" checked={c.terminal} onChange={(e) => update(i, { terminal: e.target.checked, outcome: e.target.checked ? (c.outcome ?? 'completed') : null })} /> terminal
                </label>
                {c.terminal && (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
                    outcome
                    <select
                      className="rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-1 py-0.5 text-xs"
                      value={c.outcome ?? 'completed'}
                      onChange={(e) => update(i, { outcome: e.target.value as StatusColumn['outcome'] })}
                    >
                      <option value="completed">completed</option>
                      <option value="abandoned">abandoned</option>
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
                  <input type="checkbox" checked={c.collapsedByDefault} onChange={(e) => update(i, { collapsedByDefault: e.target.checked })} /> collapsed by default
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Validation + reassignment warnings */}
      {!validation.ok && (
        <div className="rounded-md border border-[var(--theme-danger)]/40 bg-[var(--theme-danger)]/5 p-3">
          <p className="mb-1 text-xs font-medium text-[var(--theme-danger)]">Fix before saving:</p>
          <ul className="list-disc pl-5 text-xs text-[var(--theme-text-secondary)]">
            {validation.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      {removedKeys.length > 0 && validation.ok && (
        <p className="text-xs text-[var(--theme-text-muted)]">
          Tickets currently in {removedKeys.map((k) => <code key={k} className="mx-0.5 rounded bg-[var(--theme-bg-overlay)] px-1">{k}</code>)} will be moved to
          {' '}<code className="rounded bg-[var(--theme-bg-overlay)] px-1">{anchors.defaultNew || cols[0]?.key}</code> on save.
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-[var(--theme-text-muted)]">Saved.</span>}
        <Button variant="primary" onClick={handleSave} disabled={!validation.ok || saving}>
          {saving ? 'Saving…' : 'Save Columns'}
        </Button>
      </div>
    </div>
  );
}
