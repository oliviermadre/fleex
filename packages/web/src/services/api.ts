import type {
  Session,
  SessionGroup,
  CreateSessionRequest,
  Repository,
  Worktree,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  PullRequest,
  GitHubIssue,
  GitHubIssueDetail,
  DiffStats,
  RepositorySummary,
  RepositoryDashboardData,
  ClaudeConfigTreeEntry,
  ClaudeUsage,
  AgentExecution,
  AgentEvent,
  DomainEventLog,
  StatisticsResponse,
  DashboardData,
  TicketGroup,
  CreateTicketGroupRequest,
  UpdateTicketGroupRequest,
  Ticket,
  TicketRelationship,
  WorkflowTemplate,
  WorkflowRun,
  StepRun,
  ModelsResponse,
} from '@fleex/shared';
import { API_URL } from '../lib/constants';
import { useToastStore } from '../stores/toastStore';

function extractErrorMessage(body: string, statusText: string): string {
  try {
    const json = JSON.parse(body);
    if (typeof json.message === 'string') return json.message;
    if (typeof json.error === 'string') return json.error;
  } catch {
    // not JSON
  }
  return body || statusText;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options?.headers } : options?.headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = extractErrorMessage(body, res.statusText);
    useToastStore.getState().addToast('error', message);
    throw new Error(`API error ${res.status}: ${body || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/models');
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

export async function renameSession(id: string, displayName: string): Promise<Session> {
  return request<Session>(`/sessions/${encodeURIComponent(id)}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
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
): Promise<CreateWorktreeResponse> {
  return request<CreateWorktreeResponse>(
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

export type CheckCwdResult =
  | { exists: true }
  | { exists: false; remote: string; targetPath: string };

export async function checkRepoCwd(org: string, name: string): Promise<CheckCwdResult> {
  return request<CheckCwdResult>(
    `/repositories/check-cwd?org=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}`
  );
}

export async function cloneRepo(org: string, name: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/repositories/clone', {
    method: 'POST',
    body: JSON.stringify({ org, name }),
  });
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

export async function fetchBoards(): Promise<import('@fleex/shared').BoardWithCounts[]> {
  return request<import('@fleex/shared').BoardWithCounts[]>('/boards');
}

export async function createBoard(req: import('@fleex/shared').CreateBoardRequest): Promise<import('@fleex/shared').Board> {
  return request<import('@fleex/shared').Board>('/boards', { method: 'POST', body: JSON.stringify(req) });
}

export async function updateBoard(id: string, req: import('@fleex/shared').UpdateBoardRequest): Promise<import('@fleex/shared').Board> {
  return request<import('@fleex/shared').Board>(`/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deleteBoard(id: string): Promise<void> {
  await request<void>(`/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchTickets(boardId?: string): Promise<import('@fleex/shared').Ticket[]> {
  const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  return request<import('@fleex/shared').Ticket[]>(`/tickets${qs}`);
}

export async function fetchTicket(id: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}`);
}

export async function createTicket(req: import('@fleex/shared').CreateTicketRequest): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>('/tickets', { method: 'POST', body: JSON.stringify(req) });
}

export async function updateTicket(id: string, req: import('@fleex/shared').UpdateTicketRequest): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function updateTicketSilent(id: string, req: import('@fleex/shared').UpdateTicketRequest): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}?silent=true`, { method: 'PATCH', body: JSON.stringify(req) });
}

/**
 * Update the conversation-scoped execution config (mode/model/effort/fast).
 * Persists immediately and broadcasts ticket:updated; sends no comment.
 */
export async function updateTicketExecutionConfig(
  id: string,
  req: import('@fleex/shared').UpdateTicketExecutionConfigRequest,
): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(
    `/tickets/${encodeURIComponent(id)}/execution-config`,
    { method: 'PATCH', body: JSON.stringify(req) },
  );
}

export async function deleteTicket(id: string): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function archiveTicket(id: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export async function unarchiveTicket(id: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}/unarchive`, { method: 'POST' });
}

export async function fetchArchivedTickets(boardId?: string, limit = 50, offset = 0): Promise<{ tickets: import('@fleex/shared').Ticket[]; total: number }> {
  const params = new URLSearchParams();
  if (boardId) params.set('boardId', boardId);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return request<{ tickets: import('@fleex/shared').Ticket[]; total: number }>(`/tickets/archived?${params}`);
}

export async function moveTicket(id: string, status: import('@fleex/shared').TicketStatus, position?: number): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(id)}/move`, {
    method: 'POST', body: JSON.stringify({ status, position }),
  });
}

