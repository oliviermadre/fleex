import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PinnedIcon, WorkspaceAction } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { useToastStore } from '../../../stores/toastStore';
import { useUIStore, type ActionsScope } from '../../../stores/uiStore';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { PinnedActionButton } from '../../actions/PinnedActionButton';
import { STATUS_LABEL, statusDotClass, statusTextClass } from '../../actions/actionStatus';
import { renderIcon } from '../../sidebar/PinnedIcons';
import { Button } from '../../ui/Button';
import { TEMPLATES, isEnabled, moveItem, newId } from './actionModel';
import { useReorderableList } from './useReorderableList';
import { AI_BUTTON, Chip, Dropdown, Kbd, MenuButton, SparkIcon, Switch, TEXT_INPUT, useRunFromSettings } from './shared';

type AnyAction = PinnedIcon | WorkspaceAction;
const UNDO_MS = 8000;

export function useScopeList(scope: ActionsScope): { list: AnyAction[]; save: (next: AnyAction[]) => Promise<void> } {
  const pinnedIcons = useSettingsStore((s) => s.settings.pinnedIcons);
  const workspaceActions = useSettingsStore((s) => s.settings.workspaceActions);
  const savePinnedIcons = useSettingsStore((s) => s.savePinnedIcons);
  const saveWorkspaceActions = useSettingsStore((s) => s.saveWorkspaceActions);
  return scope === 'pinned'
    ? { list: pinnedIcons, save: (next) => savePinnedIcons(next as PinnedIcon[]) }
    : { list: workspaceActions ?? [], save: saveWorkspaceActions };
}

function highlightVars(command: string) {
  return command.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
    part.startsWith('{{') ? <span key={i} className="text-[var(--theme-text-secondary)]">{part}</span> : part,
  );
}

function intervalLabel(sec: number): string {
  return sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}

/**
 * Settings › Actions list. Scanning, reordering, hiding and deleting happen
 * here and persist immediately (with Undo); editing a command happens in the
 * detail screen, behind an explicit Save.
 */
