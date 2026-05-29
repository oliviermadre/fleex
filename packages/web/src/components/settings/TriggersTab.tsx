import { useEffect, useState } from 'react';
import type {
  Trigger, TriggerScheduleKind, TriggerTargetType, TriggerMode, CreateTriggerInput,
} from '@fleex/shared';
import { useTriggerStore } from '../../stores/triggerStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

const TARGET_TYPES: { value: TriggerTargetType; label: string }[] = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'agent', label: 'Agent' },
  { value: 'skill', label: 'Skill (needs ticket)' },
  { value: 'panel', label: 'Panel (needs ticket)' },
];
const MODES: { value: TriggerMode; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'talk', label: 'Talk' },
  { value: 'edit', label: 'Edit' },
];
const SCHEDULE_KINDS: { value: TriggerScheduleKind; label: string }[] = [
  { value: 'cron', label: 'Cron expression' },
  { value: 'interval', label: 'Fixed interval' },
];

const emptyForm = {
  name: '',
  scheduleKind: 'cron' as TriggerScheduleKind,
  scheduleExpr: '0 * * * *',
  intervalMinutes: 60,
  timezone: 'UTC',
  targetType: 'workflow' as TriggerTargetType,
  targetRef: '',
  mode: 'plan' as TriggerMode,
  descriptionMd: '',
  enabled: true,
};

function scheduleSummary(t: Trigger): string {
  if (t.config.scheduleKind === 'interval') {
    const mins = Math.round((t.config.intervalMs ?? 0) / 60000);
    return `every ${mins} min`;
  }
  return `cron \`${t.config.scheduleExpr}\` (${t.config.timezone ?? 'UTC'})`;
}

export function TriggersTab() {
  const { triggers, loaded, runsByTrigger, loadTriggers, createTrigger, updateTrigger, deleteTrigger, runTrigger, loadRuns } =
    useTriggerStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loaded) loadTriggers(); }, [loaded, loadTriggers]);

  const submit = async () => {
    setError(null);
    if (!form.name.trim() || !form.targetRef.trim()) {
      setError('Name and target reference are required.');
      return;
    }
    const req: CreateTriggerInput = {
      name: form.name.trim(),
      config: form.scheduleKind === 'cron'
        ? { scheduleKind: 'cron', scheduleExpr: form.scheduleExpr.trim(), timezone: form.timezone.trim() || 'UTC' }
        : { scheduleKind: 'interval', intervalMs: Math.max(1, form.intervalMinutes) * 60000 },
      targetType: form.targetType,
      targetRef: form.targetRef.trim(),
      mode: form.mode,
      descriptionMd: form.descriptionMd,
      enabled: form.enabled,
    };
    setBusy(true);
    try {
      await createTrigger(req);
      setForm(emptyForm);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!runsByTrigger[id]) loadRuns(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Triggers</h3>
          <p className="text-xs text-[var(--theme-text-faint)]">
            Scheduled launchers that run a workflow or agent on a cron/interval — no ticket required.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New trigger'}
        </Button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] p-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nightly GitHub import" />

          <div className="grid grid-cols-2 gap-3">
            <Select label="Schedule" options={SCHEDULE_KINDS} value={form.scheduleKind}
              onChange={(e) => setForm({ ...form, scheduleKind: e.target.value as TriggerScheduleKind })} />
            {form.scheduleKind === 'cron' ? (
              <Input label="Cron expression" value={form.scheduleExpr}
                onChange={(e) => setForm({ ...form, scheduleExpr: e.target.value })} placeholder="0 * * * *" />
            ) : (
              <Input label="Interval (minutes)" type="number" min={1} value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })} />
            )}
          </div>

          {form.scheduleKind === 'cron' && (
            <Input label="Timezone (IANA)" value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="UTC" />
          )}

          <div className="grid grid-cols-3 gap-3">
            <Select label="Target type" options={TARGET_TYPES} value={form.targetType}
              onChange={(e) => setForm({ ...form, targetType: e.target.value as TriggerTargetType })} />
            <Input label="Target (slug/name)" value={form.targetRef}
              onChange={(e) => setForm({ ...form, targetRef: e.target.value })} placeholder="github-import" />
            <Select label="Mode" options={MODES} value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as TriggerMode })} />
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--theme-text-secondary)]">
            Mission (markdown, surfaced to the run)
            <textarea
              className="min-h-[80px] rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] p-2 text-sm text-[var(--theme-text-primary)]"
              value={form.descriptionMd}
              onChange={(e) => setForm({ ...form, descriptionMd: e.target.value })}
              placeholder="Pull open GitHub issues and import them as Fleex tickets."
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled
          </label>

          {error && <p className="text-xs text-[var(--theme-danger)]">{error}</p>}

          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
              {busy ? 'Creating…' : 'Create trigger'}
            </Button>
          </div>
        </div>
      )}

      {loaded && triggers.length === 0 && !showForm && (
        <p className="text-xs text-[var(--theme-text-faint)]">No triggers yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {triggers.map((t) => (
          <div key={t.id} className="rounded-md border border-[var(--theme-border-input)]">
            <div className="flex items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  {t.emoji && <span>{t.emoji}</span>}
                  <span className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{t.name}</span>
                  {!t.enabled && <span className="text-[10px] uppercase text-[var(--theme-text-faint)]">disabled</span>}
                </div>
                <span className="text-xs text-[var(--theme-text-faint)]">
                  {scheduleSummary(t)} → {t.targetType} <code>{t.targetRef}</code>
                  {t.nextRunAt && t.enabled && ` · next ${new Date(t.nextRunAt).toLocaleString(undefined, { hour12: false })}`}
                  {t.lastStatus && ` · last: ${t.lastStatus}`}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => updateTrigger(t.id, { enabled: !t.enabled })}>
                {t.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runTrigger(t.id)}>Run now</Button>
              <Button size="sm" variant="ghost" onClick={() => toggleExpand(t.id)}>
                {expanded === t.id ? 'Hide runs' : 'Runs'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete trigger "${t.name}"?`)) deleteTrigger(t.id); }}>
                Delete
              </Button>
            </div>

            {expanded === t.id && (
              <div className="border-t border-[var(--theme-border-input)] p-3">
                {(runsByTrigger[t.id] ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--theme-text-faint)]">No runs yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {(runsByTrigger[t.id] ?? []).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
                        <span className="font-mono">{new Date(r.createdAt).toLocaleString(undefined, { hour12: false })}</span>
                        <span className={r.status === 'failed' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-primary)]'}>{r.status}</span>
                        {r.workflowRunId && <span className="text-[var(--theme-text-faint)]">wf:{r.workflowRunId.slice(0, 8)}</span>}
                        {r.error && <span className="truncate text-[var(--theme-danger)]">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
