import { useEffect, useMemo, useState } from 'react';
import type { Routine, RoutineOverlapPolicy, RoutineTarget, RoutineTargetKind, RoutineTrigger, WorkflowTemplate } from '@fleex/shared';
import { useRoutineStore } from '../../stores/routineStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { TriggerEditor } from './TriggerEditor';
import { RoutineRepoPicker } from './RoutineRepoPicker';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

const TARGET_KIND_OPTIONS: { value: RoutineTargetKind; label: string }[] = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'agent', label: 'Agent' },
  { value: 'skill', label: 'Skill' },
  { value: 'panel', label: 'Panel' },
];

/** Create / edit a routine: its subject, its target primitive, and how it starts. */
export function RoutineEditor({ routine, templates, onClose }: {
  routine?: Routine;
  templates: WorkflowTemplate[];
  onClose: () => void;
}) {
  const { create, update, select } = useRoutineStore();
  const { personas, loaded: personasLoaded, loadPersonas } = useAgentPersonaStore();
  const { skills, loaded: skillsLoaded, loadSkills } = useSkillStore();
  const { panels, loaded: panelsLoaded, loadPanels } = usePanelStore();
  const [name, setName] = useState(routine?.name ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [targetKind, setTargetKind] = useState<RoutineTargetKind>(routine?.target.kind ?? 'workflow');
  const [targetRef, setTargetRef] = useState(routine?.target.ref ?? templates[0]?.id ?? '');
  const [repos, setRepos] = useState<string[]>(routine?.subject.repos ?? []);
  const [brief, setBrief] = useState(routine?.subject.brief ?? '');
  const [trigger, setTrigger] = useState<RoutineTrigger>(routine?.trigger ?? { kind: 'manual' });
  const [webhookEnabled, setWebhookEnabled] = useState(routine?.webhookEnabled ?? false);
  const [overlapPolicy, setOverlapPolicy] = useState<RoutineOverlapPolicy>(routine?.overlapPolicy ?? 'skip');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The non-workflow catalogs load lazily: most routines target a workflow and
  // never need them, but the picker must be full the instant a kind is chosen.
  useEffect(() => {
    if (!personasLoaded) void loadPersonas();
    if (!skillsLoaded) void loadSkills();
    if (!panelsLoaded) void loadPanels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One option list per kind. Refs follow the executorRef convention: workflow
  // by template id, agent by persona name, skill by command name, panel by name.
  const refOptions = useMemo(() => {
    const byKind: Record<RoutineTargetKind, { value: string; label: string }[]> = {
      workflow: templates.map((t) => ({ value: t.id, label: t.name })),
      agent: personas.map((p) => ({ value: p.name, label: p.displayName || p.name })),
      skill: skills.filter((s) => s.enabled).map((s) => ({ value: s.commandName, label: s.displayName || s.commandName })),
      panel: panels.filter((p) => p.enabled).map((p) => ({ value: p.name, label: p.displayName || p.name })),
    };
    return byKind;
  }, [templates, personas, skills, panels]);

  const onKindChange = (kind: RoutineTargetKind) => {
    setTargetKind(kind);
    // A ref never survives a kind switch — it points into another catalog.
    setTargetRef(refOptions[kind][0]?.value ?? '');
  };

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const subject = {
      repos: repos.map((r) => r.trim()).filter(Boolean),
      brief: brief.trim() || undefined,
    };
    const target: RoutineTarget = { kind: targetKind, ref: targetRef };
    try {
      if (routine) {
        await update(routine.id, { name, description: description || null, target, subject, trigger, overlapPolicy, webhookEnabled });
      } else {
        const created = await create({ name, description: description || null, target, subject, trigger, overlapPolicy, webhookEnabled });
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

  const canSubmit = name.trim().length > 0 && targetRef.length > 0 && !saving;

  const currentRefOptions = refOptions[targetKind].length === 0
    ? [{ value: '', label: `No ${targetKind} available` }]
    : refOptions[targetKind];

  return (
    <Modal open onClose={onClose} maxWidth="max-w-xl">
      <div>
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">
          {routine ? 'Edit routine' : 'New routine'}
        </h2>
        <p className="mt-1 text-xs text-[var(--theme-text-secondary)]">
          A routine runs a workflow, agent, skill or panel on a repo, a brief, or nothing at all — no ticket needed.
        </p>
      </div>

      <div className="mt-4 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        <Input
          label="Name"
          className="w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly dependency sweep"
          autoFocus
        />

        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this routine is for"
        />

        {/* The target primitive: any of the four agentic kinds. The rest of the
            routine is kind-agnostic — the brief composes with whatever runs. */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Runs a"
            options={TARGET_KIND_OPTIONS}
            value={targetKind}
            onChange={(e) => onKindChange(e.target.value as RoutineTargetKind)}
          />
          <Select
            label={TARGET_KIND_OPTIONS.find((o) => o.value === targetKind)?.label ?? 'Target'}
            options={currentRefOptions}
            value={targetRef}
            onChange={(e) => setTargetRef(e.target.value)}
          />
        </div>

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

        {/* Webhook is additive to the base trigger, not a kind of its own — a
            routine can be cron 9AM as a safety net AND fire on push. */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
            <input
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => setWebhookEnabled(e.target.checked)}
            />
            Also fire on webhook — external systems POST to a URL, payload included
          </label>
          {webhookEnabled && (
            routine?.webhookSecret ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[11px] text-[var(--theme-text-primary)]">
                  {`${window.location.origin}/api/hooks/${routine.webhookSecret}`}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/api/hooks/${routine.webhookSecret}`)}
                >
                  Copy
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--theme-text-muted)]">
                The URL appears after saving.
              </p>
            )
          )}
          {webhookEnabled && routine?.webhookSecret && (
            <p className="text-[11px] text-[var(--theme-text-muted)]">
              The URL contains the secret — treat it like a password.
            </p>
          )}
        </div>

        {/* Overlap only exists for scheduled triggers: it decides what a tick
            firing mid-run does. A manual routine has no ticks to arbitrate. */}
        {trigger.kind !== 'manual' && (
          <Select
            label="If a tick fires while a run is still active"
            options={[
              { value: 'skip', label: 'Skip — drop the tick' },
              { value: 'queue', label: 'Queue — run it right after' },
            ]}
            value={overlapPolicy}
            onChange={(e) => setOverlapPolicy(e.target.value as RoutineOverlapPolicy)}
          />
        )}

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
