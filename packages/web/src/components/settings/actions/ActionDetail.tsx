import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTION_DEFAULT_TIMEOUT_SEC,
  ACTION_MAX_TIMEOUT_SEC,
  PROBE_DEFAULT_INTERVAL_SEC,
  PROBE_DEFAULT_TIMEOUT_SEC,
  PROBE_INTERVALS_SEC,
  PROBE_MAX_TIMEOUT_SEC,
  diagnoseRun,
} from '@fleex/shared';
import type { ActionRun, ConditionalAction, ProbeTestResult } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint, tintText } from '../../../lib/tints';
import { resolveTemplate } from '../../../lib/templateUtils';
import * as api from '../../../services/api';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { DRAFT_SOURCE_PREFIX, usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { useToastStore } from '../../../stores/toastStore';
import { requestLeave, setLeaveGuard, useUIStore, withoutLeaveGuard, type ActionsScope } from '../../../stores/uiStore';
import { STATUS_LABEL, runDuration, statusDotClass, statusTextClass } from '../../actions/actionStatus';
import { renderIcon } from '../../sidebar/PinnedIcons';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { ActionPreview, type Simulation } from './ActionPreview';
import { readScopeList, saveScope, useScopeList } from './ActionList';
import { AiSuggestBar } from './AiSuggestBar';
import { IconPicker } from './IconPicker';
import { RuleList } from './RuleList';
import { CommandBinaryWarning, RunHintCard } from '../../actions/RunHintCard';
import {
  PIPE_FUNCTIONS,
  TEMPLATE_VARIABLES,
  blankDraft,
  draftWarnings,
  newId,
  normaliseDraft,
  validateDraft,
  type ActionDraft,
  type AiField,
} from './actionModel';
import { AI_BUTTON, CODE_INPUT, Chip, Kbd, SECTION, SparkIcon, SuggestedMark, Switch, TEXT_INPUT, useContextTicket } from './shared';

const EMPTY_RUNS: ActionRun[] = [];

function SectionHead({ n, title, hint, right }: { n: number; title: string; hint: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[var(--theme-bg-overlay)] text-[11px] font-semibold text-[var(--theme-text-secondary)]">{n}</span>
      <div>
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h3>
        <p className="text-xs text-[var(--theme-text-muted)]">{hint}</p>
      </div>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

function FieldError({ text }: { text?: string }) {
  return text ? <p className={cn('mt-1 text-[11px]', tintText('red'))}>{text}</p> : null;
}

/**
 * One action, edited as a local draft in four steps — Identity → On click →
 * Status → Depending on the status — next to a live preview. Nothing persists
 * until Save (⌘S); leaving with unsaved changes asks Save / Discard / Stay.
 */
export function ActionDetail({ scope, id }: { scope: ActionsScope; id: string }) {
  const { list, save } = useScopeList(scope);
  const openActionSettings = useUIStore((s) => s.openActionSettings);
  const pendingNew = useActionsSettingsStore((s) => s.pendingNew);
  const setPendingNew = useActionsSettingsStore((s) => s.setPendingNew);
  const setComposeOpen = useActionsSettingsStore((s) => s.setComposeOpen);
  const aiAvailable = !!useActionsSettingsStore((s) => s.aiAvailable);
  const addToast = useToastStore((s) => s.addToast);
  const isNew = id === 'new';
  const saved = isNew ? null : list.find((a) => a.id === id) ?? null;

  const initial = useMemo<ActionDraft>(
    () => (isNew ? structuredClone(pendingNew?.draft ?? blankDraft()) : saved ? structuredClone(saved) : blankDraft()),
    // Re-seed only when switching actions, not on every list save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, isNew ? pendingNew : null],
  );
  const [draft, setDraft] = useState<ActionDraft>(initial);
  const [baseline, setBaseline] = useState<string>(JSON.stringify(initial));
  const [aiFields, setAiFields] = useState<AiField[]>(isNew ? pendingNew?.aiFields ?? [] : []);
  const [fromAi, setFromAi] = useState(isNew && !!pendingNew?.fromAi);
  const aiNotes = fromAi ? pendingNew?.notes : undefined;
  const [simulation, setSimulation] = useState<Simulation>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guard, setGuard] = useState<null | (() => void)>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [probeTest, setProbeTest] = useState<ProbeTestResult | 'loading' | null>(null);
  const [tryStartedAt, setTryStartedAt] = useState<string | null>(null);
  const [probeAiOpen, setProbeAiOpen] = useState(false);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const contextTicket = useContextTicket();

  useEffect(() => {
    setDraft(initial);
    setBaseline(JSON.stringify(initial));
    setAiFields(isNew ? pendingNew?.aiFields ?? [] : []);
    setFromAi(isNew && !!pendingNew?.fromAi);
    setSimulation(null);
    setPickerOpen(false);
    setProbeTest(null);
    setTryStartedAt(null);
    setShowErrors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const dirty = isNew || JSON.stringify(draft) !== baseline;
  const errors = validateDraft(draft, scope);
  const hasErrors = Object.keys(errors).length > 0;
  const warnings = draftWarnings(draft, scope);
  const index = list.findIndex((a) => a.id === id);

  const update = useCallback((change: Partial<ActionDraft>, field?: AiField) => {
    setDraft((d) => ({ ...d, ...change }));
    if (field) setAiFields((f) => f.filter((x) => x !== field));
  }, []);

  // While there are unsaved changes, every way out of this screen — Esc, the
  // breadcrumb, ‹ ›, another Settings tab, another panel, the browser's Back —
  // goes through the store's leave guard, which opens the Save / Discard / Stay dialog.
  useEffect(() => {
    if (!dirty) return;
    return setLeaveGuard((proceed) => setGuard(() => proceed));
  }, [dirty]);

  const back = useCallback(() => openActionSettings(scope), [openActionSettings, scope]);

  const saving = useRef(false);
  const doSave = useCallback(async (): Promise<boolean> => {
    if (hasErrors) {
      setShowErrors(true);
      return false;
    }
    // ⌘S twice (or ⌘S then Save) while the first PUT is in flight would append the new action twice.
    if (saving.current) return false;
    saving.current = true;
    const value = normaliseDraft(draft, scope);
    // Match on the draft's id, not the route's: a `new` draft is already in the
    // list once the store took the optimistic update.
    const next = list.some((a) => a.id === value.id) ? list.map((a) => (a.id === value.id ? value : a)) : [...list, value];
    try {
      await save(next);
    } finally {
      saving.current = false;
    }
    const savedDraft = structuredClone(value) as ActionDraft;
    setDraft(savedDraft);
    setBaseline(JSON.stringify(savedDraft));
    setAiFields([]);
    setFromAi(false);
    addToast('success', 'Saved', scope === 'pinned' && 'status' in value && value.status ? { detail: 'Probe scheduled — first check now' } : undefined);
    if (isNew) {
      setPendingNew(null);
      // Saved: moving from `new` to the action's own route is not leaving.
      withoutLeaveGuard(() => openActionSettings(scope, value.id));
    }
    return true;
  }, [hasErrors, draft, scope, list, save, addToast, isNew, setPendingNew, openActionSettings]);

  const discard = () => {
    if (isNew) {
      setPendingNew(null);
      withoutLeaveGuard(() => openActionSettings(scope));
      return;
    }
    const restored = JSON.parse(baseline) as ActionDraft;
    setDraft(restored);
    setAiFields([]);
  };

  // ⌘S saves, Esc goes back (unless typing, or a modal owns Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // A floating terminal keeps its keys (Esc is Claude Code's interrupt); a modal on top owns them.
      if ((e.target as HTMLElement | null)?.closest?.('[data-floating-panel]')) return;
      if (document.querySelector('[data-overlay-top]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void doSave();
        return;
      }
      if (e.key === 'Escape' && !guard) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          (e.target as HTMLElement).blur();
          return;
        }
        if (pickerOpen) {
          setPickerOpen(false);
          return;
        }
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave, back, guard, pickerOpen]);

  // Leaving the page entirely with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // ─── Try (run the command as typed, without saving) ───
  const run = usePinnedActionsStore((s) => s.run);
  const tryRuns = usePinnedActionsStore((s) => s.runs[`${DRAFT_SOURCE_PREFIX}${draft.id}`] ?? EMPTY_RUNS);
  const tryRunning = usePinnedActionsStore((s) => !!s.running[`${DRAFT_SOURCE_PREFIX}${draft.id}`]);
  const tryResult = tryStartedAt ? tryRuns.find((r) => r.startedAt >= tryStartedAt) : undefined;
  const tryHint = tryResult?.finishedAt ? diagnoseRun(tryResult) : null;
  // A probe that cannot even find its program is a broken probe, not a broken tool:
  // say so instead of letting the red dot blame gcloud.
  const probeHint = probeTest && probeTest !== 'loading' && probeTest.source === 'exit-code' && probeTest.exitCode === 127
    ? diagnoseRun({ exitCode: probeTest.exitCode, stdout: probeTest.stdout, stderr: probeTest.stderr, command: draft.status?.command })
    : null;
  const canTry = draft.actionType === 'shell' && !!draft.actionValue.trim() && (scope === 'pinned' || !!contextTicket);

  const tryCommand = async () => {
    if (!canTry) return;
    const ticket = scope === 'ticket' ? contextTicket : null;
    const command = ticket ? resolveTemplate(draft.actionValue, ticket) : draft.actionValue;
    setTryStartedAt(new Date(Date.now() - 1000).toISOString());
    // Same as the real click: materialize the ticket's workspace before running in it.
    const hasWorkspace = ticket ? await api.ensureTicketWorkspace(ticket.ticket_id) : false;
    void run({
      sourceId: `${DRAFT_SOURCE_PREFIX}${draft.id}`,
      sourceKind: scope === 'pinned' ? 'pinned' : 'workspace',
      label: `Try: ${draft.label || 'draft'}`,
      command,
      ...(ticket && hasWorkspace ? { cwd: ticket.workspace_path } : {}),
      ...(draft.actionTimeoutSec ? { timeoutSec: draft.actionTimeoutSec } : {}),
    });
  };

  const testProbe = async () => {
    if (!draft.status?.command.trim()) return;
    setProbeTest('loading');
    try {
      setProbeTest(await api.testPinnedProbe(draft.status.command, draft.status.timeoutSec));
    } catch {
      setProbeTest(null);
    }
  };

  const insertVariable = (variable: string) => {
    const ta = commandRef.current;
    const value = draft.actionValue;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    update({ actionValue: value.slice(0, start) + variable + value.slice(end) }, 'actionValue');
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const setProbe = (on: boolean) => {
    if (on) update({ status: draft.status ?? { command: '', intervalSec: PROBE_DEFAULT_INTERVAL_SEC, timeoutSec: PROBE_DEFAULT_TIMEOUT_SEC } });
    else update({ status: undefined }, 'status');
    setSimulation(null);
  };

  const duplicate = () =>
    requestLeave(() => {
      const copy = { ...structuredClone(draft), id: newId(), label: `${draft.label} (copy)` };
      setPendingNew({ draft: copy, aiFields: [], fromAi: false });
      openActionSettings(scope, 'new');
    });

  const remove = () => {
    if (isNew) {
      discard();
      return;
    }
    const removed = list[index];
    if (!removed) return;
    void save(list.filter((a) => a.id !== id));
    withoutLeaveGuard(() => openActionSettings(scope));
    addToast('info', `“${removed.label || 'Untitled'}” deleted`, {
      durationMs: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          const next = [...readScopeList(scope)];
          next.splice(Math.min(index, next.length), 0, removed);
          void saveScope(scope, next);
        },
      },
    });
  };

  if (!isNew && !saved) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--theme-border-input)] p-10 text-center text-sm text-[var(--theme-text-muted)]">
        This action no longer exists.{' '}
        <button type="button" className="text-[var(--theme-accent)] hover:underline" onClick={() => openActionSettings(scope)}>Back to the list</button>
      </div>
    );
  }

  const pinned = scope === 'pinned';
  const rules = draft.conditionalActions ?? [];
  const ruleErrors = Object.fromEntries(rules.map((_, i) => [i, showErrors ? errors[`rule:${i}`] : undefined]));

  return (
    <div className="pb-24">
      {/* Top bar: breadcrumb, position, duplicate / delete */}
      <div className="mb-4 flex items-center gap-2">
        <button type="button" aria-label="Back to the list (Esc)" className="rounded px-1.5 py-0.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]" onClick={back}>←</button>
        <nav className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)]" aria-label="Breadcrumb">
          <button type="button" className="hover:text-[var(--theme-text-primary)]" onClick={back}>Actions</button>›
          <button type="button" className="hover:text-[var(--theme-text-primary)]" onClick={back}>{pinned ? 'Top bar' : 'Ticket'}</button>›
          <span className="font-medium text-[var(--theme-text-primary)]">{draft.label || 'New action'}</span>
        </nav>
        <span className="flex-1" />
        {!isNew && index >= 0 && (
          <>
            <span className="text-[11px] text-[var(--theme-text-muted)]">{index + 1} / {list.length}</span>
            <Button variant="ghost" size="sm" aria-label="Previous action" onClick={() => openActionSettings(scope, list[(index - 1 + list.length) % list.length]!.id)}>‹</Button>
            <Button variant="ghost" size="sm" aria-label="Next action" onClick={() => openActionSettings(scope, list[(index + 1) % list.length]!.id)}>›</Button>
            <Button variant="ghost" size="sm" onClick={duplicate}>Duplicate</Button>
          </>
        )}
        <Button variant="ghost" size="sm" className={tintText('red')} onClick={remove}>{isNew ? 'Discard' : 'Delete'}</Button>
      </div>

      {fromAi && (
        <div className={cn('mb-4 flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs', tint('purple'))}>
          <SparkIcon size={14} />
          <span>
            <b>Draft generated by Haiku.</b> Review the commands, test the probe, then save. Nothing runs until you click.
            {aiNotes && <span className="mt-0.5 block text-[var(--theme-text-secondary)]">{aiNotes}</span>}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setComposeOpen(true)}>Rephrase</Button>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_344px] items-start gap-5">
        <div className="flex flex-col gap-3.5">
          {/* 1. Identity */}
          <section className={SECTION} aria-labelledby="sec-identity">
            <SectionHead n={1} title="Identity" hint="What you see in the bar." />
            <div className="grid grid-cols-[76px_1fr] items-start gap-4">
              <button
                type="button"
                aria-label="Change icon"
                className="relative flex h-[76px] w-[76px] items-center justify-center rounded-2xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)] hover:border-[var(--theme-accent)]"
                onClick={() => setPickerOpen((o) => !o)}
              >
                {draft.icon ? renderIcon(draft, 34) : <span className="text-2xl font-semibold">{(draft.label || '?').charAt(0).toUpperCase()}</span>}
                <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--theme-border-input)] px-2 text-[10px] text-[var(--theme-text-secondary)]">{pickerOpen ? 'close' : 'change'}</span>
              </button>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="action-label">
                  Name {aiFields.includes('label') && <SuggestedMark />}
                </label>
                <input id="action-label" className={TEXT_INPUT} placeholder="e.g. GitHub CLI" value={draft.label} onChange={(e) => update({ label: e.target.value }, 'label')} />
                <FieldError text={showErrors ? errors.label : undefined} />
                <div className="mt-2.5 flex items-center gap-2">
                  {!pickerOpen && (
                    <button type="button" className={AI_BUTTON} onClick={() => setPickerOpen(true)}>
                      {aiAvailable ? <><SparkIcon /> Suggest an icon</> : 'Choose an icon'}
                    </button>
                  )}
                  {aiFields.includes('icon') && <SuggestedMark />}
                  <span className="text-[11px] text-[var(--theme-text-faint)]">or click the tile</span>
                </div>
              </div>
            </div>
            {pickerOpen && (
              <IconPicker
                aiAvailable={aiAvailable}
                label={draft.label}
                command={draft.actionValue || undefined}
                probeCommand={draft.status?.command || undefined}
                current={draft.icon}
                onClose={() => setPickerOpen(false)}
                onPick={(icon, fromAiPick) => {
                  update(icon);
                  setAiFields((f) => (fromAiPick ? [...f.filter((x) => x !== 'icon'), 'icon'] : f.filter((x) => x !== 'icon')));
                }}
              />
            )}
          </section>

          {/* 2. On click */}
          <section className={SECTION} aria-labelledby="sec-click">
            <SectionHead
              n={2}
              title="On click"
              hint={pinned && draft.status ? 'Default action, used when no status rule applies.' : 'What happens when you click.'}
              right={
                <div className="inline-flex gap-0.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-0.5" role="radiogroup" aria-label="Action type">
                  {(['shell', 'url'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={draft.actionType === t}
                      className={cn('rounded-md px-2.5 py-1 text-xs font-medium', draft.actionType === t ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]')}
                      onClick={() => update({ actionType: t })}
                    >
                      {t === 'shell' ? 'Command' : 'URL'}
                    </button>
                  ))}
                </div>
              }
            />
            {aiAvailable && (
              <AiSuggestBar
                kind="action"
                scope={scope}
                context={{ label: draft.label || undefined, currentCommand: draft.actionValue || undefined, probeCommand: draft.status?.command || undefined }}
                placeholder={draft.actionType === 'url' ? 'Describe the page to open… e.g. “the Datadog APM dashboard”' : 'Describe what the command should do… e.g. “log me into gcloud and refresh the ADC”'}
                onApply={(command) => {
                  update({ actionValue: command, ...(/^https?:\/\//.test(command) ? { actionType: 'url' as const } : {}) });
                  setAiFields((f) => [...f.filter((x) => x !== 'actionValue'), 'actionValue']);
                }}
              />
            )}
            <label className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="action-value">
              {draft.actionType === 'url' ? 'URL' : 'Command'} {aiFields.includes('actionValue') && <SuggestedMark />}
            </label>
            <textarea
              id="action-value"
              ref={commandRef}
              className={CODE_INPUT}
              rows={draft.actionType === 'url' ? 1 : 2}
              spellCheck={false}
              placeholder={draft.actionType === 'url' ? 'https://…' : pinned ? 'gh auth login --web' : 'cursor "{{workspace_path}}"'}
              value={draft.actionValue}
              onChange={(e) => update({ actionValue: e.target.value }, 'actionValue')}
            />
            <FieldError text={showErrors ? errors.actionValue : undefined} />
            {draft.actionType === 'shell' && <CommandBinaryWarning command={draft.actionValue} />}
            {warnings.map((w) => <p key={w} className={cn('mt-1 text-[11px]', tintText('yellow'))}>{w}</p>)}
            {!pinned && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[11px] text-[var(--theme-text-muted)]">Insert:</span>
                {TEMPLATE_VARIABLES.map(([v, desc]) => (
                  <button key={v} type="button" title={desc} className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]" onClick={() => insertVariable(v)}>{v}</button>
                ))}
                <details className="ml-1 text-[11px]">
                  <summary className="cursor-pointer text-[var(--theme-accent)]">| pipes…</summary>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-[var(--theme-border)] p-2">
                    <span className="col-span-2 text-[var(--theme-text-muted)]">Transform a variable: <code className="font-mono">{'{{variable | fn | fn(arg)}}'}</code></span>
                    {PIPE_FUNCTIONS.map(([fn, desc]) => (
                      <span key={fn}><code className="font-mono text-[var(--theme-text-secondary)]">{fn}</code> <span className="text-[var(--theme-text-muted)]">{desc}</span></span>
                    ))}
                  </div>
                </details>
              </div>
            )}
            {draft.actionType === 'shell' && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Chip>zsh -l · no TTY</Chip>
                <Chip>cwd {pinned ? '~' : '{{workspace_path}}'}</Chip>
                <Chip>timeout {draft.actionTimeoutSec ?? ACTION_DEFAULT_TIMEOUT_SEC} s</Chip>
                <span className="flex-1" />
                <span title={!canTry && scope === 'ticket' && !contextTicket ? 'Open a ticket first: ticket actions run in its workspace.' : undefined}>
                  <Button size="sm" variant="secondary" disabled={!canTry || tryRunning} onClick={() => void tryCommand()}>▶ Try</Button>
                </span>
              </div>
            )}
            {tryStartedAt && (tryRunning && !tryResult?.finishedAt ? (
              <div className="mt-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2 text-[11.5px] text-[var(--theme-text-muted)]">Running…</div>
            ) : tryResult?.finishedAt ? (
              <OutputPanel
                title={<span className={tryResult.exitCode === 0 ? statusTextClass('ok') : statusTextClass('ko')}>{tryResult.exitCode === 0 ? '✓' : '✗'} {tryResult.timedOut ? 'timed out' : `exit ${tryResult.exitCode ?? '—'}`}</span>}
                meta={runDuration(tryResult.startedAt, tryResult.finishedAt)}
                body={[tryResult.stdout, tryResult.stderr].filter(Boolean).join('\n') || '(no output)'}
                onClose={() => setTryStartedAt(null)}
              />
            ) : null)}
            {tryResult?.finishedAt && tryHint && <RunHintCard hint={tryHint} className="mt-2" />}
          </section>

          {/* 3. Status */}
          {pinned ? (
            <section className={SECTION} aria-labelledby="sec-status">
              <SectionHead
                n={3}
                title="Status"
                hint="A probe run regularly colours the dot."
                right={
                  <>
                    {aiFields.includes('status') && <SuggestedMark />}
                    <Switch on={!!draft.status} onToggle={() => setProbe(!draft.status)} label="Status probe" />
                    <span className="text-xs text-[var(--theme-text-secondary)]">{draft.status ? 'On' : 'Off'}</span>
                  </>
                }
              />
              {draft.status ? (
                <>
                  {aiAvailable && (
                    <AiSuggestBar
                      autoFocus={probeAiOpen}
                      kind="probe"
                      scope="pinned"
                      context={{ label: draft.label || undefined, defaultCommand: draft.actionValue || undefined, currentCommand: draft.status.command || undefined }}
                      placeholder="How do you know it's OK? e.g. “check gh is logged in and show my quota”"
                      onApply={(command) => {
                        update({ status: { ...draft.status!, command } });
                        setAiFields((f) => [...f.filter((x) => x !== 'status'), 'status']);
                      }}
                    />
                  )}
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="probe-command">
                    Probe command <span className="font-normal text-[var(--theme-text-muted)]">exit 0 = OK · or JSON {'{status, tooltip, badge}'}</span>
                  </label>
                  <textarea
                    id="probe-command"
                    className={CODE_INPUT}
                    rows={4}
                    spellCheck={false}
                    placeholder="gh auth status >/dev/null 2>&1"
                    value={draft.status.command}
                    onChange={(e) => update({ status: { ...draft.status!, command: e.target.value } }, 'status')}
                  />
                  <CommandBinaryWarning command={draft.status.command} />
                  <FieldError text={showErrors ? errors.probe : undefined} />
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] text-[var(--theme-text-muted)]">Check every</span>
                    {PROBE_INTERVALS_SEC.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        aria-pressed={draft.status!.intervalSec === sec}
                        className={cn('h-[26px] rounded-md border px-2.5 text-xs', draft.status!.intervalSec === sec ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]')}
                        onClick={() => update({ status: { ...draft.status!, intervalSec: sec } })}
                      >
                        {sec < 60 ? `${sec} s` : `${sec / 60} min`}
                      </button>
                    ))}
                    <span className="flex-1" />
                    <Button size="sm" variant="secondary" disabled={!draft.status.command.trim() || probeTest === 'loading'} onClick={() => void testProbe()}>Test the probe</Button>
                  </div>
                  {probeTest === 'loading' && <div className="mt-2.5 text-[11.5px] text-[var(--theme-text-muted)]">Probing…</div>}
                  {probeTest && probeTest !== 'loading' && (
                    <OutputPanel
                      title={
                        <span className={cn('flex items-center gap-1.5', statusTextClass(probeTest.snapshot.status))}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(probeTest.snapshot.status))} />
                          {STATUS_LABEL[probeTest.snapshot.status]}
                          {probeTest.snapshot.badge && <Chip className="h-4">{probeTest.snapshot.badge}</Chip>}
                        </span>
                      }
                      meta={`read from ${probeTest.source === 'json' ? 'JSON' : probeTest.source === 'exit-code' ? `exit code ${probeTest.exitCode}` : 'error'} · ${((probeTest.snapshot.durationMs ?? 0) / 1000).toFixed(1)} s`}
                      body={[probeTest.snapshot.tooltip && probeTest.source !== 'exit-code' ? `tooltip: ${probeTest.snapshot.tooltip}` : null, probeTest.stdout, probeTest.stderr].filter(Boolean).join('\n') || '(no output)'}
                      onClose={() => setProbeTest(null)}
                    />
                  )}
                  {probeHint && <RunHintCard hint={probeHint} className="mt-2" />}
                </>
              ) : (
                <div className="flex items-center gap-3.5 rounded-lg border border-dashed border-[var(--theme-border-input)] p-4">
                  <div className="flex-1">
                    <b className="block text-xs font-medium text-[var(--theme-text-primary)]">No probe</b>
                    <span className="text-xs text-[var(--theme-text-muted)]">The button shows no status. Turn it on to see at a glance whether the tool is ready.</span>
                  </div>
                  {aiAvailable && (
                    <button type="button" className={AI_BUTTON} onClick={() => { setProbe(true); setProbeAiOpen(true); }}>
                      <SparkIcon /> Propose a probe
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className={SECTION}>
              <div className="flex items-center gap-3.5 rounded-lg border border-dashed border-[var(--theme-border-input)] p-4">
                <div>
                  <b className="block text-xs font-medium text-[var(--theme-text-primary)]">Per-ticket status — coming later</b>
                  <span className="text-xs text-[var(--theme-text-muted)]">Ticket actions get run feedback (toast + logs) but no probe yet.</span>
                </div>
              </div>
            </section>
          )}

          {/* 4. Depending on the status */}
          {pinned && draft.status && (
            <section className={SECTION} aria-labelledby="sec-rules">
              <SectionHead
                n={4}
                title="Depending on the status"
                hint="The click changes with the dot. First matching rule wins, top to bottom."
                right={
                  <>
                    {aiFields.includes('conditionalActions') && <SuggestedMark />}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => update({ conditionalActions: [...rules, { id: newId(), label: '', when: ['ok'], actionType: 'shell', actionValue: '' } satisfies ConditionalAction] }, 'conditionalActions')}
                    >
                      + Rule
                    </Button>
                  </>
                }
              />
              <RuleList
                rules={rules}
                onChange={(next) => update({ conditionalActions: next }, 'conditionalActions')}
                defaultCommand={draft.actionValue}
                probeCommand={draft.status.command}
                label={draft.label}
                aiAvailable={aiAvailable}
                errors={ruleErrors}
              />
            </section>
          )}

          {/* 5. Advanced */}
          <section className={SECTION}>
            <details>
              <summary className="cursor-pointer text-xs text-[var(--theme-text-secondary)]">Advanced <span className="text-[var(--theme-text-muted)]">— timeouts, environment</span></summary>
              <div className="mt-3.5 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="action-timeout">Action timeout (s)</label>
                  <input
                    id="action-timeout"
                    type="number"
                    min={1}
                    max={ACTION_MAX_TIMEOUT_SEC}
                    className={TEXT_INPUT}
                    value={draft.actionTimeoutSec ?? ACTION_DEFAULT_TIMEOUT_SEC}
                    onChange={(e) => update({ actionTimeoutSec: Math.min(ACTION_MAX_TIMEOUT_SEC, Math.max(1, parseInt(e.target.value, 10) || ACTION_DEFAULT_TIMEOUT_SEC)) })}
                  />
                  <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">Default {ACTION_DEFAULT_TIMEOUT_SEC} · max {ACTION_MAX_TIMEOUT_SEC}. A browser login waits for you.</p>
                </div>
                {pinned && draft.status && (
                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-medium text-[var(--theme-text-secondary)]" htmlFor="probe-timeout">Probe timeout (s)</label>
                    <input
                      id="probe-timeout"
                      type="number"
                      min={1}
                      max={PROBE_MAX_TIMEOUT_SEC}
                      className={TEXT_INPUT}
                      value={draft.status.timeoutSec ?? PROBE_DEFAULT_TIMEOUT_SEC}
                      onChange={(e) => update({ status: { ...draft.status!, timeoutSec: Math.min(PROBE_MAX_TIMEOUT_SEC, Math.max(1, parseInt(e.target.value, 10) || PROBE_DEFAULT_TIMEOUT_SEC)) } })}
                    />
                    <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">Default {PROBE_DEFAULT_TIMEOUT_SEC} · max {PROBE_MAX_TIMEOUT_SEC}. Past it, the status becomes Unknown.</p>
                  </div>
                )}
              </div>
              <p className="mt-3 text-[11px] text-[var(--theme-text-muted)]">
                Runs in a non-interactive zsh login shell without a TTY: no prompt, no <code className="font-mono">read</code>. PATH comes from your <code className="font-mono">.zprofile</code>.
              </p>
            </details>
          </section>
        </div>

        <ActionPreview draft={draft} scope={scope} list={list} simulation={simulation} onSimulate={setSimulation} />
      </div>

      {/* Floating save bar */}
      {dirty && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] py-2 pl-4 pr-2 text-xs text-[var(--theme-text-primary)] shadow-2xl" role="region" aria-label="Unsaved changes">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass('warn'))} />
          {isNew ? 'New action, not saved yet' : 'Unsaved changes'}
          {showErrors && hasErrors && <span className={tintText('red')}>Fix the highlighted fields</span>}
          <Button variant="ghost" size="sm" onClick={discard}>{isNew ? 'Discard' : 'Revert'}</Button>
          <Button variant="primary" size="sm" onClick={() => void doSave()}>Save <Kbd>⌘S</Kbd></Button>
        </div>
      )}

      <Modal open={!!guard} onClose={() => setGuard(null)} maxWidth="max-w-sm">
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Unsaved changes</h2>
        <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">Save “{draft.label || 'this action'}” before leaving?</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setGuard(null)}>Stay</Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const go = guard;
              setGuard(null);
              if (isNew) setPendingNew(null);
              setDraft(JSON.parse(baseline) as ActionDraft);
              go?.();
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              const go = guard;
              setGuard(null);
              if (await doSave()) go?.();
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function OutputPanel({ title, meta, body, onClose }: { title: React.ReactNode; meta: string; body: string; onClose: () => void }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-2.5 py-1.5 text-[11.5px] text-[var(--theme-text-secondary)]">
        {title} <span className="text-[var(--theme-text-muted)]">· {meta}</span>
        <button type="button" aria-label="Dismiss output" className="ml-auto text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={onClose}>✕</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-snug text-[var(--theme-text-secondary)]">{body}</pre>
    </div>
  );
}
