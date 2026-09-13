/**
 * Context panel — the ticket's meta, edited in place against the real ticket
 * mutation + link APIs. Board / Status / Type / Priority are four dropdowns;
 * favorite, blocked and due date are togglable; repos (repository links) and PRs
 * (github_pr links) can be attached and detached; deliverables open the existing
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

export function ContextPanel({ task }: { task: WorkTask }) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === task.id) ?? null);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const addLink = useTicketStore((s) => s.addLink);
  const removeLink = useTicketStore((s) => s.removeLink);
  const repositories = useRepositoryStore((s) => s.repositories);
  const [prUrl, setPrUrl] = useState('');
  const [addingPr, setAddingPr] = useState(false);
  const [prStates, setPrStates] = useState<Record<string, string>>({});

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
            <TypePickerPopover ticket={ticket} />
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
            <div key={l.id} className="group flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-[var(--theme-text-secondary)]">⎇ {l.ref}</span>
              <button
                type="button"
                onClick={() => void removeLink(ticket.id, l.id)}
                className="shrink-0 text-[var(--theme-text-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--theme-danger)]"
                title="Detach repo"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {attachableRepos.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const key = e.target.value;
              if (key) void addLink(ticket.id, { type: 'repository', ref: key, label: key });
            }}
            className="mt-1.5 w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[11px] text-[var(--theme-text-secondary)] focus:border-[var(--theme-accent)] focus:outline-none"
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
