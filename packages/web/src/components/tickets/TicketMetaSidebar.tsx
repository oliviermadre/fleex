import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket, TicketStatus, TicketPriority, Worktree, GitHubIssueMetadata } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_PRIORITIES } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import * as api from '../../services/api';
import { PriorityIndicator } from './PriorityIndicator';
import { DueDateBadge } from './DueDateBadge';
import { DueDatePickerPopover } from './DueDatePickerPopover';
import { cn } from '../../lib/cn';

// ── Collapsed sidebar tooltip (portal-based, appears to the LEFT) ──

interface TooltipData {
  label: string;
  value: string;
  top: number;
  left: number;
}

function CollapsedMetaTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[100]"
      style={{ top: data.top, right: `calc(100vw - ${data.left}px + 10px)`, transform: 'translateY(-50%)' }}
    >
      <div className="whitespace-nowrap rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-3 py-2 shadow-xl">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">{data.label}</div>
        <div className="text-xs text-[var(--theme-text-primary)]">{data.value}</div>
      </div>
    </div>,
    document.body,
  );
}

function useCollapsedMetaTooltip() {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((e: React.MouseEvent, label: string, value: string) => {
    clearTimeout(hideTimeout.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ label, value, top: rect.top + rect.height / 2, left: rect.left });
  }, []);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setTooltip(null), 80);
  }, []);

  return { tooltip, show, hide } as const;
}

// ── Status color mapping ──

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-[var(--theme-text-faint)]',
  todo: 'bg-blue-400',
  doing: 'bg-amber-400',
  reviewing: 'bg-purple-400',
  done: 'bg-green-400',
};

const NANO_KANBAN_COLORS: Record<string, { text: string; bg: string; bar: string; hoverBg: string; hoverText: string }> = {
  backlog:   { text: 'text-[var(--theme-text-muted)]', bg: 'bg-[var(--theme-bg-overlay)]',  bar: 'bg-[var(--theme-text-muted)]', hoverBg: 'hover:bg-[var(--theme-bg-hover)]',   hoverText: 'group-hover:text-gray-300' },
  todo:      { text: 'text-orange-400',                bg: 'bg-orange-400/15',               bar: 'bg-orange-400',                hoverBg: 'hover:bg-orange-400/15',              hoverText: 'group-hover:text-orange-400' },
  doing:     { text: 'text-blue-400',                  bg: 'bg-blue-400/15',                 bar: 'bg-blue-400',                  hoverBg: 'hover:bg-blue-400/15',                hoverText: 'group-hover:text-blue-400' },
  reviewing: { text: 'text-purple-400',                bg: 'bg-purple-400/15',               bar: 'bg-purple-400',                hoverBg: 'hover:bg-purple-400/15',              hoverText: 'group-hover:text-purple-400' },
  done:      { text: 'text-green-400',                 bg: 'bg-green-400/15',                bar: 'bg-green-400',                 hoverBg: 'hover:bg-green-400/15',               hoverText: 'group-hover:text-green-400' },
  cancelled: { text: 'text-red-400/70',                bg: 'bg-red-400/10',                  bar: 'bg-red-400/70',                hoverBg: 'hover:bg-red-400/10',                 hoverText: 'group-hover:text-red-400/70' },
};

const NANO_KANBAN_ABBREVS: Record<string, string> = {
  backlog: 'BKLG',
  todo: 'TODO',
  doing: 'DOIN',
  reviewing: 'REVW',
  done: 'DONE',
  cancelled: 'CNCL',
};

// ── Collapsed indicator item ──

