/**
 * New task card (⌥N or + New Task). One card, no form: describe the task, pick a
 * board, a type, and optionally epics and repos, then Start. On start it
 * creates a real ticket (status Doing, title = first sentence ≤ 70 chars), adds
 * it to each selected epic, attaches a `repository` link per selected repo (with
 * its base branch when one was picked), and selects it. The board is kept for
 * the next task; the repo picker lists the board's most used repos first.
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTicketStore } from '../../../stores/ticketStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { useWorkStore } from '../../../stores/workStore';
import { useToastStore } from '../../../stores/toastStore';
import { useTicketGroupStore } from '../../../stores/ticketGroupStore';
import { useBoardEpics } from '../../../hooks/useBoardEpics';
import { topReposForBoard } from '../../../lib/repoStatus';
import { MultiSelect } from '../../ui/MultiSelect';
import { WorkBoardPicker } from '../panel/WorkBoardPicker';
import { DraftTypePicker } from './DraftTypePicker';
import { DraftPriorityPicker } from './DraftPriorityPicker';
import { RepoBaseBranchSelect, REPO_BUSY_LABEL, extractLinkError } from '../../tickets/RepoBaseBranchSelect';
import { BusyLine } from '../../ui/Spinner';
import { epicOptions, repoOptions } from './draftOptions';

/** Title = the first sentence, capped at 70 chars (SPEC §8). */
export function deriveTitle(text: string): string {
  const trimmed = text.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  const base = firstSentence.length <= 70 ? firstSentence : firstSentence.slice(0, 70).trimEnd();
  return base || 'Untitled task';
}

export function NewTask() {
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
  // The step in flight while starting — attaching a big repo's worktree takes a while.
  const [progress, setProgress] = useState<string | null>(null);

  // The last task's board, unless it has been deleted since.
  const effectiveBoardId = boards.some((b) => b.id === draft.boardId) ? draft.boardId : (boards[0]?.id ?? null);
  const canStart = draft.text.trim().length > 0 && !!effectiveBoardId && !creating;

  const boardEpics = useBoardEpics(effectiveBoardId);
  const epicChoices = useMemo(() => epicOptions(boardEpics), [boardEpics]);
  // A stale pick (epic closed meanwhile, or restored from another board) is dropped.
  const selectedEpicIds = draft.epicIds.filter((id) => epicChoices.some((o) => o.value === id));

  const repoChoices = useMemo(() => {
    const rankedRefs = effectiveBoardId ? topReposForBoard(tickets, effectiveBoardId, { limit: Infinity }) : [];
    return repoOptions(repositories.map((r) => `${r.org}/${r.name}`), rankedRefs);
  }, [repositories, tickets, effectiveBoardId]);

  async function start() {
    if (!canStart || !effectiveBoardId) return;
    setCreating(true);
    setProgress('Creating ticket…');
    try {
      const ticket = await createTicket({
        boardId: effectiveBoardId,
        title: deriveTitle(draft.text),
        description: draft.text.trim(),
        type: draft.type,
        priority: draft.priority,
        status: 'doing',
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
      // Attach each selected repo as a repository link (keeps going on failure).
      for (const key of draft.repoKeys) {
        const baseBranch = draft.repoBaseBranches[key];
        setProgress(`${key} · ${REPO_BUSY_LABEL.attach(baseBranch || undefined)}`);
        try {
          await addLink(ticket.id, { type: 'repository', ref: key, label: key, ...(baseBranch ? { baseBranch } : {}) });
        } catch (e) {
          addToast('error', `Couldn't attach ${key}: ${extractLinkError(e)}`);
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

  function cancel() {
    setView('task');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void start();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
        <textarea
          autoFocus
          value={draft.text}
          onChange={(e) => updateDraft({ text: e.target.value })}
          onKeyDown={onKeyDown}
          rows={4}
          placeholder="Describe the task. Code or not, framed or not."
          className="w-full resize-none bg-transparent text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none"
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
                onChange={(repoKeys) =>
                  updateDraft({
                    repoKeys,
                    repoBaseBranches: Object.fromEntries(
                      Object.entries(draft.repoBaseBranches).filter(([key]) => repoKeys.includes(key)),
                    ),
                  })
                }
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
            {draft.repoKeys.map((key) => (
              <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-56 max-w-full truncate font-mono text-[11px] text-[var(--theme-text-secondary)]" title={key}>
                  ⎇ {key}
                </span>
                <div className="min-w-[12rem] flex-1">
                  <RepoBaseBranchSelect
                    repoKey={key}
                    value={draft.repoBaseBranches[key] ?? ''}
                    disabled={creating}
                    onChange={(v) => updateDraft({ repoBaseBranches: { ...draft.repoBaseBranches, [key]: v } })}
                    className="bg-[var(--theme-bg-base)] text-[11px]"
                  />
                </div>
              </div>
            ))}
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
            onClick={cancel}
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
