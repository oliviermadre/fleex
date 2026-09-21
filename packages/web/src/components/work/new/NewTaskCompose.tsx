import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTicketStore } from '../../../stores/ticketStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useWorkStore } from '../../../stores/workStore';
import { useToastStore } from '../../../stores/toastStore';
import { useTicketGroupStore } from '../../../stores/ticketGroupStore';
import { useBoardEpics } from '../../../hooks/useBoardEpics';
import { topReposForBoard } from '../../../lib/repoStatus';
import { syncGithubIssue } from '../../../services/api';
import { MultiSelect } from '../../ui/MultiSelect';
import { WorkBoardPicker } from '../panel/WorkBoardPicker';
import { DraftTypePicker } from './DraftTypePicker';
import { DraftPriorityPicker } from './DraftPriorityPicker';
import { RepoBaseBranchSelect, REPO_BUSY_LABEL, extractLinkError } from '../../tickets/RepoBaseBranchSelect';
import { BusyLine } from '../../ui/Spinner';
import { epicOptions, repoOptions } from './draftOptions';
import { SourceChip } from './SourceChip';

/**
 * The composer — the last screen of the new-task flow. It is the former NewTask
 * body plus an explicit title input, a source chip (when the draft was imported)
 * and, for an imported PR, the "work directly on the branch" control.
 *
 * `Start` is the single ticket-creation path: it creates the ticket (with the
 * source's links + tags), joins epics, attaches repos (with a base branch or a
 * direct checkout), and, for a GitHub issue, syncs its metadata after the fact.
 */
