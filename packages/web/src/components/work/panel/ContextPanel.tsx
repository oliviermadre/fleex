/**
 * Context panel — the ticket's meta, edited in place against the real ticket
 * mutation + link APIs. Board / Status / Type / Priority are four dropdowns;
 * favorite, blocked and due date are togglable; repos (repository links, each
 * with an editable base branch) and PRs (github_pr links) can be attached and
 * detached; deliverables open the existing
 * overlay. Reads the live Ticket from ticketStore so every edit round-trips.
 */
import { useEffect, useMemo, useState } from 'react';
import type { TicketLink } from '@fleex/shared';
import * as api from '../../../services/api';
import { useTicketStore } from '../../../stores/ticketStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import { PrBadge } from '../../ui/PrBadge';
import { RepoBaseBranchSelect, REPO_BUSY_LABEL, extractLinkError } from '../../tickets/RepoBaseBranchSelect';
import { Spinner, BusyLine } from '../../ui/Spinner';
import { DueDatePickerPopover } from '../../tickets/DueDatePickerPopover';
import { TypePickerPopover } from '../../tickets/TypePickerPopover';
import { PriorityPickerPopover } from '../../tickets/PriorityPickerPopover';
import { WorkBoardPicker } from './WorkBoardPicker';
import { WorkStatusPicker } from './WorkStatusPicker';
import type { WorkTask } from '../types';

/** Parse a github_pr link ref ("org/name#123") into its parts. */
function parsePrLink(link: TicketLink): { org: string; name: string; number: number } | null {
  const hash = link.ref.indexOf('#');
  if (hash < 0) return null;
  const repo = link.ref.slice(0, hash);
  const num = parseInt(link.ref.slice(hash + 1), 10);
  const slash = repo.indexOf('/');
  if (slash < 0 || Number.isNaN(num)) return null;
  return { org: repo.slice(0, slash), name: repo.slice(slash + 1), number: num };
}

/** Normalize GitHub's uppercase PR state ("OPEN"|"MERGED"|"CLOSED") to the PrBadge palette. */
function prState(raw: string | undefined): 'open' | 'merged' | 'closed' {
  if (raw === 'MERGED') return 'merged';
  if (raw === 'CLOSED') return 'closed';
  return 'open';
}

/** Parse a pasted GitHub PR URL into an addLink payload. */
function prUrlToLink(url: string): { type: string; ref: string; label: string; url: string } | null {
  const m = url.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  const [, org, name, num] = m;
  return {
    type: 'github_pr',
    ref: `${org!.toLowerCase()}/${name!.toLowerCase()}#${num}`,
    label: `#${num}`,
    url: url.trim(),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">{label}</span>
      {children}
    </div>
  );
}