export function ActionList({ scope }: { scope: ActionsScope }) {
  const { list, save } = useScopeList(scope);
  const statuses = usePinnedActionsStore((s) => s.statuses);
  const running = usePinnedActionsStore((s) => s.running);
  const lastRuns = usePinnedActionsStore((s) => s.runs);
  const refresh = usePinnedActionsStore((s) => s.refresh);
  const openLogs = usePinnedActionsStore((s) => s.openLogs);
  const pinnedCount = useSettingsStore((s) => s.settings.pinnedIcons.length);
  const ticketCount = useSettingsStore((s) => (s.settings.workspaceActions ?? []).length);
  const openActionSettings = useUIStore((s) => s.openActionSettings);
  const aiAvailable = useActionsSettingsStore((s) => s.aiAvailable);
  const setComposeOpen = useActionsSettingsStore((s) => s.setComposeOpen);
  const setPendingNew = useActionsSettingsStore((s) => s.setPendingNew);
  const addToast = useToastStore((s) => s.addToast);
  const runFromSettings = useRunFromSettings(scope);
  const [filter, setFilter] = useState('');
  const rowsRef = useRef<HTMLDivElement>(null);

  const reorder = useCallback(
    (next: AnyAction[]) => {
      void save(next);
      addToast('info', 'Order updated', { durationMs: 1800 });
    },
    [save, addToast],
  );
  const { rowProps, dropIndicator, draggingId } = useReorderableList(list, reorder, `application/x-fleex-action-${scope}`);

  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () => (q ? list.filter((a) => `${a.label} ${a.actionValue}`.toLowerCase().includes(q)) : list),
    [list, q],
  );

  const health = useMemo(() => {
    const counts = { ok: 0, warn: 0, ko: 0, unknown: 0, none: 0 };
    for (const a of list) {
      const probed = scope === 'pinned' && !!(a as PinnedIcon).status;
      if (!probed) counts.none += 1;
      else counts[statuses[a.id]?.status ?? 'unknown'] += 1;
    }
    return counts;
  }, [list, statuses, scope]);

  const startNew = (templateKey: string) => {
    const template = TEMPLATES[scope].find((t) => t.key === templateKey) ?? TEMPLATES[scope][TEMPLATES[scope].length - 1]!;
    setPendingNew({ draft: template.build(), aiFields: [], fromAi: false });
    openActionSettings(scope, 'new');
  };

  const remove = (id: string) => {
    const index = list.findIndex((a) => a.id === id);
    const removed = list[index];
    if (!removed) return;
    void save(list.filter((a) => a.id !== id));
    addToast('info', `“${removed.label || 'Untitled'}” deleted`, {
      durationMs: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          // Re-read the list at undo time: other edits may have happened in between.
          const current = readScopeList(scope);
          const next = [...current];
          next.splice(Math.min(index, next.length), 0, removed);
          void saveScope(scope, next);
        },
      },
    });
  };

  const toggle = (id: string) => {
    const target = list.find((a) => a.id === id);
    if (!target) return;
    const nowEnabled = !isEnabled(target);
    void save(list.map((a) => (a.id === id ? { ...a, enabled: nowEnabled } : a)));
    addToast('info', nowEnabled ? `“${target.label}” visible again` : `“${target.label}” hidden from the bar`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const current = readScopeList(scope);
          void saveScope(scope, current.map((a) => (a.id === id ? { ...a, enabled: !nowEnabled } : a)));
        },
      },
    });
  };

  const duplicate = (id: string) => {
    const index = list.findIndex((a) => a.id === id);
    const source = list[index];
    if (!source) return;
    const copy = JSON.parse(JSON.stringify(source)) as AnyAction;
    copy.id = newId();
    copy.label = `${source.label} (copy)`;
    const next = [...list];
    next.splice(index + 1, 0, copy);
    void save(next);
    addToast('success', `Duplicated “${source.label}”`);
  };

  const focusRow = (id: string) => {
    requestAnimationFrame(() => rowsRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus());
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (q) return; // reordering a filtered view would be ambiguous
      reorder(moveItem(list, id, e.key === 'ArrowUp' ? -1 : 1));
      focusRow(id);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const i = rows.findIndex((a) => a.id === id);
      const next = rows[i + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) focusRow(next.id);
      return;
    }
    if (e.key === 'Enter') openActionSettings(scope, id);
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      remove(id);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      duplicate(id);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      startNew('blank');
    }
  };

  const enabledActions = list.filter(isEnabled);

  return (
    <div className="flex flex-col gap-4" onKeyDown={onListKeyDown}>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-[var(--theme-text-primary)]">Actions</h1>
          <p className="mt-0.5 text-xs text-[var(--theme-text-muted)]">
            {scope === 'pinned'
              ? 'Buttons of the top bar. They can carry a status (a probe) and change what the click does depending on it.'
              : 'Buttons shown on every ticket and session. {{…}} variables resolve to the ticket workspace.'}
          </p>
        </div>
        {aiAvailable && (
          <button type="button" className={AI_BUTTON} onClick={() => setComposeOpen(true)}>
            <SparkIcon /> Describe an action <Kbd>⌘K</Kbd>
          </button>
        )}
        <Dropdown
          label="New action"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--theme-accent)] px-2.5 py-1 text-xs font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
          trigger={<>+ New <Kbd>N</Kbd></>}
        >
          {(close) => (
            <>
              {aiAvailable && (
                <MenuButton onClick={() => { close(); setComposeOpen(true); }} hint="⌘K">✨ Describe with AI</MenuButton>
              )}
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-text-faint)]">Templates</div>
              {TEMPLATES[scope].map((t) => (
                <MenuButton key={t.key} onClick={() => { close(); startNew(t.key); }}>{t.title}</MenuButton>
              ))}
            </>
          )}
        </Dropdown>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex gap-0.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-0.5" role="tablist" aria-label="Action scope">
          {([['pinned', 'Top bar', pinnedCount], ['ticket', 'Ticket', ticketCount]] as const).map(([key, label, count]) => (
            <button
              key={key}
              role="tab"
              aria-selected={scope === key}
              type="button"
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium',
                scope === key ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
              )}
              onClick={() => openActionSettings(key)}
            >
              {label}
              <span className="rounded bg-[var(--theme-bg-base)] px-1 text-[10.5px] text-[var(--theme-text-muted)]">{count}</span>
            </button>
          ))}
        </div>
        <input
          className={cn(TEXT_INPUT, 'h-7 w-56 text-xs')}
          placeholder="Filter…"
          aria-label="Filter actions"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {scope === 'pinned' && list.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            {(['ok', 'warn', 'ko'] as const).map((s) =>
              health[s] ? (
                <Chip key={s} className={statusTextClass(s)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} /> {health[s]} {STATUS_LABEL[s]}
                </Chip>
              ) : null,
            )}
            {health.none > 0 && <Chip>{health.none} without probe</Chip>}
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>⟳ Re-probe all</Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--theme-border-input)] px-4 py-2.5">
        <span className="text-[11px] text-[var(--theme-text-muted)]">Preview</span>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1.5">
          {enabledActions.length === 0 && <span className="px-1 text-[11px] text-[var(--theme-text-faint)]">empty</span>}
          {enabledActions.map((a) => (
            <PinnedActionButton key={a.id} action={a} kind={scope === 'pinned' ? 'pinned' : 'workspace'} onRun={() => runFromSettings(a)} />
          ))}
        </div>
        <span className="text-[11px] text-[var(--theme-text-faint)]">The real bar: hover for the tooltip, click to run.</span>
      </div>

      {rows.length > 0 ? (
        <div ref={rowsRef} className="flex flex-col gap-1.5" role="list" aria-label="Actions">
          {rows.map((a) => {
            const probed = scope === 'pinned' && !!(a as PinnedIcon).status;
            const snap = statuses[a.id];
            const status = probed ? snap?.status ?? 'unknown' : null;
            const rules = scope === 'pinned' ? (a as PinnedIcon).conditionalActions?.length ?? 0 : 0;
            const isRunning = !!running[a.id];
            const last = lastRuns[a.id]?.[0];
            const edge = dropIndicator(a.id);
            return (
              <div
                key={a.id}
                role="listitem"
                tabIndex={0}
                data-row={a.id}
                aria-label={a.label}
                {...rowProps(a.id)}
                onClick={() => openActionSettings(scope, a.id)}
                onKeyDown={(e) => onRowKeyDown(e, a.id)}
                className={cn(
                  'group relative grid cursor-pointer grid-cols-[16px_36px_minmax(0,1fr)_auto_150px_auto] items-center gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-2.5 pl-2 pr-3 transition-colors',
                  'hover:border-[var(--theme-border-input)] focus-visible:border-[var(--theme-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]',
                  !isEnabled(a) && 'opacity-50',
                  draggingId === a.id && 'opacity-30',
                )}
              >
                {edge === 'top' && <span className="absolute -top-1 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />}
                {edge === 'bottom' && <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />}
                <span className="cursor-grab text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" title="Drag to reorder (or ⌥↑/↓)">⋮⋮</span>
                <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]">
                  <span className="flex h-[18px] w-[18px] items-center justify-center">{a.icon ? renderIcon(a, 18) : a.label.charAt(0).toUpperCase()}</span>
                  {status && (
                    <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--theme-bg-surface)]', statusDotClass(status), (snap?.probing || isRunning) && 'animate-pulse')} />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--theme-text-primary)]">
                    <span className="truncate">{a.label || 'Untitled'}</span>
                    {!isEnabled(a) && <Chip>hidden</Chip>}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">
                    {a.actionType === 'url' ? '↗ ' : '$ '}
                    {highlightVars(a.actionValue)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Chip>{a.actionType === 'url' ? 'URL' : 'Shell'}</Chip>
                  {probed && <Chip>probe {intervalLabel((a as PinnedIcon).status!.intervalSec)}</Chip>}
                  {rules > 0 && <Chip>{rules} rule{rules > 1 ? 's' : ''}</Chip>}
                </div>
                <div className="flex min-w-0 flex-col text-[11px]">
                  {isRunning ? (
                    <span className="font-medium text-[var(--theme-accent)]">Running…</span>
                  ) : status ? (
                    <>
                      <span className={cn('flex items-center gap-1.5 font-medium', statusTextClass(status))}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(status))} />
                        {STATUS_LABEL[status]}
                        {snap?.badge && <Chip className="h-4">{snap.badge}</Chip>}
                      </span>
                      <span className="truncate text-[10.5px] text-[var(--theme-text-muted)]" title={snap?.tooltip}>{snap?.tooltip?.split('\n')[0]}</span>
                    </>
                  ) : (
                    <span className="text-[var(--theme-text-faint)]">
                      {last?.finishedAt ? `${last.exitCode === 0 ? '✓' : '✗'} last run ${new Date(last.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No probe'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-label={`Run ${a.label}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] opacity-0 hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)] group-hover:opacity-100 group-focus-visible:opacity-100"
                    onClick={(e) => { e.stopPropagation(); runFromSettings(a); }}
                  >
                    ▶
                  </button>
                  <Dropdown
                    label={`More actions for ${a.label}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] opacity-0 hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)] group-hover:opacity-100 group-focus-visible:opacity-100"
                    trigger="⋯"
                  >
                    {(close) => (
                      <>
                        <MenuButton onClick={() => { close(); runFromSettings(a); }}>Run now</MenuButton>
                        {probed && <MenuButton onClick={() => { close(); void refresh(a.id); }}>Refresh status</MenuButton>}
                        <MenuButton onClick={() => { close(); openLogs({ sourceId: a.id, label: a.label }); }}>View logs</MenuButton>
                        <div className="my-1 border-t border-[var(--theme-border)]" />
                        <MenuButton onClick={() => { close(); openActionSettings(scope, a.id); }} hint="↵">Edit</MenuButton>
                        <MenuButton onClick={() => { close(); duplicate(a.id); }} hint="⌘D">Duplicate</MenuButton>
                        {!q && <MenuButton onClick={() => { close(); reorder(moveItem(list, a.id, -1)); }} hint="⌥↑">Move up</MenuButton>}
                        {!q && <MenuButton onClick={() => { close(); reorder(moveItem(list, a.id, 1)); }} hint="⌥↓">Move down</MenuButton>}
                        <div className="my-1 border-t border-[var(--theme-border)]" />
                        <MenuButton danger onClick={() => { close(); remove(a.id); }} hint="⌫">Delete</MenuButton>
                      </>
                    )}
                  </Dropdown>
                  <Switch on={isEnabled(a)} onToggle={() => toggle(a.id)} label={`${a.label} visible`} />
                </div>
              </div>
            );
          })}
        </div>
      ) : list.length > 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--theme-border-input)] p-10 text-center text-sm text-[var(--theme-text-muted)]">
          No action matches “{filter}”.
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--theme-border-input)] p-10 text-center">
          <p className="text-sm text-[var(--theme-text-secondary)]">No {scope === 'pinned' ? 'top-bar' : 'ticket'} action yet.</p>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            {aiAvailable ? 'Describe what you want to the AI, or start from a template.' : 'Start from a template below.'}
          </p>
          {aiAvailable && (
            <button type="button" className={cn(AI_BUTTON, 'mt-3')} onClick={() => setComposeOpen(true)}>
              <SparkIcon /> Describe an action
            </button>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 text-[11.5px] font-medium text-[var(--theme-text-muted)]">Templates</div>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES[scope].map((t) => (
            <button
              key={t.key}
              type="button"
              className="flex items-center gap-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2.5 text-left hover:border-[var(--theme-border-input)]"
              onClick={() => startNew(t.key)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]">
                {renderIcon({ icon: t.icon, iconType: 'svg', label: t.title }, 16)}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[var(--theme-text-primary)]">{t.title}</span>
                <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Current list of a scope, read outside React (undo callbacks fire after re-renders). */
export function readScopeList(scope: ActionsScope): AnyAction[] {
  const s = useSettingsStore.getState().settings;
  return scope === 'pinned' ? s.pinnedIcons : s.workspaceActions ?? [];
}

export function saveScope(scope: ActionsScope, next: AnyAction[]): Promise<void> {
  const store = useSettingsStore.getState();
  return scope === 'pinned' ? store.savePinnedIcons(next as PinnedIcon[]) : store.saveWorkspaceActions(next);
}
