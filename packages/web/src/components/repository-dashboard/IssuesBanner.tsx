import { useState, useCallback } from 'react';
import type { GitHubIssue, GitHubIssueDetail } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { DataTable, type Column } from '../ui/DataTable';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';
import { notifyHookStarted } from '../../lib/hookResultToast';

interface Props {
  org: string;
  name: string;
  issues: GitHubIssue[];
  loading: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function formatClaudePrompt(detail: GitHubIssueDetail): string {
  const lines: string[] = [
    'Read carefully the following GitHub issue and plan a fix for it.',
    '',
    `# Issue #${detail.number}: ${detail.title}`,
    `URL: ${detail.url}`,
    `Author: ${detail.author} | State: ${detail.state}`,
    `Labels: ${detail.labels.length > 0 ? detail.labels.join(', ') : 'none'}`,
    `Assignees: ${detail.assignees.length > 0 ? detail.assignees.join(', ') : 'none'}`,
    `Milestone: ${detail.milestone ?? 'none'}`,
    '',
    '## Description',
    detail.body || '_No description provided._',
  ];

  if (detail.comments.length > 0) {
    lines.push('', `## Comments (${detail.comments.length})`);
    for (const c of detail.comments) {
      lines.push(`### ${c.author} — ${new Date(c.createdAt).toLocaleDateString()}`, c.body, '---');
    }
  }

  lines.push(
    '',
    'Please analyze this issue thoroughly, understand the root cause, explore the codebase to identify the relevant files, and propose a detailed implementation plan to fix it.',
  );

  return lines.join('\n');
}

export function IssuesBanner({ org, name, issues, loading }: Props) {
  const [creating, setCreating] = useState<Set<number>>(new Set());
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectSession = useSessionStore((s) => s.selectSession);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const handleCreateSession = useCallback(async (issue: GitHubIssue, type: 'shell' | 'claude') => {
    if (creating.has(issue.number)) return;
    setCreating((prev) => new Set(prev).add(issue.number));
    try {
      const branch = `issue-${issue.number}-${slugify(issue.title)}`;
      const result = await api.createWorktree(org, name, {
        branch,
        createNewBranch: true,
        issueNumber: issue.number,
      });
      const cwd = result.path;
      notifyHookStarted(result.hookStarted);

      if (type === 'claude') {
        const detail = await api.fetchIssueDetail(org, name, issue.number);
        const claudePrompt = formatClaudePrompt(detail);
        const session = await api.createSession({ type: 'claude', cwd, claudePrompt });
        selectSession(session.id);
      } else {
        const session = await api.createSession({ type: 'shell', cwd });
        selectSession(session.id);
      }

      setActivePanel('sessions');
      fetchDashboard(org, name);
    } catch {
      // ignore
    } finally {
      setCreating((prev) => {
        const next = new Set(prev);
        next.delete(issue.number);
        return next;
      });
    }
  }, [creating, org, name, selectSession, setActivePanel, fetchDashboard]);

  const columns: Column<GitHubIssue>[] = [
    {
      key: 'number',
      header: '#',
      shrink: true,
      render: (row) => <span className="text-[var(--theme-text-muted)]">#{row.number}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => <span className="truncate text-[var(--theme-text-secondary)]">{row.title}</span>,
    },
    {
      key: 'author',
      header: 'Author',
      shrink: true,
      render: (row) => <span className="text-[var(--theme-text-secondary)]">{row.author}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="text-[var(--theme-text-muted)]" title={new Date(row.createdAt).toLocaleString(undefined, { hour12: false })}>
          {formatRelativeTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      shrink: true,
      align: 'right',
      render: (row) => {
        const busy = creating.has(row.number);
        return (
          <span className="flex items-center justify-end gap-1.5">
            <button
              className={cn(
                'rounded p-1.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-secondary)]',
                busy && 'pointer-events-none opacity-40',
              )}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateSession(row, 'shell');
              }}
              title="New Shell Session"
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <polyline points="4.5,6.5 7,9 4.5,11.5" />
                <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
              </svg>
            </button>
            <button
              className={cn(
                'rounded p-1.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-accent)]',
                busy && 'pointer-events-none opacity-40',
              )}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateSession(row, 'claude');
              }}
              title="New Claude Session"
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="4" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
                <circle cx="8" cy="12" r="1.5" />
              </svg>
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={issues}
      selectedIndex={null}
      onSelect={(i) => {
        const issue = issues[i];
        if (issue) {
          window.open(`https://github.com/${org}/${name}/issues/${issue.number}`, '_blank');
        }
      }}
      loading={loading}
      emptyMessage="No issues assigned to you"
      maxHeight="max-h-[calc(100vh-14rem)]"
    />
  );
}