function Section({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--theme-border-subtle)] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * One attached repo: `⎇ org/name`, its base branch when it isn't the default,
 * an inline base-branch editor (the server's refusal reason — a worktree it
 * can't safely re-derive, or a branch origin lacks — is shown inline) and detach.
 */
function RepoRow({ ticketId, link }: { ticketId: string; link: TicketLink }) {
  const removeLink = useTicketStore((s) => s.removeLink);
  const patchLinkBaseBranch = useTicketStore((s) => s.patchLinkBaseBranch);
  const [editing, setEditing] = useState(false);
  // The base being switched to while the server re-derives the worktree ('' = default).
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = savingTo !== null || removing;

  async function pick(value: string) {
    setError(null);
    setSavingTo(value);
    try {
      await patchLinkBaseBranch(ticketId, link.id, value || null);
      setEditing(false);
    } catch (e) {
      setError(extractLinkError(e));
    } finally {
      setSavingTo(null);
    }
  }

  async function remove() {
    setError(null);
    setRemoving(true);
    try {
      // Success unmounts the row; only a failure brings it back.
      await removeLink(ticketId, link.id);
    } catch (e) {
      setError(extractLinkError(e));
      setRemoving(false);
    }
  }

  return (
    <div className={cn('group', removing && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-[var(--theme-text-secondary)]" title={link.ref}>
            ⎇ {link.ref}
          </div>
          {link.baseBranch && (
            <div
              className="truncate pl-3 font-mono text-[10.5px] text-[var(--theme-accent)]"
              title={`Base branch: ${link.baseBranch}`}
            >
              ↳ {link.baseBranch}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setEditing((v) => !v);
          }}
          disabled={busy}
          className={cn(
            'shrink-0 text-[11px] text-[var(--theme-text-faint)] group-hover:opacity-100 hover:text-[var(--theme-accent)] disabled:pointer-events-none disabled:opacity-40',
            editing ? 'opacity-100' : 'opacity-0',
          )}
          title="Change base branch"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className={cn(
            'shrink-0 text-[var(--theme-text-faint)] group-hover:opacity-100 hover:text-[var(--theme-danger)] disabled:pointer-events-none',
            removing ? 'opacity-100' : 'opacity-0',
          )}
          title="Detach repo"
        >
          {removing ? <Spinner size={11} /> : '✕'}
        </button>
      </div>
      {editing && (
        <RepoBaseBranchSelect
          repoKey={link.ref}
          value={link.baseBranch ?? ''}
          disabled={busy}
          onChange={(v) => void pick(v)}
          className="mt-1 bg-[var(--theme-bg-surface)] text-[11px]"
        />
      )}
      {savingTo !== null && <BusyLine className="mt-1" label={REPO_BUSY_LABEL.switchBase(savingTo)} />}
      {removing && <BusyLine className="mt-1" label={REPO_BUSY_LABEL.remove} />}
      {error && <div className="mt-0.5 text-[10.5px] text-[var(--theme-danger)]">{error}</div>}
    </div>
  );
}

export function ContextPanel({ task }: { task: WorkTask }) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === task.id) ?? null);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const addLink = useTicketStore((s) => s.addLink);
  const removeLink = useTicketStore((s) => s.removeLink);
  const repositories = useRepositoryStore((s) => s.repositories);
  const [prUrl, setPrUrl] = useState('');
  const [addingPr, setAddingPr] = useState(false);
  const [prStates, setPrStates] = useState<Record<string, string>>({});
  // Staged repo for "+ attach repo…": chosen but not linked yet, so a base
  // branch can be picked first.
  const [pendingRepo, setPendingRepo] = useState<string | null>(null);
  const [pendingBaseBranch, setPendingBaseBranch] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Never carry a staged repo over to another task.
  useEffect(() => {
    setPendingRepo(null);
    setPendingBaseBranch('');
    setAttachError(null);
  }, [task.id]);

  const repoLinks = useMemo(() => (ticket?.links ?? []).filter((l) => l.type === 'repository'), [ticket]);
  const prLinks = useMemo(() => (ticket?.links ?? []).filter((l) => l.type === 'github_pr'), [ticket]);

  // Fetch live PR states from GitHub on mount / ticket change, so the badge
  // reflects merged/closed instead of always claiming "open".
  useEffect(() => {
    if (!ticket || prLinks.length === 0) return;
    api.fetchPRStates(ticket.id).then(setPrStates).catch(() => {});
  }, [ticket?.id, prLinks.length]);

  const attachableRepos = useMemo(() => {
    const attached = new Set(repoLinks.map((l) => l.ref));
    return repositories.map((r) => `${r.org}/${r.name}`).filter((key) => !attached.has(key));
  }, [repositories, repoLinks]);

  if (!ticket) {
    return <div className="p-3 text-[12px] text-[var(--theme-text-faint)]">Ticket not loaded.</div>;
  }

  async function attachPending() {
    if (!ticket || !pendingRepo) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await addLink(ticket.id, {
        type: 'repository',
        ref: pendingRepo,
        label: pendingRepo,
        ...(pendingBaseBranch ? { baseBranch: pendingBaseBranch } : {}),
      });
      setPendingRepo(null);
      setPendingBaseBranch('');
    } catch (e) {
      setAttachError(extractLinkError(e));
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Board / Status / Type / Priority — four Kanban-style pickers, 2×2 */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-[var(--theme-border-subtle)] px-3 py-3">
        <Field label="Board">
          <WorkBoardPicker value={ticket.boardId} onChange={(boardId) => void updateTicket(ticket.id, { boardId })} />
        </Field>
        <Field label="Status">
          <WorkStatusPicker ticket={ticket} />
        </Field>
        <Field label="Type">
          <div className="flex min-h-[28px] items-center px-1 py-1">
            <TypePickerPopover ticket={ticket} display="icon-label" />
          </div>
        </Field>
        <Field label="Priority">
          <div className="flex min-h-[28px] items-center gap-1.5 px-1 py-1">
            <PriorityPickerPopover ticket={ticket} />
          </div>
        </Field>
      </div>

      {/* Flags + due date */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--theme-border-subtle)] px-3 py-2">
        <button
          type="button"
          onClick={() => void updateTicket(ticket.id, { favorite: !ticket.favorite })}
          className={cn(
            'rounded-md px-2 py-1 text-[11px] transition-colors',
            ticket.favorite
              ? cn('bg-[var(--tint-yellow-bg)]', tintText('yellow'))
              : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          {ticket.favorite ? '★' : '☆'} Favorite
        </button>
        <button
          type="button"
          onClick={() => void updateTicket(ticket.id, { blocked: !ticket.blocked })}
          className={cn(
            'rounded-md px-2 py-1 text-[11px] transition-colors',
            ticket.blocked
              ? cn('bg-[var(--tint-red-bg)]', tintText('red'))
              : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          ⛌ Blocked
        </button>
        <DueDatePickerPopover ticket={ticket} />
      </div>

      {/* Repos (repository links) */}
      <Section label="REPOS">
        {repoLinks.length === 0 && (
          <div className="mb-1 text-[11px] text-[var(--theme-text-faint)]">No repo attached — that's fine.</div>
        )}
        <div className="flex flex-col gap-1">
          {repoLinks.map((l) => (
            <RepoRow key={l.id} ticketId={ticket.id} link={l} />
          ))}
          {/* The repo being attached, until the server has created its worktree */}
          {attaching && pendingRepo && !repoLinks.some((l) => l.ref === pendingRepo) && (
            <div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--theme-text-secondary)]">
                <Spinner size={11} className="text-[var(--theme-accent)]" />
                <span className="truncate" title={pendingRepo}>{pendingRepo}</span>
              </div>
              <BusyLine className="mt-0.5 pl-[17px]" label={REPO_BUSY_LABEL.attach(pendingBaseBranch || undefined)} />
            </div>
          )}
        </div>
        {pendingRepo && !attaching ? (
          <div className="mt-1.5 flex flex-col gap-1 rounded-md border border-[var(--theme-border-input)] p-1.5">
            <span className="truncate font-mono text-[11px] text-[var(--theme-text-secondary)]" title={pendingRepo}>
              ⎇ {pendingRepo}
            </span>
            <RepoBaseBranchSelect
              repoKey={pendingRepo}
              value={pendingBaseBranch}
              disabled={attaching}
              onChange={setPendingBaseBranch}
              className="bg-[var(--theme-bg-surface)] text-[11px]"
            />
            {attachError && <div className="text-[10.5px] text-[var(--theme-danger)]">{attachError}</div>}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void attachPending()}
                disabled={attaching}
                className="flex-1 rounded-md bg-[var(--theme-accent)] px-2 py-1 text-[11px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
              >
                Attach
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingRepo(null);
                  setPendingBaseBranch('');
                  setAttachError(null);
                }}
                disabled={attaching}
                className="rounded-md px-2 py-1 text-[11px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : attachableRepos.length > 0 && (
          <select
            value=""
            disabled={attaching}
            onChange={(e) => {
              const key = e.target.value;
              if (key) {
                setPendingBaseBranch('');
                setAttachError(null);
                setPendingRepo(key);
              }
            }}
            className="mt-1.5 w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[11px] text-[var(--theme-text-secondary)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-50"
          >
            <option value="">+ attach repo…</option>
            {attachableRepos.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        )}
      </Section>

      {/* Pull requests (github_pr links) */}
      <Section label="PULL REQUESTS">
        <div className="flex flex-col gap-1.5">
          {prLinks.map((l) => {
            const parsed = parsePrLink(l);
            const stats = task.pr && task.pr.additions != null ? task.pr : null;
            return (
              <div key={l.id} className="group flex items-center gap-2">
                {parsed ? (
                  <PrBadge
                    org={parsed.org}
                    name={parsed.name}
                    pr={{ number: parsed.number, state: prState(prStates[l.ref]), title: l.label }}
                    href={l.url ?? undefined}
                  />
                ) : (
                  <span className="font-mono text-[11px]">{l.ref}</span>
                )}
                {stats && (stats.additions! > 0 || (stats.deletions ?? 0) > 0) && (
                  <span className="inline-flex gap-1 font-mono text-[10.5px]">
                    {stats.additions! > 0 && <span className={tintText('green')}>+{stats.additions}</span>}
                    {(stats.deletions ?? 0) > 0 && <span className={tintText('red')}>-{stats.deletions}</span>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void removeLink(ticket.id, l.id)}
                  className="ml-auto shrink-0 text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--theme-danger)]"
                  title="Remove PR"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <form
          className="mt-1.5 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const payload = prUrlToLink(prUrl);
            if (!payload) return;
            setAddingPr(true);
            void addLink(ticket.id, payload).finally(() => {
              setAddingPr(false);
              setPrUrl('');
            });
          }}
        >
          <input
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="Paste a GitHub PR URL…"
            className="min-w-0 flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[11px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={addingPr || !prUrlToLink(prUrl)}
            className="rounded-md bg-[var(--theme-accent)] px-2 py-1 text-[11px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </Section>
    </div>
  );
}