export function NewTaskCompose({ onStartOver }: { onStartOver: () => void }) {
  const boards = useTicketStore((s) => s.boards);
  const tickets = useTicketStore((s) => s.tickets);
  const createTicket = useTicketStore((s) => s.createTicket);
  const addLink = useTicketStore((s) => s.addLink);
  const addTicketToGroup = useTicketGroupStore((s) => s.addTicketToGroup);
  const repositories = useRepositoryStore((s) => s.repositories);
  const draft = useWorkStore((s) => s.draft);
  const updateDraft = useWorkStore((s) => s.updateDraft);
  const resetDraft = useWorkStore((s) => s.resetDraft);
  const setView = useWorkStore((s) => s.setView);
  const selectTicket = useWorkStore((s) => s.selectTicket);
  const addToast = useToastStore((s) => s.addToast);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Focus the description when the title is already filled (the common case after
  // an import or after naming the task on the entry screen), otherwise the title.
  useEffect(() => {
    if (draft.title.trim()) descRef.current?.focus();
    else titleRef.current?.focus();
    // Run once on mount — subsequent focus is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-grow the description to fit its content — including the value we never
  // typed: a mount with an imported PR or Slack synthesis (dozens of lines). The
  // CSS `max-h` caps it at a share of the viewport, past which the field scrolls
  // on its own so the pickers and Start button stay in view. `useLayoutEffect`
  // so it never flashes at the 4-row minimum before snapping to its real height.
  useLayoutEffect(() => {
    const ta = descRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [draft.text]);

  const effectiveBoardId = boards.some((b) => b.id === draft.boardId) ? draft.boardId : (boards[0]?.id ?? null);
  const canStart = draft.title.trim().length > 0 && !!effectiveBoardId && !creating;

  const boardEpics = useBoardEpics(effectiveBoardId);
  const epicChoices = useMemo(() => epicOptions(boardEpics), [boardEpics]);
  const selectedEpicIds = draft.epicIds.filter((id) => epicChoices.some((o) => o.value === id));

  const repoChoices = useMemo(() => {
    const rankedRefs = effectiveBoardId ? topReposForBoard(tickets, effectiveBoardId, { limit: Infinity }) : [];
    return repoOptions(repositories.map((r) => `${r.org}/${r.name}`), rankedRefs);
  }, [repositories, tickets, effectiveBoardId]);

  const pr = draft.source?.pr;

  async function start() {
    if (!canStart || !effectiveBoardId) return;
    setCreating(true);
    setProgress('Creating ticket…');
    try {
      const ticket = await createTicket({
        boardId: effectiveBoardId,
        title: draft.title.trim(),
        description: draft.text.trim(),
        type: draft.type,
        priority: draft.priority,
        status: 'doing',
        ...(draft.source?.tags?.length ? { tags: draft.source.tags } : {}),
        ...(draft.source?.links?.length ? { links: draft.source.links } : {}),
      });
      for (const epicId of selectedEpicIds) {
        const name = epicChoices.find((o) => o.value === epicId)?.label ?? epicId;
        setProgress(`Adding to ${name}…`);
        try {
          await addTicketToGroup(epicId, ticket.id);
        } catch (e) {
          addToast('error', `Couldn't add to ${name}: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
      // Attach each selected repo (keeps going on failure). A direct checkout wins
      // over a base branch — the two are mutually exclusive.
      for (const key of draft.repoKeys) {
        const checkoutRef = draft.repoCheckoutRefs[key];
        const baseBranch = draft.repoBaseBranches[key];
        setProgress(`${key} · ${REPO_BUSY_LABEL.attach(baseBranch || checkoutRef || undefined)}`);
        try {
          await addLink(ticket.id, {
            type: 'repository',
            ref: key,
            label: key,
            ...(checkoutRef ? { checkoutRef } : baseBranch ? { baseBranch } : {}),
          });
        } catch (e) {
          addToast('error', `Couldn't attach ${key}: ${extractLinkError(e)}`);
        }
      }
      // Issue metadata: recovered via the existing sync-github route after creation,
      // so the single creation path stays untouched. Best-effort.
      if (draft.source?.sourceId === 'github_issue') {
        try {
          await syncGithubIssue(ticket.id);
        } catch (e) {
          console.error('sync-github failed after import', e);
        }
      }
      resetDraft(effectiveBoardId);
      selectTicket(ticket.id);
      setView('task');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setCreating(false);
      setProgress(null);
    }
  }

  function onTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      descRef.current?.focus();
    } else if (e.key === 'Escape') {
      setView('task');
    }
  }

  function onDescKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void start();
    } else if (e.key === 'Escape') {
      setView('task');
    }
  }

  function detachSource() {
    // Keep title/description/repos; only drop the source and its checkout control.
    updateDraft({ source: null, repoCheckoutRefs: {} });
  }

  function setRepoKeys(repoKeys: string[]) {
    // Purge base branches AND checkout refs of any repo that was removed.
    updateDraft({
      repoKeys,
      repoBaseBranches: Object.fromEntries(
        Object.entries(draft.repoBaseBranches).filter(([key]) => repoKeys.includes(key)),
      ),
      repoCheckoutRefs: Object.fromEntries(
        Object.entries(draft.repoCheckoutRefs).filter(([key]) => repoKeys.includes(key)),
      ),
    });
  }

  function toggleCheckout(key: string, headRefName: string, checked: boolean) {
    if (checked) {
      updateDraft({
        repoCheckoutRefs: { ...draft.repoCheckoutRefs, [key]: headRefName },
        repoBaseBranches: Object.fromEntries(
          Object.entries(draft.repoBaseBranches).filter(([k]) => k !== key),
        ),
      });
    } else {
      const { [key]: _drop, ...rest } = draft.repoCheckoutRefs;
      updateDraft({
        repoCheckoutRefs: rest,
        repoBaseBranches: { ...draft.repoBaseBranches, [key]: headRefName },
      });
    }
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <input
            ref={titleRef}
            type="text"
            value={draft.title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            onKeyDown={onTitleKeyDown}
            placeholder="Task title"
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onStartOver}
            className="ml-3 shrink-0 rounded-md px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
          >
            ← Start over
          </button>
        </div>

        {draft.source && (
          <div className="mb-2 flex flex-col gap-1">
            <SourceChip source={draft.source} onDetach={detachSource} />
            {draft.source.repoWarning && (
              <span className="px-1 text-[11px] text-[var(--theme-text-faint)]">{draft.source.repoWarning}</span>
            )}
          </div>
        )}

        <textarea
          ref={descRef}
          value={draft.text}
          onChange={(e) => updateDraft({ text: e.target.value })}
          onKeyDown={onDescKeyDown}
          placeholder="Describe the task. Code or not, framed or not."
          className="min-h-[5.5rem] max-h-[50vh] w-full resize-none overflow-y-auto bg-transparent text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-[var(--theme-border-subtle)] pt-3">
          <div className="flex items-start gap-3">
            <Cell label="BOARD">
              <WorkBoardPicker value={effectiveBoardId} onChange={(boardId) => updateDraft({ boardId, epicIds: [] })} />
            </Cell>
            {epicChoices.length > 0 && (
              <Cell label="EPICS">
                <MultiSelect
                  label="Epics"
                  allLabel="No epic"
                  values={selectedEpicIds}
                  onChange={(epicIds) => updateDraft({ epicIds })}
                  options={epicChoices}
                  searchPlaceholder="Filter epics…"
                />
              </Cell>
            )}
            <Cell label="REPOS">
              <MultiSelect
                label="Repos"
                allLabel="No repo"
                values={draft.repoKeys}
                onChange={setRepoKeys}
                options={repoChoices}
                searchPlaceholder="Filter repos…"
              />
            </Cell>
          </div>
          <div className="flex items-start gap-3">
            <Cell label="TYPE">
              <DraftTypePicker value={draft.type} onChange={(type) => updateDraft({ type })} />
            </Cell>
            <Cell label="PRIORITY">
              <DraftPriorityPicker value={draft.priority} onChange={(priority) => updateDraft({ priority })} />
            </Cell>
          </div>
        </div>

        {/* Base branch per selected repo — empty means the repo's default branch */}
        {draft.repoKeys.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--theme-border-subtle)] pt-3">
            <span className="text-[9.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">BASE BRANCH</span>
            {draft.repoKeys.map((key) => {
              const isPrRepo = !!pr && pr.repoKey === key;
              const checkedOut = !!draft.repoCheckoutRefs[key];
              return (
                <div key={key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-56 max-w-full truncate font-mono text-[11px] text-[var(--theme-text-secondary)]" title={key}>
                      ⎇ {key}
                    </span>
                    <div className="min-w-[12rem] flex-1">
                      {isPrRepo && checkedOut ? (
                        <div className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 py-1 font-mono text-[11px] text-[var(--theme-text-muted)]">
                          {pr!.headRefName}
                        </div>
                      ) : (
                        <RepoBaseBranchSelect
                          repoKey={key}
                          value={draft.repoBaseBranches[key] ?? ''}
                          disabled={creating}
                          onChange={(v) => updateDraft({ repoBaseBranches: { ...draft.repoBaseBranches, [key]: v } })}
                          className="bg-[var(--theme-bg-base)] text-[11px]"
                        />
                      )}
                    </div>
                  </div>
                  {isPrRepo && pr && (
                    <label className="ml-2 flex items-start gap-2 text-[11px] text-[var(--theme-text-secondary)]">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checkedOut || pr.isCrossRepository}
                        disabled={creating || pr.isCrossRepository}
                        onChange={(e) => toggleCheckout(key, pr.headRefName, e.target.checked)}
                      />
                      <span>
                        Work directly on <span className="font-mono">{pr.headRefName}</span>
                        <span className="block text-[var(--theme-text-faint)]">
                          {pr.isCrossRepository
                            ? 'This PR comes from a fork — its branch can only be checked out directly.'
                            : "Commits land on the PR's branch instead of a new branch on top of it."}
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-[var(--theme-border-subtle)] pt-3">
          {progress ? (
            <BusyLine label={progress} />
          ) : (
            <span className="text-[11px] text-[var(--theme-text-faint)]">
              ⏎ starts{effectiveBoardId ? ` · on ${boards.find((b) => b.id === effectiveBoardId)?.name}` : ''}
            </span>
          )}
          <button
            type="button"
            onClick={() => setView('task')}
            className="ml-auto rounded-md px-3 py-1 text-[12px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canStart}
            className="rounded-md bg-[var(--theme-accent)] px-3 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
          >
            {creating ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">{label}</span>
      {children}
    </div>
  );
}