export async function reorderTickets(updates: { id: string; status: import('@fleex/shared').TicketStatus; position: number }[]): Promise<void> {
  await request<{ ok: boolean }>('/tickets/reorder', { method: 'POST', body: JSON.stringify({ updates }) });
}

export async function addTicketLink(id: string, link: { type: string; ref: string; label: string; url?: string }): Promise<import('@fleex/shared').TicketLink> {
  return request<import('@fleex/shared').TicketLink>(`/tickets/${encodeURIComponent(id)}/links`, {
    method: 'POST', body: JSON.stringify(link),
  });
}

export async function removeTicketLink(id: string, linkId: string): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
}

export async function fetchTicketActivity(id: string): Promise<import('@fleex/shared').TicketActivity[]> {
  return request<import('@fleex/shared').TicketActivity[]>(`/tickets/${encodeURIComponent(id)}/activity`);
}

export async function openSessionFromTicket(id: string): Promise<{ sessionId: string }> {
  return request<{ sessionId: string }>(`/tickets/${encodeURIComponent(id)}/open-session`, { method: 'POST' });
}

export async function importGitHubIssue(org: string, name: string, issueNumber: number, boardId: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>('/tickets/import-github-issue', {
    method: 'POST', body: JSON.stringify({ org, name, number: issueNumber, boardId }),
  });
}

export async function importSlackMessage(url: string, boardId: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>('/tickets/import-slack-message', {
    method: 'POST', body: JSON.stringify({ url, boardId }),
  });
}

