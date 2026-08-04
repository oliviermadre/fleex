import { useState } from 'react';
import type { Routine, RoutineTrigger, WorkflowTemplate } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { TriggerEditor } from './TriggerEditor';
import { RoutineRepoPicker } from './RoutineRepoPicker';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

/** Create / edit a routine: its subject, its workflow, and how it starts. */
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
  const [repos, setRepos] = useState<string[]>(routine?.subject.repos ?? []);
  const [brief, setBrief] = useState(routine?.subject.brief ?? '');
  const [trigger, setTrigger] = useState<RoutineTrigger>(routine?.trigger ?? { kind: 'manual' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const subject = {
      repos: repos.map((r) => r.trim()).filter(Boolean),
      brief: brief.trim() || undefined,
    };
    try {
      if (routine) {
        await update(routine.id, { name, emoji, description: description || null, templateId, subject, trigger });
      } else {
        const created = await create({ name, emoji, description: description || null, templateId, subject, trigger });
        await select(created.id);
      }
      onClose();
    } catch (err) {
      // A 422 here is a malformed cron / timezone / runAt. Surfaced verbatim:
      // the server's reason is more precise than anything we could re-word.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = name.trim().length > 0 && templateId.length > 0 && !saving;

  const templateOptions = templates.length === 0
    ? [{ value: '', label: 'No workflow template available' }]
    : templates.map((t) => ({
      value: t.id,
      label: `${t.emoji ? `${t.emoji} ` : ''}${t.name}`,
    }));

  return (
    <Modal open onClose={onClose} maxWidth="max-w-xl">
      <div>
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">
          {routine ? 'Edit routine' : 'New routine'}
        </h2>
        <p className="mt-1 text-xs text-[var(--theme-text-secondary)]">
          A routine runs a workflow on a repo, a brief, or nothing at all — no ticket needed.
        </p>
      </div>

      <div className="mt-4 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        <div className="flex gap-2">
          <div className="w-20 shrink-0">
            <Input
              label="Emoji"
              className="w-full"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              label="Name"
              className="w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly dependency sweep"
              autoFocus
            />
          </div>
        </div>

        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this routine is for"
        />

        <Select
          label="Workflow"
          options={templateOptions}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        />

        <RoutineRepoPicker value={repos} onChange={setRepos} />

        <div className="flex flex-col gap-1">
          <label htmlFor="routine-brief" className="text-xs font-medium text-[var(--theme-text-secondary)]">
            Brief
          </label>
          <textarea
            id="routine-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder="Free-form context injected into the agent prompt…"
            className={cn(
              'rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)]',
              'placeholder:text-[var(--theme-text-muted)]',
              'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
            )}
          />
        </div>

        <TriggerEditor value={trigger} onChange={setTrigger} />

        {error && <p className={cn('text-xs', tintText('red'))}>{error}</p>}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--theme-border)] pt-4">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!canSubmit} onClick={() => void onSubmit()}>
          {saving ? 'Saving…' : routine ? 'Save changes' : 'Create routine'}
        </Button>
      </div>
    </Modal>
  );
}