function CollapsedIndicator({
  icon,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  icon: React.ReactNode;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={cn(
        'flex w-full items-center justify-center py-2.5 transition-colors',
        onClick && 'hover:bg-[var(--theme-bg-hover)]',
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {icon}
    </Tag>
  );
}

// ── Collapsed ticket meta sidebar ──

function CollapsedTicketMetaSidebar({
  ticket,
}: {
  ticket: Ticket;
}) {
  const toggleTicketMetaSidebar = useUIStore((s) => s.toggleTicketMetaSidebar);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useCollapsedMetaTooltip();

  const worktreeLinks = useMemo(() => ticket.links.filter((l) => l.type === 'worktree'), [ticket.links]);
  const repoLinks = useMemo(() => ticket.links.filter((l) => l.type === 'repository'), [ticket.links]);
  const issueLink = ticket.links.find((l) => l.type === 'github_issue');
  const prLinks = useMemo(() => ticket.links.filter((l) => l.type === 'github_pr'), [ticket.links]);

  const linkedRepoLabels = useMemo(() => {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const rl of repoLinks) {
      if (!seen.has(rl.ref)) { seen.add(rl.ref); labels.push(rl.ref); }
    }
    for (const wl of worktreeLinks) {
      const colonIdx = wl.ref.indexOf(':');
      if (colonIdx > 0) {
        const key = wl.ref.substring(0, colonIdx);
        if (!seen.has(key)) { seen.add(key); labels.push(key); }
      }
    }
    return labels;
  }, [repoLinks, worktreeLinks]);

  return (
    <div className="flex w-10 flex-shrink-0 flex-col items-center border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {/* Expand button */}
      <button
        onClick={toggleTicketMetaSidebar}
        className="flex w-full shrink-0 items-center justify-center border-b border-[var(--theme-border)] py-3 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        title="Expand panel"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <line x1="10" y1="1.5" x2="10" y2="14.5" />
        </svg>
      </button>

      {/* Scrollable indicators */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto w-full">
        {/* Status */}
        <CollapsedIndicator
          icon={
            <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_COLORS[ticket.status] ?? 'bg-[var(--theme-text-faint)]')} />
          }
          onMouseEnter={(e) => showTooltip(e, 'Status', TICKET_STATUS_LABELS[ticket.status] ?? ticket.status)}
          onMouseLeave={hideTooltip}
        />

        {/* Priority */}
        <CollapsedIndicator
          icon={<PriorityIndicator priority={ticket.priority} size="md" />}
          onMouseEnter={(e) => showTooltip(e, 'Priority', ticket.priority === 'none' ? 'None' : ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1))}
          onMouseLeave={hideTooltip}
        />

        {/* Due date */}
        {ticket.dueDate && (
          <CollapsedIndicator
            icon={<DueDateBadge dueDate={ticket.dueDate} status={ticket.status} size="sm" />}
            onMouseEnter={(e) => {
              const d = new Date(ticket.dueDate!);
              const formatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
              showTooltip(e, 'Due date', formatted);
            }}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Assignee */}
        <CollapsedIndicator
          icon={
            ticket.assignee ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--theme-accent-muted)] text-[9px] font-bold text-[var(--theme-accent)]">
                {ticket.assignee.charAt(0).toUpperCase()}
              </span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-faint)]">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
              </svg>
            )
          }
          onMouseEnter={(e) => showTooltip(e, 'Assignee', ticket.assignee ?? 'Unassigned')}
          onMouseLeave={hideTooltip}
        />

        {/* Separator */}
        <div className="mx-2 my-1 h-px w-4 bg-[var(--theme-border)]" />

        {/* GitHub Issue */}
        {issueLink && (
          <CollapsedIndicator
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-secondary)]">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            }
            onMouseEnter={(e) => showTooltip(e, 'GitHub Issue', issueLink.ref)}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Pull Requests */}
        {prLinks.length > 0 && (
          <CollapsedIndicator
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-green-400">
                <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
              </svg>
            }
            onMouseEnter={(e) => showTooltip(e, 'Pull Request', prLinks.map((p) => p.label).join(', '))}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Repository */}
        {linkedRepoLabels.length > 0 && (
          <CollapsedIndicator
            icon={
              <div className="relative">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--theme-text-faint)]">
                  <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9z" />
                </svg>
                {linkedRepoLabels.length > 1 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--theme-accent)] text-[7px] font-bold text-white">
                    {linkedRepoLabels.length}
                  </span>
                )}
              </div>
            }
            onMouseEnter={(e) => showTooltip(e, 'Repository', linkedRepoLabels.join(', '))}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Worktree */}
        {worktreeLinks.length > 0 && (
          <CollapsedIndicator
            icon={
              <div className="relative">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
                  <circle cx="5" cy="3.5" r="1.5" />
                  <circle cx="8" cy="12.5" r="1.5" />
                  <line x1="5" y1="5" x2="8" y2="11" />
                </svg>
                {worktreeLinks.length > 1 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--theme-accent)] text-[7px] font-bold text-white">
                    {worktreeLinks.length}
                  </span>
                )}
              </div>
            }
            onMouseEnter={(e) => showTooltip(e, 'Worktrees', worktreeLinks.map((wl) => wl.label).join(', '))}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Tags */}
        {ticket.tags.length > 0 && (
          <CollapsedIndicator
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
                <path d="M1 8.5V3a1.5 1.5 0 0 1 1.5-1.5H8l6.5 6.5-5 5L1 8.5z" />
                <circle cx="5" cy="5" r="1" fill="currentColor" />
              </svg>
            }
            onMouseEnter={(e) => showTooltip(e, 'Tags', ticket.tags.join(', '))}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Separator before toggles */}
        {(ticket.blocked || ticket.favorite) && (
          <div className="mx-2 my-1 h-px w-4 bg-[var(--theme-border)]" />
        )}

        {/* Blocked */}
        {ticket.blocked && (
          <CollapsedIndicator
            icon={<span className="h-2.5 w-2.5 rounded-full bg-red-500" />}
            onMouseEnter={(e) => showTooltip(e, 'Blocked', 'Yes')}
            onMouseLeave={hideTooltip}
          />
        )}

        {/* Favorite */}
        {ticket.favorite && (
          <CollapsedIndicator
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-yellow-400">
                <path d="M8 1.3l2.1 4.2 4.7.7-3.4 3.3.8 4.7L8 11.8l-4.2 2.4.8-4.7L1.2 6.2l4.7-.7L8 1.3z" />
              </svg>
            }
            onMouseEnter={(e) => showTooltip(e, 'Favorite', 'Yes')}
            onMouseLeave={hideTooltip}
          />
        )}
      </div>


      <CollapsedMetaTooltip data={tooltip} />
    </div>
  );
}

// ── Main exported component ──

export function TicketMetaSidebar({
  ticket,
}: {
  ticket: Ticket;
}) {
  const ticketMetaSidebarCollapsed = useUIStore((s) => s.ticketMetaSidebarCollapsed);

  if (ticketMetaSidebarCollapsed) {
    return <CollapsedTicketMetaSidebar ticket={ticket} />;
  }

  return <ExpandedTicketMetaSidebar ticket={ticket} />;
}