export async function retrySlackImport(ticketId: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(ticketId)}/retry-slack-import`, {
    method: 'POST',
  });
}

export async function importGitHubPR(
  org: string, name: string, prNumber: number, prTitle: string, headRefName: string, boardId: string,
): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>('/tickets/import-github-pr', {
    method: 'POST', body: JSON.stringify({ org, name, prNumber, prTitle, headRefName, boardId }),
  });
}

export async function syncGithubIssue(ticketId: string): Promise<import('@fleex/shared').Ticket> {
  return request<import('@fleex/shared').Ticket>(`/tickets/${encodeURIComponent(ticketId)}/sync-github`, {
    method: 'POST',
  });
}

export async function fetchPRStates(ticketId: string): Promise<Record<string, string>> {
  return request<Record<string, string>>(`/tickets/${encodeURIComponent(ticketId)}/pr-states`);
}

export async function fetchBulkPRStates(refs: string[]): Promise<Record<string, string>> {
  if (refs.length === 0) return {};
  return request<Record<string, string>>('/pr-states', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refs }),
  });
}

// ── Ticket Mentions API ──

export async function fetchTicketMentions(ticketId: string): Promise<import('@fleex/shared').TicketMention[]> {
  return request<import('@fleex/shared').TicketMention[]>(`/tickets/${encodeURIComponent(ticketId)}/mentions`);
}

export async function updateMentionStatus(mentionId: string, status: import('@fleex/shared').MentionStatus): Promise<import('@fleex/shared').TicketMention> {
  return request<import('@fleex/shared').TicketMention>(`/mentions/${encodeURIComponent(mentionId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteMention(mentionId: string): Promise<void> {
  return request<void>(`/mentions/${encodeURIComponent(mentionId)}`, { method: 'DELETE' });
}

export async function deleteMentionFromComment(mentionId: string): Promise<void> {
  return request<void>(`/mentions/${encodeURIComponent(mentionId)}/from-comment`, { method: 'DELETE' });
}

// ── Ticket Deliverables API ──

export async function fetchTicketDeliverables(ticketId: string): Promise<import('@fleex/shared').TicketDeliverable[]> {
  return request<import('@fleex/shared').TicketDeliverable[]>(`/tickets/${encodeURIComponent(ticketId)}/deliverables`);
}

export async function createDeliverable(
  ticketId: string,
  payload: { title: string; type: string; content: string; status?: 'draft' | 'final'; agentName?: string },
): Promise<import('@fleex/shared').TicketDeliverable> {
  return request<import('@fleex/shared').TicketDeliverable>(`/tickets/${encodeURIComponent(ticketId)}/deliverables`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteDeliverable(ticketId: string, deliverableId: string): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(ticketId)}/deliverables/${encodeURIComponent(deliverableId)}`, { method: 'DELETE' });
}

// ── Deliverable Types (per-workspace config / backoffice) ──

export interface DeliverableTypesView {
  types: import('@fleex/shared').DeliverableTypeDef[];
  usage: Record<string, number>;
}

export async function fetchDeliverableTypes(): Promise<DeliverableTypesView> {
  return request<DeliverableTypesView>('/deliverable-types');
}

export async function createDeliverableType(
  input: { id: string; label: string; description?: string; renderer: import('@fleex/shared').DeliverableRenderer; color?: import('@fleex/shared').DeliverableTypeColor | null },
): Promise<DeliverableTypesView> {
  return request<DeliverableTypesView>('/deliverable-types', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateDeliverableType(
  id: string,
  patch: { label?: string; description?: string; renderer?: import('@fleex/shared').DeliverableRenderer; color?: import('@fleex/shared').DeliverableTypeColor | null },
): Promise<DeliverableTypesView> {
  return request<DeliverableTypesView>(`/deliverable-types/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function renameDeliverableType(id: string, newId: string): Promise<DeliverableTypesView & { migrated: number }> {
  return request<DeliverableTypesView & { migrated: number }>(`/deliverable-types/${encodeURIComponent(id)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ newId }),
  });
}

export async function deleteDeliverableType(id: string): Promise<DeliverableTypesView> {
  return request<DeliverableTypesView>(`/deliverable-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function reassignDeliverableType(from: string, to: string): Promise<{ migrated: number }> {
  return request<{ migrated: number }>('/deliverable-types/reassign', { method: 'POST', body: JSON.stringify({ from, to }) });
}

export async function changeDeliverableType(deliverableId: string, type: string): Promise<import('@fleex/shared').TicketDeliverable> {
  return request<import('@fleex/shared').TicketDeliverable>(`/deliverables/${encodeURIComponent(deliverableId)}/type`, {
    method: 'PATCH',
    body: JSON.stringify({ type }),
  });
}

// ── Ticket Comments API ──

export async function fetchTicketComments(ticketId: string): Promise<import('@fleex/shared').TicketComment[]> {
  return request<import('@fleex/shared').TicketComment[]>(`/tickets/${encodeURIComponent(ticketId)}/comments`);
}

export type MentionConflictAction = 'answer' | 'new_subject' | 'supersede' | 'queue';
export interface MentionConflictResolution {
  agent: string;
  action: MentionConflictAction;
}

export async function postTicketComment(
  ticketId: string,
  body: string,
  executionMode?: import('@fleex/shared').MentionExecutionMode,
  mentionConflicts?: MentionConflictResolution[],
): Promise<import('@fleex/shared').TicketComment> {
  return request<import('@fleex/shared').TicketComment>(`/tickets/${encodeURIComponent(ticketId)}/comments`, {
    method: 'POST', body: JSON.stringify({ body, executionMode, mentionConflicts }),
  });
}

export async function updateMentionExecutionMode(mentionId: string, executionMode: import('@fleex/shared').MentionExecutionMode): Promise<import('@fleex/shared').TicketMention> {
  return request<import('@fleex/shared').TicketMention>(`/mentions/${encodeURIComponent(mentionId)}/execution-mode`, {
    method: 'PATCH', body: JSON.stringify({ executionMode }),
  });
}

export async function deleteTicketComment(ticketId: string, commentId: string): Promise<void> {
  const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete comment: ${res.statusText}`);
}

// ── Read Cursors API ──

export async function fetchReadCursors(ticketId: string): Promise<import('@fleex/shared').TicketReadCursors> {
  return request<import('@fleex/shared').TicketReadCursors>(`/tickets/${encodeURIComponent(ticketId)}/read-cursors`);
}

export async function updateReadCursors(ticketId: string, cursors: { commentLastSeenAt?: string }): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(ticketId)}/read-cursors`, {
    method: 'PATCH', body: JSON.stringify(cursors),
  });
}

export async function fetchSeenDeliverables(ticketId: string): Promise<string[]> {
  return request<string[]>(`/tickets/${encodeURIComponent(ticketId)}/seen-deliverables`);
}

export async function toggleDeliverableSeen(ticketId: string, deliverableId: string, seen: boolean): Promise<void> {
  await request<void>(`/tickets/${encodeURIComponent(ticketId)}/seen-deliverables`, {
    method: 'PATCH', body: JSON.stringify({ deliverableId, seen }),
  });
}

export async function fetchUnreadCounts(ticketIds?: string[]): Promise<import('@fleex/shared').TicketUnreadCounts[]> {
  const params = ticketIds?.length ? `?ticketIds=${ticketIds.join(',')}` : '';
  return request<import('@fleex/shared').TicketUnreadCounts[]>(`/tickets/unread-counts${params}`);
}

// ── Agent Tokens API ──

export async function fetchAgentTokens(): Promise<import('@fleex/shared').AgentToken[]> {
  return request<import('@fleex/shared').AgentToken[]>('/agent-tokens');
}

export async function createAgentToken(name: string): Promise<import('@fleex/shared').AgentTokenCreated> {
  return request<import('@fleex/shared').AgentTokenCreated>('/agent-tokens', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function deleteAgentToken(id: string): Promise<void> {
  await request<void>(`/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Agent Personas API ──

export async function fetchPersonas(): Promise<import('@fleex/shared').AgentPersona[]> {
  return request<import('@fleex/shared').AgentPersona[]>('/personas');
}

export async function fetchPersona(id: string): Promise<import('@fleex/shared').AgentPersona> {
  return request<import('@fleex/shared').AgentPersona>(`/personas/${encodeURIComponent(id)}`);
}

export async function createPersona(req: import('@fleex/shared').CreateAgentPersonaRequest): Promise<import('@fleex/shared').AgentPersona> {
  return request<import('@fleex/shared').AgentPersona>('/personas', { method: 'POST', body: JSON.stringify(req) });
}

export async function updatePersona(id: string, req: import('@fleex/shared').UpdateAgentPersonaRequest): Promise<import('@fleex/shared').AgentPersona> {
  return request<import('@fleex/shared').AgentPersona>(`/personas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deletePersona(id: string): Promise<void> {
  await request<void>(`/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function executeAgent(id: string): Promise<import('@fleex/shared').AgentExecutionResult> {
  return request<import('@fleex/shared').AgentExecutionResult>(`/personas/${encodeURIComponent(id)}/execute`, { method: 'POST' });
}

export async function runMention(mentionId: string): Promise<import('@fleex/shared').AgentExecutionResult> {
  return request<import('@fleex/shared').AgentExecutionResult>(`/mentions/${encodeURIComponent(mentionId)}/run`, { method: 'POST' });
}

export async function fetchAgentStatus(id: string): Promise<{ running: boolean; pendingMentionCount: number; activeMentionIds: string[] }> {
  return request<{ running: boolean; pendingMentionCount: number; activeMentionIds: string[] }>(`/personas/${encodeURIComponent(id)}/status`);
}

export async function fetchAllPersonaStatuses(): Promise<Record<string, { running: boolean; pendingMentionCount: number; activeMentionIds: string[] }>> {
  return request<Record<string, { running: boolean; pendingMentionCount: number; activeMentionIds: string[] }>>('/personas/statuses');
}

// ── Skills API ──

export async function fetchSkills(): Promise<import('@fleex/shared').Skill[]> {
  return request<import('@fleex/shared').Skill[]>('/skills');
}

export async function fetchEnabledSkills(): Promise<import('@fleex/shared').Skill[]> {
  return request<import('@fleex/shared').Skill[]>('/skills/enabled');
}

export async function fetchSkill(id: string): Promise<import('@fleex/shared').Skill> {
  return request<import('@fleex/shared').Skill>(`/skills/${encodeURIComponent(id)}`);
}

export async function createSkill(req: import('@fleex/shared').CreateSkillRequest): Promise<import('@fleex/shared').Skill> {
  return request<import('@fleex/shared').Skill>('/skills', { method: 'POST', body: JSON.stringify(req) });
}

export async function updateSkill(id: string, req: import('@fleex/shared').UpdateSkillRequest): Promise<import('@fleex/shared').Skill> {
  return request<import('@fleex/shared').Skill>(`/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deleteSkill(id: string): Promise<void> {
  await request<void>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function executeSkill(id: string, ticketId: string): Promise<{ status: string; skillId: string; ticketId: string }> {
  return request<{ status: string; skillId: string; ticketId: string }>(`/skills/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ ticketId }),
  });
}

// ── Panels API ──

export async function fetchPanels(): Promise<import('@fleex/shared').Panel[]> {
  return request<import('@fleex/shared').Panel[]>('/panels');
}

export async function fetchPanel(id: string): Promise<import('@fleex/shared').Panel> {
  return request<import('@fleex/shared').Panel>(`/panels/${encodeURIComponent(id)}`);
}

export async function createPanel(req: import('@fleex/shared').CreatePanelRequest): Promise<import('@fleex/shared').Panel> {
  return request<import('@fleex/shared').Panel>('/panels', { method: 'POST', body: JSON.stringify(req) });
}

export async function updatePanel(id: string, req: import('@fleex/shared').UpdatePanelRequest): Promise<import('@fleex/shared').Panel> {
  return request<import('@fleex/shared').Panel>(`/panels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(req) });
}

export async function deletePanel(id: string): Promise<void> {
  await request<void>(`/panels/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function executePanel(id: string, ticketId: string, topic?: string): Promise<{ status: string; panelId: string; ticketId: string }> {
  return request<{ status: string; panelId: string; ticketId: string }>(`/panels/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ ticketId, topic }),
  });
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

// ── Agent Events & Executions ──

export async function fetchExecutionsForPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
  return request<AgentExecution[]>(`/personas/${personaId}/executions?limit=${limit}`);
}

export async function fetchExecutionsForTicket(ticketId: string): Promise<AgentExecution[]> {
  return request<AgentExecution[]>(`/tickets/${ticketId}/executions`);
}

export async function fetchEventsForExecution(executionId: string): Promise<AgentEvent[]> {
  return request<AgentEvent[]>(`/executions/${executionId}/events`);
}

export async function cancelExecution(executionId: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(`/executions/${executionId}/cancel`, { method: 'POST' });
}

export async function fetchAllExecutions(params?: {
  status?: string;
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<import('@fleex/shared').ExecutionLogResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  if (params?.q) qs.set('q', params.q);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return request<import('@fleex/shared').ExecutionLogResponse>(`/executions${query ? `?${query}` : ''}`);
}

// ── Domain Event Log (Audit Trail) ──

export async function fetchEvents(params: {
  limit?: number;
  before?: string;
  eventType?: string;
  instanceId?: string;
  since?: string;
} = {}): Promise<DomainEventLog[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.before) qs.set('before', params.before);
  if (params.eventType) qs.set('eventType', params.eventType);
  if (params.instanceId) qs.set('instanceId', params.instanceId);
  if (params.since) qs.set('since', params.since);
  const query = qs.toString();
  return request<DomainEventLog[]>(`/events${query ? `?${query}` : ''}`);
}

export async function fetchEventStats(): Promise<{ totalEvents: number }> {
  return request<{ totalEvents: number }>('/events/stats');
}

// ── Statistics ──

// ── Dashboard ──

export async function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/dashboard');
}

export async function fetchStatistics(params: {
  from?: string;
  to?: string;
  granularity?: 'day' | 'week' | 'month';
} = {}): Promise<StatisticsResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.granularity) qs.set('granularity', params.granularity);
  const query = qs.toString();
  return request<StatisticsResponse>(`/statistics${query ? `?${query}` : ''}`);
}

// ── File uploads ──

export interface UploadedFile {
  id: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/files`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = extractErrorMessage(body, res.statusText);
    throw new Error(message);
  }

  return res.json() as Promise<UploadedFile>;
}

// ── Ticket Groups (Epics) ──

export async function fetchTicketGroups(boardId?: string): Promise<TicketGroup[]> {
  const q = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  return request<TicketGroup[]>(`/epics${q}`);
}

export async function fetchTicketGroup(id: string): Promise<TicketGroup> {
  return request<TicketGroup>(`/epics/${encodeURIComponent(id)}`);
}

export async function createTicketGroup(req: CreateTicketGroupRequest): Promise<TicketGroup> {
  return request<TicketGroup>('/epics', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function updateTicketGroup(id: string, req: UpdateTicketGroupRequest): Promise<TicketGroup> {
  return request<TicketGroup>(`/epics/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
}

export async function deleteTicketGroup(id: string): Promise<void> {
  return request<void>(`/epics/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function archiveTicketGroup(id: string): Promise<TicketGroup> {
  return request<TicketGroup>(`/epics/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export async function unarchiveTicketGroup(id: string): Promise<TicketGroup> {
  return request<TicketGroup>(`/epics/${encodeURIComponent(id)}/unarchive`, { method: 'POST' });
}

export async function fetchTicketGroupTickets(groupId: string): Promise<Ticket[]> {
  return request<Ticket[]>(`/epics/${encodeURIComponent(groupId)}/tickets`);
}

export async function addTicketToGroup(groupId: string, ticketId: string): Promise<void> {
  await request(`/epics/${encodeURIComponent(groupId)}/tickets/${encodeURIComponent(ticketId)}`, { method: 'POST' });
}

export async function removeTicketFromGroup(groupId: string, ticketId: string): Promise<void> {
  await request(`/epics/${encodeURIComponent(groupId)}/tickets/${encodeURIComponent(ticketId)}`, { method: 'DELETE' });
}

export async function addBoardToTicketGroup(groupId: string, boardId: string): Promise<void> {
  await request(`/epics/${encodeURIComponent(groupId)}/boards/${encodeURIComponent(boardId)}`, { method: 'POST' });
}

export async function removeBoardFromTicketGroup(groupId: string, boardId: string): Promise<void> {
  await request(`/epics/${encodeURIComponent(groupId)}/boards/${encodeURIComponent(boardId)}`, { method: 'DELETE' });
}

export async function fetchTicketGroups4Ticket(ticketId: string): Promise<TicketGroup[]> {
  return request<TicketGroup[]>(`/tickets/${encodeURIComponent(ticketId)}/epics`);
}

// ── Ticket Relationships ──

export async function fetchTicketChildren(ticketId: string): Promise<Ticket[]> {
  return request<Ticket[]>(`/tickets/${encodeURIComponent(ticketId)}/children`);
}

export async function fetchTicketParents(ticketId: string): Promise<Ticket[]> {
  return request<Ticket[]>(`/tickets/${encodeURIComponent(ticketId)}/parents`);
}

export async function addTicketChild(parentId: string, childId: string): Promise<void> {
  await request(`/tickets/${encodeURIComponent(parentId)}/children/${encodeURIComponent(childId)}`, { method: 'POST' });
}

export async function removeTicketChild(parentId: string, childId: string): Promise<void> {
  await request(`/tickets/${encodeURIComponent(parentId)}/children/${encodeURIComponent(childId)}`, { method: 'DELETE' });
}

// ── Workflow Templates ──

export async function fetchWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return request<WorkflowTemplate[]>('/workflows/templates');
}

export async function createWorkflowTemplate(
  input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<WorkflowTemplate> {
  return request<WorkflowTemplate>('/workflows/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWorkflowTemplate(
  id: string,
  input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<WorkflowTemplate> {
  return request<WorkflowTemplate>(`/workflows/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkflowTemplate(id: string): Promise<void> {
  return request<void>(`/workflows/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Workflow Runs ──

export async function fetchWorkflowRuns(ticketId: string): Promise<WorkflowRun[]> {
  return request<WorkflowRun[]>(`/workflows/runs?ticketId=${encodeURIComponent(ticketId)}`);
}

export async function fetchWorkflowRunDetail(runId: string): Promise<{ run: WorkflowRun; stepRuns: StepRun[] }> {
  return request<{ run: WorkflowRun; stepRuns: StepRun[] }>(`/workflows/runs/${encodeURIComponent(runId)}`);
}

export async function startWorkflowRun(body: {
  ticketId: string;
  templateId: string;
  triggeredFrom?: string;
}): Promise<WorkflowRun> {
  return request<WorkflowRun>('/workflows/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  await request<void>(`/workflows/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
}

export async function resolveWorkflowGate(
  runId: string,
  stepRunId: string,
  body: { outcome: string; notes?: string },
): Promise<void> {
  await request<void>(
    `/workflows/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepRunId)}/resolve`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function retryWorkflowStep(runId: string, stepRunId: string): Promise<void> {
  await request<void>(
    `/workflows/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepRunId)}/retry`,
    { method: 'POST' },
  );
}
