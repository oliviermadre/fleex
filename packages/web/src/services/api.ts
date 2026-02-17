import type {
  Session,
  SessionGroup,
  CreateSessionRequest,
  Repository,
  Worktree,
  CreateWorktreeRequest,
  PullRequest,
  GitHubIssue,
  GitHubIssueDetail,
  DiffStats,
  RepositorySummary,
  RepositoryDashboardData,
  ClaudeConfigTreeEntry,
  ClaudeUsage,
} from '@asm/shared';
import { API_URL } from '../lib/constants';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options?.headers } : options?.headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${body || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchSessions(): Promise<Session[]> {
  return request<Session[]>('/sessions');
}

export async function createSession(req: CreateSessionRequest): Promise<Session> {
  return request<Session>('/sessions', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function killSession(id: string): Promise<void> {
  await request<void>(`/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchSessionGroups(): Promise<SessionGroup[]> {
  return request<SessionGroup[]>('/sessions/groups');
}

export async function fetchRepositories(): Promise<Repository[]> {
  return request<Repository[]>('/repositories');
}

export async function fetchBranches(org: string, name: string): Promise<string[]> {
  return request<string[]>(`/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/branches`);
}

export async function fetchWorktrees(org: string, name: string): Promise<Worktree[]> {
  return request<Worktree[]>(`/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/worktrees`);
}

export async function createWorktree(
  org: string,
  name: string,
  req: CreateWorktreeRequest
): Promise<{ path: string }> {
  return request<{ path: string }>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/worktrees`,
    { method: 'POST', body: JSON.stringify(req) }
  );
}

export async function fetchPullRequests(org: string, name: string, force = false): Promise<PullRequest[]> {
  const qs = force ? '?force=true' : '';
  return request<PullRequest[]>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/pulls${qs}`
  );
}

export async function fetchIssues(org: string, name: string): Promise<GitHubIssue[]> {
  return request<GitHubIssue[]>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/issues`
  );
}

export async function fetchDiffStats(
  org: string,
  name: string,
  branches: string[]
): Promise<Record<string, DiffStats>> {
  const query = branches.map(encodeURIComponent).join(',');
  return request<Record<string, DiffStats>>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/diff-stats?branches=${query}`
  );
}

export async function fetchDefaultBranch(
  org: string,
  name: string
): Promise<{ defaultBranch: string; currentBranch: string; isOnDefault: boolean }> {
  return request<{ defaultBranch: string; currentBranch: string; isOnDefault: boolean }>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/default-branch`
  );
}

export async function fetchConfig(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/config');
}

export async function updateConfig(config: Record<string, unknown>): Promise<void> {
  await request<void>('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// Repository Dashboard API

export async function fetchRepositorySummaries(): Promise<RepositorySummary[]> {
  return request<RepositorySummary[]>('/repositories/summaries');
}

export async function fetchRepositoryDashboard(
  org: string,
  name: string,
): Promise<RepositoryDashboardData> {
  return request<RepositoryDashboardData>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/dashboard`,
  );
}

export async function fetchMergedPulls(org: string, name: string): Promise<PullRequest[]> {
  return request<PullRequest[]>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/merged-pulls`,
  );
}

export async function deleteWorktree(org: string, name: string, wtPath: string): Promise<void> {
  await request<void>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/worktrees`,
    { method: 'DELETE', body: JSON.stringify({ path: wtPath }) },
  );
}

export async function fetchIssueDetail(
  org: string,
  name: string,
  issueNumber: number,
): Promise<GitHubIssueDetail> {
  return request<GitHubIssueDetail>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/issues/${issueNumber}`,
  );
}

export async function requestRepositoryRefresh(
  scope: 'all' | 'repo',
  org?: string,
  name?: string,
): Promise<void> {
  await request<void>('/repositories/refresh', {
    method: 'POST',
    body: JSON.stringify({ scope, org, name }),
  });
}

export async function fetchGitHubUser(): Promise<{ login: string }> {
  return request<{ login: string }>('/github/user');
}

// Claude Config API

export async function fetchClaudeConfigTree(): Promise<ClaudeConfigTreeEntry[]> {
  return request<ClaudeConfigTreeEntry[]>('/claude-config/tree');
}

export async function fetchClaudeConfigFile(path: string): Promise<{ content: string }> {
  return request<{ content: string }>(`/claude-config/file?path=${encodeURIComponent(path)}`);
}

export async function saveClaudeConfigFile(path: string, content: string): Promise<void> {
  await request<{ ok: boolean }>('/claude-config/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function createClaudeConfigEntry(path: string, type: 'file' | 'directory'): Promise<void> {
  await request<{ ok: boolean }>('/claude-config/create', {
    method: 'POST',
    body: JSON.stringify({ path, type }),
  });
}

export async function deleteClaudeConfigEntry(path: string): Promise<void> {
  await request<{ ok: boolean }>('/claude-config/file', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
}

// Scratchpad API

export async function fetchScratchpad(): Promise<{ content: string }> {
  return request<{ content: string }>('/scratchpad');
}

export async function saveScratchpad(content: string): Promise<void> {
  await request<{ ok: boolean }>('/scratchpad', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function fetchRepoScratchpad(org: string, name: string): Promise<{ content: string }> {
  return request<{ content: string }>(
    `/scratchpads/${encodeURIComponent(org)}/${encodeURIComponent(name)}`,
  );
}

export async function saveRepoScratchpad(org: string, name: string, content: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/scratchpads/${encodeURIComponent(org)}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
}

export async function fetchScratchpadList(
  repos?: string[],
): Promise<{ items: { key: string; label: string; lineCount: number }[] }> {
  const qs = repos && repos.length > 0 ? `?repos=${encodeURIComponent(repos.join(','))}` : '';
  return request<{ items: { key: string; label: string; lineCount: number }[] }>(
    `/scratchpads${qs}`,
  );
}

// ── Tickets & Boards API ──

export async function fetchBoards(): Promise<import('@asm/shared').BoardWithCounts[]> {
  return request<import('@asm/shared').BoardWithCounts[]>('/boards');
}

export async function createBoard(req: import('@asm/shared').CreateBoardRequest): Promise<import('@asm/shared').Board> {
  return request<import('@asm/shared').Board>('/boards', { method: 'POST', body: JSON.stringify(req) });
}

export async function updateBoard(id: string, req: import('@asm/shared').UpdateBoardRequest): Promise<import('@asm/shared').Board> {
  return request<import('@asm/shared').Board>(`/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deleteBoard(id: string): Promise<void> {
  await request<void>(`/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchTickets(boardId?: string): Promise<import('@asm/shared').Ticket[]> {
  const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  return request<import('@asm/shared').Ticket[]>(`/tickets${qs}`);
}

export async function fetchTicket(id: string): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>(`/tickets/${encodeURIComponent(id)}`);
}

export async function createTicket(req: import('@asm/shared').CreateTicketRequest): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>('/tickets', { method: 'POST', body: JSON.stringify(req) });
}

export async function updateTicket(id: string, req: import('@asm/shared').UpdateTicketRequest): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>(`/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function updateTicketSilent(id: string, req: import('@asm/shared').UpdateTicketRequest): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>(`/tickets/${encodeURIComponent(id)}?silent=true`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deleteTicket(id: string): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function moveTicket(id: string, status: import('@asm/shared').TicketStatus, position?: number): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>(`/tickets/${encodeURIComponent(id)}/move`, {
    method: 'POST', body: JSON.stringify({ status, position }),
  });
}

export async function reorderTickets(updates: { id: string; status: import('@asm/shared').TicketStatus; position: number }[]): Promise<void> {
  await request<{ ok: boolean }>('/tickets/reorder', { method: 'POST', body: JSON.stringify({ updates }) });
}

export async function addTicketLink(id: string, link: { type: string; ref: string; label: string; url?: string }): Promise<import('@asm/shared').TicketLink> {
  return request<import('@asm/shared').TicketLink>(`/tickets/${encodeURIComponent(id)}/links`, {
    method: 'POST', body: JSON.stringify(link),
  });
}

export async function removeTicketLink(id: string, linkId: string): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
}

export async function fetchTicketActivity(id: string): Promise<import('@asm/shared').TicketActivity[]> {
  return request<import('@asm/shared').TicketActivity[]>(`/tickets/${encodeURIComponent(id)}/activity`);
}

export async function openSessionFromTicket(id: string): Promise<{ sessionId: string }> {
  return request<{ sessionId: string }>(`/tickets/${encodeURIComponent(id)}/open-session`, { method: 'POST' });
}

export async function importGitHubIssue(org: string, name: string, issueNumber: number, boardId: string): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>('/tickets/import-github-issue', {
    method: 'POST', body: JSON.stringify({ org, name, number: issueNumber, boardId }),
  });
}

export async function syncGithubIssue(ticketId: string): Promise<import('@asm/shared').Ticket> {
  return request<import('@asm/shared').Ticket>(`/tickets/${encodeURIComponent(ticketId)}/sync-github`, {
    method: 'POST',
  });
}

// ── Agent Tokens API ──

export async function fetchAgentTokens(): Promise<import('@asm/shared').AgentToken[]> {
  return request<import('@asm/shared').AgentToken[]>('/agent-tokens');
}

export async function createAgentToken(name: string): Promise<import('@asm/shared').AgentTokenCreated> {
  return request<import('@asm/shared').AgentTokenCreated>('/agent-tokens', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function deleteAgentToken(id: string): Promise<void> {
  await request<void>(`/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Claude Usage API

export async function fetchClaudeUsage(force = false): Promise<ClaudeUsage | null> {
  try {
    const qs = force ? '?force=true' : '';
    return await request<ClaudeUsage>(`/claude-usage${qs}`);
  } catch {
    return null;
  }
}