// ── Expanded ticket meta sidebar ──

function ExpandedTicketMetaSidebar({
  ticket,
}: {
  ticket: Ticket;
}) {
  const toggleTicketMetaSidebar = useUIStore((s) => s.toggleTicketMetaSidebar);
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const deleteTicket = useTicketStore((s) => s.deleteTicket);
  const addLink = useTicketStore((s) => s.addLink);
  const removeLink = useTicketStore((s) => s.removeLink);
  const syncGithubIssue = useTicketStore((s) => s.syncGithubIssue);
  const boards = useTicketStore((s) => s.boards);

  // Fetch live PR states from GitHub on mount / ticket change
  const [prStates, setPrStates] = useState<Record<string, string>>({});
  useEffect(() => {
    const prLinks = ticket.links.filter((l) => l.type === 'github_pr');
    if (prLinks.length === 0) return;
    api.fetchPRStates(ticket.id).then(setPrStates).catch(() => {});
  }, [ticket.id]);

  const handleStatusChange = (status: TicketStatus) => {
    updateTicket(ticket.id, { status });
  };

  const handlePriorityChange = (priority: TicketPriority) => {
    updateTicket(ticket.id, { priority });
  };

  const handleDelete = () => {
    if (confirm('Delete this ticket?')) {
      deleteTicket(ticket.id);
    }
  };

  // Derive current repos from repository links and worktree links
  // Memoize the filtered arrays to prevent re-render loops in children
  const worktreeLinks = useMemo(() => ticket.links.filter((l) => l.type === 'worktree'), [ticket.links]);
  const repoLinks = useMemo(() => ticket.links.filter((l) => l.type === 'repository'), [ticket.links]);
  const linkedRepos = useMemo(() => {
    const repos: Array<{ org: string; name: string; linkId?: string }> = [];
    const seen = new Set<string>();
    for (const rl of repoLinks) {
      const slashIdx = rl.ref.indexOf('/');
      if (slashIdx > 0 && !seen.has(rl.ref)) {
        seen.add(rl.ref);
        repos.push({ org: rl.ref.substring(0, slashIdx), name: rl.ref.substring(slashIdx + 1), linkId: rl.id });
      }
    }
    for (const wl of worktreeLinks) {
      const colonIdx = wl.ref.indexOf(':');
      if (colonIdx > 0) {
        const key = wl.ref.substring(0, colonIdx);
        if (!seen.has(key)) {
          seen.add(key);
          const si = key.indexOf('/');
          if (si > 0) repos.push({ org: key.substring(0, si), name: key.substring(si + 1) });
        }
      }
    }
    return repos;
  }, [repoLinks, worktreeLinks]);

  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col border-l border-[var(--theme-border)] overflow-y-auto">
      {/* Collapse button */}
      <button
        onClick={toggleTicketMetaSidebar}
        className="flex w-full shrink-0 items-center justify-center border-b border-[var(--theme-border)] py-2 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        title="Collapse panel"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <line x1="10" y1="1.5" x2="10" y2="14.5" />
        </svg>
      </button>

      <div className="flex flex-1 flex-col gap-5 p-4 overflow-y-auto">
      {/* Status — Nano Kanban */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Status
        </label>
        <div className="flex overflow-hidden rounded-md border border-[var(--theme-border)]">
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => {
            const active = ticket.status === s;
            const colors = NANO_KANBAN_COLORS[s] ?? NANO_KANBAN_COLORS.backlog!;
            return (
              <button
                key={s}
                title={TICKET_STATUS_LABELS[s]}
                className={cn(
                  'group relative flex flex-1 flex-col items-center gap-1 pb-1.5 pt-0 transition-colors',
                  active ? colors.bg : colors.hoverBg,
                )}
                onClick={() => handleStatusChange(s)}
              >
                {/* Top bar */}
                <div
                  className={cn(
                    'w-full transition-all',
                    active ? cn('h-[3px]', colors.bar) : cn('h-[2px] opacity-60', colors.bar),
                  )}
                />
                {/* Vertical abbreviated label */}
                <div className="flex flex-col items-center gap-px">
                  {(NANO_KANBAN_ABBREVS[s] ?? s.slice(0, 4).toUpperCase()).split('').map((ch, i) => (
                    <span
                      key={i}
                      className={cn(
                        'text-[8px] font-bold leading-none transition-colors',
                        active ? colors.text : cn('text-gray-400', colors.hoverText),
                      )}
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Board */}
      {boards.length > 1 && (
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Board
          </label>
          <select
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={ticket.boardId}
            onChange={(e) => updateTicket(ticket.id, { boardId: e.target.value })}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.emoji} {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Priority */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Priority
        </label>
        <div className="flex gap-1">
          {(TICKET_PRIORITIES as readonly TicketPriority[]).map((p) => (
            <button
              key={p}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                ticket.priority === p
                  ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)] ring-1 ring-[var(--theme-accent)]'
                  : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => handlePriorityChange(p)}
            >
              <PriorityIndicator priority={p} />
              {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Due date */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Due date
        </label>
        <DueDatePickerPopover ticket={ticket} />
      </div>

      {/* Assignee */}
      <AssigneeField
        assignee={ticket.assignee}
        onChange={(assignee) => updateTicket(ticket.id, { assignee })}
      />

      {/* GitHub Issue */}
      <GitHubIssuePicker
        ticket={ticket}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
        onSync={() => syncGithubIssue(ticket.id)}
      />

      {/* GitHub Metadata */}
      {ticket.githubMetadata && (
        <GitHubMetadataSection metadata={ticket.githubMetadata} />
      )}

      {/* Repository & Worktree */}
      <MultiRepoWorktreePicker
        linkedRepos={linkedRepos}
        worktreeLinks={worktreeLinks}
        repoLinks={repoLinks}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
      />

      {/* Pull Requests */}
      <PRLinkPicker
        ticket={ticket}
        prStates={prStates}
        onAddLink={(link) => addLink(ticket.id, link)}
        onRemoveLink={(linkId) => removeLink(ticket.id, linkId)}
      />

      {/* Tags */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Tags
        </label>
        <div className="flex flex-wrap gap-1">
          {ticket.tags.map((tag: string) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-secondary)]"
            >
              {tag}
              <button
                className="text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={() => {
                  updateTicket(ticket.id, { tags: ticket.tags.filter((t: string) => t !== tag) });
                }}
              >
                ×
              </button>
            </span>
          ))}
          <TagInput
            onAdd={(tag) => {
              if (!ticket.tags.includes(tag)) {
                updateTicket(ticket.id, { tags: [...ticket.tags, tag] });
              }
            }}
          />
        </div>
      </div>

      {/* Blocked */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Blocked
        </label>
        <button
          className={cn(
            'h-4 w-7 rounded-full transition-colors',
            ticket.blocked ? 'bg-red-500' : 'bg-[var(--theme-bg-overlay)]',
          )}
          onClick={() => updateTicket(ticket.id, { blocked: !ticket.blocked })}
        >
          <span
            className={cn(
              'block h-3 w-3 rounded-full bg-white transition-transform',
              ticket.blocked ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>


      {/* Favorite */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Favorite
        </label>
        <button
          className={cn(
            'h-4 w-7 rounded-full transition-colors',
            ticket.favorite ? 'bg-yellow-400' : 'bg-[var(--theme-bg-overlay)]',
          )}
          onClick={() => updateTicket(ticket.id, { favorite: !ticket.favorite })}
        >
          <span
            className={cn(
              'block h-3 w-3 rounded-full bg-white transition-transform',
              ticket.favorite ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Other Links (non-worktree, non-repository, non-PR) */}
      {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository' && l.type !== 'github_pr').length > 0 && (

        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Links
          </label>
          <div className="flex flex-col gap-1">
            {ticket.links.filter((l) => l.type !== 'worktree' && l.type !== 'repository' && l.type !== 'github_pr').map((link) => (
              <div key={link.id} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[9px] font-medium text-[var(--theme-text-muted)]">
                  {link.type.replace('_', ' ')}
                </span>
                {link.url ? (
                  <a
                    href={link.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-[var(--theme-accent)] hover:underline"
                  >
                    {link.label}
                  </a>
                ) : (
                  <span className="flex-1 truncate text-[var(--theme-text-secondary)]">{link.label}</span>
                )}
                <button
                  className="text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                  onClick={() => removeLink(ticket.id, link.id)}
                  title="Remove link"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-[var(--theme-border)]">
        <button
          className="w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-danger)] transition-colors hover:bg-red-500/10"
          onClick={handleDelete}
        >
          Delete Ticket
        </button>
      </div>
      </div>
    </div>
  );
}

// ── Multi-Repository & Worktree Picker ──
// Supports N repositories linked to a single ticket.

interface WorktreeOption {
  org: string;
  name: string;
  branch: string;
  path: string;
  isMain: boolean;
}

type TicketLink = Ticket['links'][number];

function MultiRepoWorktreePicker({
  linkedRepos,
  worktreeLinks,
  repoLinks,
  onAddLink,
  onRemoveLink,
}: {
  linkedRepos: Array<{ org: string; name: string; linkId?: string }>;
  worktreeLinks: TicketLink[];
  repoLinks: TicketLink[];
  onAddLink: (link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
}) {
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const [worktrees, setWorktrees] = useState<WorktreeOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Parse resolved repositories into { org, name, key } objects
  const repos = useMemo(() => {
    return resolvedRepositories
      .map((r) => {
        const slashIdx = r.indexOf('/');
        if (slashIdx <= 0) return null;
        const org = r.substring(0, slashIdx);
        const name = r.substring(slashIdx + 1);
        return { org, name, key: r };
      })
      .filter((r): r is { org: string; name: string; key: string } => r !== null)
      .sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
  }, [resolvedRepositories]);

  // Stable string key for linked repos (avoids array identity issues)
  const linkedKeysStr = useMemo(() => linkedRepos.map((r) => `${r.org}/${r.name}`).sort().join(','), [linkedRepos]);
  const linkedKeys = useMemo(() => new Set(linkedKeysStr.split(',').filter(Boolean)), [linkedKeysStr]);
  const availableRepos = useMemo(() => repos.filter((r) => !linkedKeys.has(r.key)), [repos, linkedKeys]);

  // Track last-fetched key to avoid redundant fetches
  const lastFetchKeyRef = useRef('');
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;

  // Fetch worktrees from filesystem — only when the set of repos actually changes
  useEffect(() => {
    if (repos.length === 0) {
      setWorktrees([]);
      return;
    }

    const repoList = linkedKeys.size > 0
      ? repos.filter((r) => linkedKeys.has(r.key))
      : repos;
    const targetRepos = repoList.length > 0 ? repoList : repos;

    // Build a stable key for the fetch
    const fetchKey = targetRepos.map((r) => r.key).sort().join(',');
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    const clonedRepos = targetRepos.filter((r) => summariesRef.current[r.key]?.isClonedLocally !== false);
    if (clonedRepos.length === 0) {
      setWorktrees([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const results: WorktreeOption[] = [];
        await Promise.all(
          clonedRepos.map(async (repo) => {
            try {
              const wts: import('@fleex/shared').Worktree[] = await api.fetchWorktrees(repo.org, repo.name);
              for (const wt of wts) {
                if (!wt.isBare) {
                  results.push({ org: repo.org, name: repo.name, branch: wt.branch, path: wt.path, isMain: wt.isMain });
                }
              }
            } catch { /* skip */ }
          }),
        );
        if (!cancelled) setWorktrees(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repos, linkedKeysStr, linkedKeys]);

  // Get worktree branch for a linked repo from worktree links
  const getBranchForRepo = useCallback((org: string, name: string): string | null => {
    const prefix = `${org}/${name}:`;
    for (const wl of worktreeLinks) {
      if (wl.ref.startsWith(prefix)) {
        return wl.ref.substring(prefix.length);
      }
    }
    return null;
  }, [worktreeLinks]);

  // Get worktree link IDs for a specific repo
  const getWorktreeLinkIdsForRepo = useCallback((org: string, name: string): string[] => {
    const prefix = `${org}/${name}:`;
    return worktreeLinks.filter((wl) => wl.ref.startsWith(prefix)).map((wl) => wl.id);
  }, [worktreeLinks]);

  const handleAddRepo = async (value: string) => {
    if (!value) return;
    await onAddLink({ type: 'repository', ref: value, label: value });
  };

  const handleRemoveRepo = async (org: string, name: string, linkId?: string) => {
    // Remove repo link
    if (linkId) {
      await onRemoveLink(linkId);
    } else {
      const rl = repoLinks.find((l) => l.ref === `${org}/${name}`);
      if (rl) await onRemoveLink(rl.id);
    }
    // Remove matching worktree links
    const wtLinkIds = getWorktreeLinkIdsForRepo(org, name);
    for (const id of wtLinkIds) {
      await onRemoveLink(id);
    }
  };

  const handleWorktreeSelect = async (wt: WorktreeOption) => {
    const repoKey = `${wt.org}/${wt.name}`;
    // Remove existing worktree links for this repo
    const existingWtIds = getWorktreeLinkIdsForRepo(wt.org, wt.name);
    for (const id of existingWtIds) {
      await onRemoveLink(id);
    }
    // Remove repository link for this repo (worktree implies repo)
    const rl = repoLinks.find((l) => l.ref === repoKey);
    if (rl) await onRemoveLink(rl.id);
    // Add worktree link
    const ref = `${repoKey}:${wt.branch}`;
    await onAddLink({ type: 'worktree', ref, label: wt.branch });
  };

  const handleClearWorktree = async (org: string, name: string) => {
    const repoKey = `${org}/${name}`;
    const wtLinkIds = getWorktreeLinkIdsForRepo(org, name);
    for (const id of wtLinkIds) {
      await onRemoveLink(id);
    }
    // Re-add repository link to preserve repo selection
    const hasRepoLink = repoLinks.some((l) => l.ref === repoKey);
    if (!hasRepoLink) {
      await onAddLink({ type: 'repository', ref: repoKey, label: repoKey });
    }
  };

  // Sort worktrees for display
  const sortedWorktrees = useMemo(
    () => [...worktrees].sort((a, b) => a.branch.toLowerCase().localeCompare(b.branch.toLowerCase())),
    [worktrees],
  );

  // Pre-compute single-repo values (hooks must be unconditional)
  const firstWorktreeLink = worktreeLinks[0] ?? null;
  const firstRepoLink = repoLinks[0] ?? null;
  const worktreeExistsLocally = useMemo(() => {
    if (!firstWorktreeLink || loading) return true;
    const ref = firstWorktreeLink.ref;
    if (ref.startsWith('/')) {
      return worktrees.some((wt) => wt.path === ref);
    }
    const colonIdx = ref.indexOf(':');
    if (colonIdx > 0) {
      const branch = ref.substring(colonIdx + 1);
      return worktrees.some((wt) => wt.branch === branch);
    }
    return true;
  }, [firstWorktreeLink, worktrees, loading]);

  // ── Single-repo fast path (backward compatible) ──
  if (linkedRepos.length <= 1) {
    const linkedRepo = linkedRepos[0] ?? null;
    const effectiveRepo = linkedRepo ? `${linkedRepo.org}/${linkedRepo.name}` : null;
    const repoInConfig = effectiveRepo ? repos.some((r) => r.key === effectiveRepo) : false;
    const effectiveRepoNotCloned = effectiveRepo ? summaries[effectiveRepo]?.isClonedLocally === false : false;

    const handleSingleRepoChange = async (value: string) => {
      if (value === '__all__') {
        if (firstRepoLink) await onRemoveLink(firstRepoLink.id);
        if (firstWorktreeLink) await onRemoveLink(firstWorktreeLink.id);
      } else {
        if (firstRepoLink) await onRemoveLink(firstRepoLink.id);
        await onAddLink({ type: 'repository', ref: value, label: value });
        if (firstWorktreeLink && linkedRepo && `${linkedRepo.org}/${linkedRepo.name}` !== value) {
          await onRemoveLink(firstWorktreeLink.id);
        }
      }
    };

    return (
      <>
        {/* Repository */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Repository
          </label>
          {linkedRepo && !repoInConfig ? (
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                  <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9z" />
                </svg>
                <span className="truncate text-xs text-[var(--theme-text-secondary)]">{linkedRepo.org}/{linkedRepo.name}</span>
              </div>
              <button
                className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={async () => {
                  if (firstWorktreeLink) await onRemoveLink(firstWorktreeLink.id);
                  if (firstRepoLink) await onRemoveLink(firstRepoLink.id);
                }}
                title="Unlink repository"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          ) : repos.length === 0 ? (
            <span className="text-[10px] text-[var(--theme-text-muted)]">No repositories configured</span>
          ) : (
            <select
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
              value={effectiveRepo ?? '__all__'}
              onChange={(e) => handleSingleRepoChange(e.target.value)}
            >
              <option value="__all__">All repositories</option>
              {repos.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.org}/{r.name}
                </option>
              ))}
            </select>
          )}
          {/* Add another repo (transitions to multi-repo) */}
          {effectiveRepo && availableRepos.length > 0 && (
            <select
              className="mt-1 w-full rounded-md border border-dashed border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              value=""
              onChange={(e) => {
                if (e.target.value) handleAddRepo(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">+ Add repository</option>
              {availableRepos.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.org}/{r.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Branch */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Branch
          </label>
          {firstWorktreeLink ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                    <circle cx="5" cy="3.5" r="1.5" />
                    <circle cx="8" cy="12.5" r="1.5" />
                    <line x1="5" y1="5" x2="8" y2="11" />
                  </svg>
                  <span className="truncate text-xs text-[var(--theme-text-primary)]">{firstWorktreeLink.label}</span>
                </div>
                <button
                  className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                  onClick={() => linkedRepo ? handleClearWorktree(linkedRepo.org, linkedRepo.name) : undefined}
                  title="Unlink worktree"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              </div>
              {!loading && !worktreeExistsLocally && (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 flex-shrink-0 text-amber-400">
                    <path d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm.25-5.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5z" />
                  </svg>
                  <span className="text-[10px] leading-tight text-amber-300">
                    Worktree not found locally — it will be auto-created when you open a session.
                  </span>
                </div>
              )}
            </>
          ) : loading ? (
            <span className="text-[10px] text-[var(--theme-text-muted)]">Loading worktrees...</span>
          ) : effectiveRepoNotCloned ? (
            <span className="text-[10px] text-[var(--theme-text-muted)]">Repository not cloned locally</span>
          ) : sortedWorktrees.length === 0 ? (
            <span className="text-[10px] text-[var(--theme-text-muted)]">No worktrees found</span>
          ) : (
            <select
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
              value=""
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                const wt = sortedWorktrees[idx];
                if (wt) handleWorktreeSelect(wt);
              }}
            >
              <option value="" disabled>Select a worktree...</option>
              {sortedWorktrees.map((wt, i) => {
                const prefix = !effectiveRepo ? `${wt.org}/${wt.name} · ` : '';
                return (
                  <option key={`${wt.org}/${wt.name}:${wt.branch}`} value={i}>
                    {prefix}{wt.branch}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      </>
    );
  }

  // ── Multi-repo view (>= 2 repos) ──
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Repositories
      </label>
      <div className="flex flex-col gap-1.5">
        {linkedRepos.map((repo) => {
          const repoKey = `${repo.org}/${repo.name}`;
          const branch = getBranchForRepo(repo.org, repo.name);
          return (
            <div key={repoKey} className="flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9z" />
              </svg>
              <span className="truncate text-[10px] font-medium text-[var(--theme-text-primary)]">{repoKey}</span>
              {branch && (
                <span className="ml-auto truncate text-[9px] text-[var(--theme-text-muted)]" title={branch}>
                  {branch}
                </span>
              )}
              <button
                className="ml-1 flex-shrink-0 rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={() => handleRemoveRepo(repo.org, repo.name, repo.linkId)}
                title="Remove repository"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* Add repository dropdown */}
        {availableRepos.length > 0 && (
          <select
            className="w-full rounded-md border border-dashed border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddRepo(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">+ Add repository</option>
            {availableRepos.map((r) => (
              <option key={r.key} value={r.key}>
                {r.org}/{r.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ── GitHub Issue Picker ──

const GITHUB_ISSUE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

function GitHubIssuePicker({
  ticket,
  onAddLink,
  onRemoveLink,
  onSync,
}: {
  ticket: Ticket;
  onAddLink: (link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueLink = ticket.links.find((l) => l.type === 'github_issue');

  const handleSave = async () => {
    const trimmed = urlValue.trim();
    setError(null);

    // If empty, just close
    if (!trimmed) {
      setEditing(false);
      return;
    }

    const match = trimmed.match(GITHUB_ISSUE_RE);
    if (!match) {
      setError('Invalid GitHub issue URL');
      return;
    }

    const [, org, name, num] = match as RegExpMatchArray & [string, string, string, string];
    const issueNumber = parseInt(num, 10);
    const ref = `${org}/${name}#${issueNumber}`;
    const label = `#${issueNumber}`;

    setLoading(true);
    try {
      // Remove existing github_issue link first
      if (issueLink) {
        await onRemoveLink(issueLink.id);
      }
      await onAddLink({ type: 'github_issue', ref, label, url: trimmed });
      setEditing(false);
      setUrlValue('');
    } catch (err) {
      setError('Failed to save link');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } catch {
      // Sync errors are non-fatal
    } finally {
      setSyncing(false);
    }
  };

  const handleRemove = async () => {
    if (issueLink) {
      await onRemoveLink(issueLink.id);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        GitHub Issue
      </label>
      {issueLink && !editing ? (
        <div className="flex items-center gap-2">
          <a
            href={issueLink.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-xs transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-secondary)]">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="truncate font-medium text-[var(--theme-text-primary)]">{issueLink.ref}</span>
          </a>
          <button
            className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
            onClick={() => {
              setUrlValue(issueLink.url ?? '');
              setEditing(true);
            }}
            title="Edit GitHub issue link"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
            </svg>
          </button>
          <button
            className={cn(
              'rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)] disabled:opacity-50',
              syncing && 'animate-spin',
            )}
            onClick={handleSync}
            disabled={syncing}
            title="Sync GitHub metadata"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v-3h3" />
              <path d="M15 12v3h-3" />
              <path d="M13.5 6.5A6 6 0 0 0 4 3L1 1" />
              <path d="M2.5 9.5A6 6 0 0 0 12 13l3 2" />
            </svg>
          </button>
          <button
            className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
            onClick={handleRemove}
            title="Remove GitHub issue link"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
            placeholder="https://github.com/org/repo/issues/123"
            value={urlValue}
            onChange={(e) => { setUrlValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setEditing(false); setUrlValue(''); setError(null); }
            }}
            disabled={loading}
          />
          {error && (
            <span className="text-[10px] text-[var(--theme-danger)]">{error}</span>
          )}
          <div className="flex gap-1">
            <button
              className="rounded-md bg-[var(--theme-accent)] px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-[var(--theme-accent-active)] disabled:opacity-50"
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              className="rounded-md bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => { setEditing(false); setUrlValue(''); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="w-full rounded-md border border-dashed border-[var(--theme-border)] px-2 py-1.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setEditing(true)}
        >
          + Link GitHub issue
        </button>
      )}
    </div>
  );
}

// ── PR Link Picker ──

const GITHUB_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

function PRLinkPicker({
  ticket,
  prStates,
  onAddLink,
  onRemoveLink,
}: {
  ticket: Ticket;
  prStates: Record<string, string>;
  onAddLink: (link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prLinks = ticket.links.filter((l) => l.type === 'github_pr');

  const handleSave = async () => {
    const trimmed = urlValue.trim();
    setError(null);

    if (!trimmed) {
      setEditing(false);
      return;
    }

    const match = trimmed.match(GITHUB_PR_RE);
    if (!match) {
      setError('Invalid GitHub PR URL (e.g. https://github.com/org/repo/pull/123)');
      return;
    }

    const [, org, name, num] = match as RegExpMatchArray & [string, string, string, string];
    const prNumber = parseInt(num, 10);
    const ref = `${org}/${name}#${prNumber}`;
    const label = `#${prNumber}`;

    // Don't add duplicate
    if (prLinks.some((l) => l.ref === ref)) {
      setError('This PR is already linked');
      return;
    }

    setLoading(true);
    try {
      await onAddLink({ type: 'github_pr', ref, label, url: trimmed });
      setEditing(false);
      setUrlValue('');
    } catch {
      setError('Failed to save link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Pull Request
      </label>
      <div className="flex flex-col gap-1.5">
        {prLinks.map((pr) => {
          const state = prStates[pr.ref];
          const isMerged = state === 'MERGED';
          const isClosed = state === 'CLOSED';
          const colorClass = isMerged
            ? 'border-purple-500/20 bg-purple-500/[0.06] hover:bg-purple-500/[0.12]'
            : isClosed
              ? 'border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/[0.12]'
              : 'border-green-500/20 bg-green-500/[0.06] hover:bg-green-500/[0.12]';
          const textClass = isMerged ? 'text-purple-400' : isClosed ? 'text-red-400' : 'text-green-400';
          return (
            <div key={pr.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${colorClass}`}>
              <a
                href={pr.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={`flex-shrink-0 ${textClass}`}>
                  <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218zM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm8-8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zM4.25 4a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" />
                </svg>
                <span className={`font-medium ${textClass}`}>{pr.label}</span>
                <span className="truncate text-[10px] text-[var(--theme-text-faint)]">{pr.ref}</span>
              </a>
              <button
                className="flex-shrink-0 rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={() => onRemoveLink(pr.id)}
                title="Remove PR link"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          );
        })}

        {editing ? (
          <div className="flex flex-col gap-1.5">
            <input
              autoFocus
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              placeholder="https://github.com/org/repo/pull/123"
              value={urlValue}
              onChange={(e) => { setUrlValue(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setEditing(false); setUrlValue(''); setError(null); }
              }}
              disabled={loading}
            />
            {error && (
              <span className="text-[10px] text-[var(--theme-danger)]">{error}</span>
            )}
            <div className="flex gap-1">
              <button
                className="rounded-md bg-[var(--theme-accent)] px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-[var(--theme-accent-active)] disabled:opacity-50"
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                className="rounded-md bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                onClick={() => { setEditing(false); setUrlValue(''); setError(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full rounded-md border border-dashed border-[var(--theme-border)] px-2 py-1.5 text-[10px] text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
            onClick={() => setEditing(true)}
          >
            + Link PR
          </button>
        )}
      </div>
    </div>
  );
}

// ── GitHub Metadata Section ──

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

const STATE_COLORS: Record<string, string> = {
  OPEN: 'text-green-400',
  CLOSED: 'text-red-400',
  MERGED: 'text-purple-400',
};

function GitHubMetadataSection({ metadata }: { metadata: GitHubIssueMetadata }) {
  const rows: [string, React.ReactNode][] = [
    ['State', (
      <span className={cn('font-medium', STATE_COLORS[metadata.state] ?? 'text-[var(--theme-text-secondary)]')}>
        {metadata.state.charAt(0) + metadata.state.slice(1).toLowerCase()}
      </span>
    )],
    ['Author', <span>@{metadata.author}</span>],
  ];

  if (metadata.assignees.length > 0) {
    rows.push(['Assignees', <span>{metadata.assignees.map((a) => `@${a}`).join(', ')}</span>]);
  }

  if (metadata.labels.length > 0) {
    rows.push(['Labels', (
      <div className="flex flex-wrap gap-0.5">
        {metadata.labels.map((l) => (
          <span key={l} className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[9px]">{l}</span>
        ))}
      </div>
    )]);
  }

  if (metadata.milestone) {
    rows.push(['Milestone', <span>{metadata.milestone}</span>]);
  }

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        GitHub Metadata
      </label>
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-xs">
        <table className="w-full">
          <tbody>
            {rows.map(([label, value], i) => (
              <tr key={label} className={i > 0 ? 'border-t border-[var(--theme-border)]' : ''}>
                <td className="whitespace-nowrap px-2 py-1 text-[10px] font-medium text-[var(--theme-text-muted)]">{label}</td>
                <td className="px-2 py-1 text-[var(--theme-text-secondary)]">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="mt-1 block text-[9px] text-[var(--theme-text-faint)]">
        Last synced: {formatRelativeTime(metadata.syncedAt)}
      </span>
    </div>
  );
}

// ── Assignee Field ──

function AssigneeField({
  assignee,
  onChange,
}: {
  assignee: string | null;
  onChange: (assignee: string | null) => void;
}) {
  const personas = useAgentPersonaStore((s) => s.personas);
  const loaded = useAgentPersonaStore((s) => s.loaded);
  const loadPersonas = useAgentPersonaStore((s) => s.loadPersonas);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) loadPersonas();
  }, [loaded, loadPersonas]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (name: string | null) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Assignee
      </label>
      <button
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          assignee
            ? 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]'
            : 'border-dashed border-[var(--theme-border)] text-[10px] text-[var(--theme-text-muted)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]',
        )}
        onClick={() => setOpen(!open)}
      >
        {assignee ? (
          <>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
            </svg>
            <span className="flex-1 truncate text-left">{assignee === 'user' ? 'Me' : assignee}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-faint)]">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </>
        ) : (
          <span className="flex-1 text-left">+ Assign</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg">
          {/* Unassigned option */}
          <button
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
              assignee === null
                ? 'text-[var(--theme-text-primary)] font-medium'
                : 'text-[var(--theme-text-secondary)]',
            )}
            onClick={() => handleSelect(null)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--theme-text-faint)]">
              <circle cx="8" cy="8" r="6" />
              <line x1="5" y1="8" x2="11" y2="8" />
            </svg>
            <span>Unassigned</span>
            {assignee === null && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="ml-auto flex-shrink-0 text-[var(--theme-accent)]">
                <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
              </svg>
            )}
          </button>

          {/* Me (human) option */}
          <button
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
              assignee === 'user'
                ? 'text-[var(--theme-text-primary)] font-medium'
                : 'text-[var(--theme-text-secondary)]',
            )}
            onClick={() => handleSelect('user')}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
            </svg>
            <span>Me</span>
            {assignee === 'user' && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="ml-auto flex-shrink-0 text-[var(--theme-accent)]">
                <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
              </svg>
            )}
          </button>

          {personas.length > 0 && (
            <div className="mx-2 my-1 border-t border-[var(--theme-border)]" />
          )}

          {/* Persona options */}
          {personas.map((p) => (
            <button
              key={p.id}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                assignee === p.name
                  ? 'text-[var(--theme-text-primary)] font-medium'
                  : 'text-[var(--theme-text-secondary)]',
              )}
              onClick={() => handleSelect(p.name)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
              </svg>
              <span className="truncate">{p.displayName}</span>
              <span className="ml-auto truncate text-[10px] text-[var(--theme-text-faint)]">{p.name}</span>
              {assignee === p.name && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-accent)]">
                  <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tag Input ──

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setActive(true)}
      >
        + tag
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="w-16 rounded border border-[var(--theme-border-input)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--theme-text-primary)] focus:outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onAdd(value.trim());
          setValue('');
          setActive(false);
        }
        if (e.key === 'Escape') {
          setValue('');
          setActive(false);
        }
      }}
      onBlur={() => {
        if (value.trim()) onAdd(value.trim());
        setValue('');
        setActive(false);
      }}
    />
  );
}
