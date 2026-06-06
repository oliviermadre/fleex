import { useEffect, useState } from 'react';
import { DELIVERABLE_RENDERERS, type DeliverableRenderer } from '@fleex/shared';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useToastStore } from '../../stores/toastStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

const inputCls =
  'rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-input)] px-2 py-1 text-sm text-[var(--theme-text-primary)] outline-none transition-colors focus:border-[var(--theme-accent)]';

function RendererSelect({
  value,
  onChange,
  disabled,
}: {
  value: DeliverableRenderer;
  onChange: (r: DeliverableRenderer) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className={inputCls}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as DeliverableRenderer)}
    >
      {DELIVERABLE_RENDERERS.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

export function DeliverableTypesTab() {
  const types = useDeliverableTypesStore((s) => s.types);
  const usage = useDeliverableTypesStore((s) => s.usage);
  const load = useDeliverableTypesStore((s) => s.load);
  const create = useDeliverableTypesStore((s) => s.create);
  const update = useDeliverableTypesStore((s) => s.update);
  const rename = useDeliverableTypesStore((s) => s.rename);
  const remove = useDeliverableTypesStore((s) => s.remove);
  const reassign = useDeliverableTypesStore((s) => s.reassign);
  const addToast = useToastStore((s) => s.addToast);

  // New-type form
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRenderer, setNewRenderer] = useState<DeliverableRenderer>('markdown');

  // Bulk reassign form
  const [reassignFrom, setReassignFrom] = useState('');
  const [reassignTo, setReassignTo] = useState('');

  useEffect(() => { load(); }, [load]);

  // Type ids present on existing deliverables (for the reassign "from" dropdown),
  // including legacy/unknown values not in the configured list.
  const usedTypeIds = Object.keys(usage).filter((id) => (usage[id] ?? 0) > 0).sort();
  const configuredIds = types.map((t) => t.id);

  const handleAdd = async () => {
    if (!newId.trim() || !newLabel.trim()) {
      addToast('error', 'Id and label are required');
      return;
    }
    try {
      await create({ id: newId.trim(), label: newLabel.trim(), description: newDescription.trim(), renderer: newRenderer });
      setNewId(''); setNewLabel(''); setNewDescription(''); setNewRenderer('markdown');
      addToast('success', 'Type created');
    } catch { /* toast handled by api.ts */ }
  };

  const handleRename = async (id: string) => {
    const next = window.prompt(
      `Rename type "${id}" to a new id. Existing deliverables of this type will be migrated.`,
      id,
    );
    if (!next || next.trim() === id) return;
    try {
      const migrated = await rename(id, next.trim());
      addToast('success', `Renamed to "${next.trim()}" (${migrated} deliverable(s) migrated)`);
    } catch { /* toast handled by api.ts */ }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete type "${id}"? This cannot be undone.`)) return;
    try {
      await remove(id);
      addToast('success', 'Type deleted');
    } catch { /* toast handled by api.ts */ }
  };

  const handleReassign = async () => {
    if (!reassignFrom || !reassignTo || reassignFrom === reassignTo) {
      addToast('error', 'Pick two different types');
      return;
    }
    try {
      const migrated = await reassign(reassignFrom, reassignTo);
      addToast('success', `${migrated} deliverable(s) moved from "${reassignFrom}" to "${reassignTo}"`);
      setReassignFrom(''); setReassignTo('');
    } catch { /* toast handled by api.ts */ }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Deliverable Types</h2>
        <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
          Configure the deliverable types for this workspace. These are honored by the CLI, the API,
          and the structured output of agent runs. The <code>renderer</code> controls how a deliverable's
          content is displayed (markdown, or html in an iframe embed). Existing deliverables with a type
          you remove or rename are left untouched — you can reassign them below.
        </p>
      </div>

      {/* Type list */}
      <div className="overflow-hidden rounded-lg border border-[var(--theme-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--theme-border)] bg-[var(--theme-bg-hover)] text-left text-[11px] uppercase tracking-wider text-[var(--theme-text-faint)]">
              <th className="px-3 py-2 font-semibold">Id</th>
              <th className="px-3 py-2 font-semibold">Label</th>
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 font-semibold">Renderer</th>
              <th className="px-3 py-2 text-right font-semibold">Usage</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const count = usage[t.id] ?? 0;
              return (
                <tr key={t.id} className="border-b border-[var(--theme-border-subtle)] last:border-0">
                  <td className="px-3 py-2 align-middle font-mono text-xs text-[var(--theme-text-secondary)]">
                    {t.id}
                    {t.system && (
                      <span className="ml-2 rounded-full bg-[var(--theme-accent-muted)] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[var(--theme-accent)]">
                        system
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {t.system ? (
                      <span className="text-[var(--theme-text-secondary)]">{t.label}</span>
                    ) : (
                      <input
                        className={inputCls + ' w-full'}
                        defaultValue={t.label}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== t.label) update(t.id, { label: v });
                        }}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {t.system ? (
                      <span className="text-xs text-[var(--theme-text-faint)]">{t.description}</span>
                    ) : (
                      <input
                        className={inputCls + ' w-full'}
                        defaultValue={t.description}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== t.description) update(t.id, { description: v });
                        }}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <RendererSelect
                      value={t.renderer}
                      disabled={t.system}
                      onChange={(r) => update(t.id, { renderer: r })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-middle text-[var(--theme-text-secondary)]">{count}</td>
                  <td className="px-3 py-2 text-right align-middle">
                    {!t.system && (
                      <div className="flex justify-end gap-2">
                        <button
                          className="text-xs text-[var(--theme-text-faint)] hover:text-[var(--theme-text-primary)]"
                          onClick={() => handleRename(t.id)}
                          title="Rename id (migrates existing deliverables)"
                        >
                          Rename
                        </button>
                        <button
                          className="text-xs text-[var(--theme-danger)] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                          onClick={() => handleDelete(t.id)}
                          disabled={count > 0}
                          title={count > 0 ? `In use by ${count} deliverable(s) — reassign them first` : 'Delete type'}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add new type */}
      <div className="rounded-lg border border-[var(--theme-border)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--theme-text-primary)]">Add a type</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">Id (slug)</label>
            <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="visual-explainer" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">Label</label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Visual Explainer" />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">Description (shown to agents)</label>
            <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Interactive HTML explainer generated by the visual-explainer skill" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">Renderer</label>
            <RendererSelect value={newRenderer} onChange={setNewRenderer} />
          </div>
          <Button variant="primary" onClick={handleAdd}>Add type</Button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--theme-text-faint)]">
          Ids must be lowercase slugs (letters, digits, hyphens). Pick the <code>html</code> renderer for
          self-contained HTML documents (e.g. from the visual-explainer or playground skills).
        </p>
      </div>

      {/* Bulk reassign */}
      <div className="rounded-lg border border-[var(--theme-border)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--theme-text-primary)]">Reassign deliverables</h3>
        <p className="mb-3 text-[11px] text-[var(--theme-text-faint)]">
          Move every deliverable of one type to another — useful before deleting a type, or to fix
          deliverables left on a removed/renamed type.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">From</label>
            <select className={inputCls} value={reassignFrom} onChange={(e) => setReassignFrom(e.target.value)}>
              <option value="">Select…</option>
              {usedTypeIds.map((id) => (
                <option key={id} value={id}>{id} ({usage[id]})</option>
              ))}
            </select>
          </div>
          <span className="pb-1.5 text-[var(--theme-text-faint)]">→</span>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--theme-text-secondary)]">To</label>
            <select className={inputCls} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">Select…</option>
              {configuredIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={handleReassign}>Move</Button>
        </div>
      </div>
    </div>
  );
}
