import type {
  Session,
  SessionGroup,
  CreateSessionRequest,
  Repository,
  Worktree,
  CreateWorktreeRequest,
  PullRequest,
} from '@asm/shared';
import { API_URL } from '../lib/constants';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${body || res.statusText}`);
  }
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
