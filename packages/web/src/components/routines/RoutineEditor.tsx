import { useState } from 'react';
import type { Routine, WorkflowTemplate } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';

/**
 * Create / edit a routine. Only the `manual` trigger is offered: the scheduler
 * (Lot 3) is not wired yet and the server rejects `once` / `cron`, so exposing
 * them here would only produce a 422.
 */
export function RoutineEditor({ routine, templates, onClose }: {
  routine?: Routine;
  templates: WorkflowTemplate[];
  onClose: () => void;
}) {
  const { create, update, select } = useRoutineStore();
  const [name, setName] = useState(routine?.name ?? '');
  const [emoji, setEmoji] = useState(routine?.emoji ?? '🔁');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [templateId, setTemplateId] = useState(routine?.templateId ?? templates[0]?.id ?? '');
  const [repos, setRepos] = useState((routine?.subject.repos ?? []).join('\n'));
  const [brief, setBrief] = useState(routine?.subject.brief ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const subject = {
      repos: repos.split('\n').map((r) => r.trim()).filter(Boolean),
      brief: brief.trim() || undefined,
    };
    try {
      if (routine) {
        await update(routine.id, { name, emoji, description: description || null, templateId, subject });
      } else {
        const created = await create({ name, emoji, description: description || null, templateId, subject });
        await select(created.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = name.trim().length > 0 && templateId.length > 0 && !saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg bg-[var(--theme-bg-primary)] border border-[var(--theme-border)] p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">
          {routine ? 'Edit routine' : 'New routine'}
        </h2>

        <div className="flex gap-2">
          <Field label="Emoji" className="w-20">
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Name" className="flex-1">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
          </Field>
        </div>

        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </Field>

        <Field label="Workflow">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
            {templates.length === 0 && <option value="">No workflow template available</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.emoji ? `${t.emoji} ` : ''}{t.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Repositories (one org/name per line)">
          <textarea value={repos} onChange={(e) => setRepos(e.target.value)} rows={3} className={inputCls} />
        </Field>

        <Field label="Brief">
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} className={inputCls} />
        </Field>

        <p className="text-[11px] text-[var(--theme-text-faint)]">
          Trigger: manual. Scheduled and recurring triggers ship with the routine scheduler.
        </p>

        {error && <p className="text-sm text-[var(--theme-danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-secondary)]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void onSubmit()}
            className="text-sm px-3 py-1.5 rounded bg-[var(--theme-accent)] text-[var(--theme-accent-contrast)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-2 py-1.5 text-sm rounded bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] text-[var(--theme-text-primary)]';

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs text-[var(--theme-text-faint)]">{label}</span>
      {children}
    </label>
  );
}
