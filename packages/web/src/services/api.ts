import type {
  Session,
  SessionGroup,
  CreateSessionRequest,
  Repository,
  Worktree,
  CreateWorktreeRequest,
  PullRequest,
  GitHubIssue,
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

export async function fetchPullRequests(org: string, name: string): Promise<PullRequest[]> {
  return request<PullRequest[]>(
    `/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/pulls`
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

// Claude Usage API

export async function fetchClaudeUsage(): Promise<ClaudeUsage | null> {
  try {
    return await request<ClaudeUsage>('/claude-usage');
  } catch {
    return null;
  }
}
