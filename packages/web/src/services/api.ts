import type {
  Session,
  SessionGroup,
  CreateSessionRequest,
  Repository,
  Worktree,
  PullRequest,
  GitHubIssue,
  GitHubIssueDetail,
  DiffStats,
  RepositorySummary,
  RepositoryDashboardData,
  RepoDiscovery,
  RepositoryStats,
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
  OverlaySyncScanRequest,
  OverlaySyncScanResponse,
  OverlaySyncPreviewRequest,
  OverlaySyncPreviewResponse,
  OverlaySyncApplyItem,
  OverlaySyncApplyRequest,
  OverlaySyncApplyResponse,
  OverlaySyncRemoveRequest,
  OverlaySyncRemoveResponse,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
  RoutineTrigger,
  TicketDeliverable,
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

/** Returns the config as persisted by the server, with repository patterns already resolved. */
export async function updateConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/config', {
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

export async function fetchGithubDiscovery(): Promise<RepoDiscovery> {
  return request('/github/discovery');
}

export async function verifyGithubRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }> {
  return request(`/github/verify-repo?repo=${encodeURIComponent(repo)}`);
}

export async function fetchRepositoryStats(org: string, name: string, days = 30): Promise<RepositoryStats> {
  return request(`/repositories/${org}/${name}/stats?days=${days}`);
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

/**
 * One document by id.
 *
 * For surfaces that hold a reference rather than a list — a memory source, say,
 * where the document may have been produced outside any ticket and so has no
 * ticket to open instead.
 */
export async function fetchDeliverable(id: string): Promise<TicketDeliverable> {
  return request<TicketDeliverable>(`/deliverables/${encodeURIComponent(id)}`);
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

// These two send the FULL ticket list (cockpit/kanban/dashboard track every
// ticket, deliberately). In the query string that overflowed Node's
// maxHeaderSize at ~425 tickets → 431 before any handler ran (#509). POST puts
// the IDs in the body, so there is no ceiling. Unconditional on purpose: a
// size-based GET/POST branch would be a rarely-taken, untested path.

export async function fetchUnreadCounts(ticketIds?: string[]): Promise<import('@fleex/shared').TicketUnreadCounts[]> {
  return request<import('@fleex/shared').TicketUnreadCounts[]>('/tickets/unread-counts', {
    method: 'POST',
    body: JSON.stringify({ ticketIds: ticketIds ?? [] }),
  });
}

export async function fetchTicketAgentActivity(ticketIds: string[]): Promise<import('@fleex/shared').TicketAgentActivity[]> {
  if (!ticketIds.length) return [];
  return request<import('@fleex/shared').TicketAgentActivity[]>('/tickets/agent-activity', {
    method: 'POST',
    body: JSON.stringify({ ticketIds }),
  });
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
  scope?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<import('@fleex/shared').ExecutionLogResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  if (params?.scope) qs.set('scope', params.scope);
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
  tzOffsetMinutes?: number;
} = {}): Promise<StatisticsResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.granularity) qs.set('granularity', params.granularity);
  if (params.tzOffsetMinutes != null) qs.set('tz', String(params.tzOffsetMinutes));
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

export async function resolveWorkflowRoute(
  runId: string,
  stepRunId: string,
  body: { edgeId: string; notes?: string },
): Promise<void> {
  await request<void>(
    `/workflows/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepRunId)}/route`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function retryWorkflowStep(
  runId: string,
  stepRunId: string,
  /**
   * Answer to the question the step asked before pausing. Recorded server-side
   * on the paused attempt so the retried step actually reads it — on a routine
   * run there is no ticket comment to carry it.
   */
  humanResponse?: string,
): Promise<void> {
  await request<void>(
    `/workflows/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepRunId)}/retry`,
    { method: 'POST', body: JSON.stringify(humanResponse ? { humanResponse } : {}) },
  );
}

// ── Overlay sync ────────────────────────────────────────────────────────────

export async function overlaySyncScan(
  rootPath: string,
): Promise<OverlaySyncScanResponse> {
  return request<OverlaySyncScanResponse>('/overlay-sync/scan', {
    method: 'POST',
    body: JSON.stringify({ rootPath } satisfies OverlaySyncScanRequest),
  });
}

export async function overlaySyncPreview(
  req: OverlaySyncPreviewRequest,
): Promise<OverlaySyncPreviewResponse> {
  return request<OverlaySyncPreviewResponse>('/overlay-sync/preview', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function overlaySyncApply(
  items: OverlaySyncApplyItem[],
): Promise<OverlaySyncApplyResponse> {
  return request<OverlaySyncApplyResponse>('/overlay-sync/apply', {
    method: 'POST',
    body: JSON.stringify({ items } satisfies OverlaySyncApplyRequest),
  });
}

export async function overlaySyncRemove(
  req: OverlaySyncRemoveRequest,
): Promise<OverlaySyncRemoveResponse> {
  return request<OverlaySyncRemoveResponse>('/overlay-sync/remove', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Routines ──────────────────────────────────────────────────────────────
// A routine's run history ships its step runs and deliverables inline: the
// detail screen mounts the existing WorkflowRunView per run, and a routine run
// has no ticket to fetch deliverables from.

export interface RoutineRunDetail {
  run: WorkflowRun;
  stepRuns: StepRun[];
  deliverables: TicketDeliverable[];
}

/**
 * List item = the routine plus its active run's status, so the list and the nav
 * badge can show "waiting for you" without a second round-trip per routine.
 */
export interface RoutineListItem extends Routine {
  activeRunId: string | null;
  activeRunStatus: string | null;
  awaitingAttention: boolean;
}

export async function fetchRoutines(): Promise<RoutineListItem[]> {
  return request<RoutineListItem[]>('/routines');
}

export async function fetchRoutine(idOrSlug: string): Promise<Routine> {
  return request<Routine>(`/routines/${encodeURIComponent(idOrSlug)}`);
}

export async function createRoutine(input: CreateRoutineInput): Promise<Routine> {
  return request<Routine>('/routines', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateRoutine(id: string, changes: UpdateRoutineInput): Promise<Routine> {
  return request<Routine>(`/routines/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  });
}

export async function deleteRoutine(id: string): Promise<void> {
  await request<void>(`/routines/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function launchRoutine(id: string): Promise<WorkflowRun> {
  return request<WorkflowRun>(`/routines/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export async function fetchRoutineRuns(id: string): Promise<RoutineRunDetail[]> {
  return request<RoutineRunDetail[]>(`/routines/${encodeURIComponent(id)}/runs`);
}

/**
 * "When would this actually fire?" for the trigger editor.
 *
 * Computed server-side on purpose: the scheduler's own cron/timezone code
 * answers, so the preview can never drift from what will really happen — which
 * a second, client-side cron implementation eventually would.
 */
export async function previewRoutineTrigger(trigger: RoutineTrigger, count = 5): Promise<string[]> {
  const res = await request<{ nextRuns: string[] }>('/routines/trigger-preview', {
    method: 'POST', body: JSON.stringify({ trigger, count }),
  });
  return res.nextRuns;
}

// ── Memory kernel ──

export interface MemoryStatus {
  engine: 'legacy' | 'semantic';
  /** False when this storage driver has no memory index implementation. */
  available: boolean;
  reason?: string;
  provider: {
    id: string;
    dimensions: number;
    /** Model loaded and usable now. */
    ready: boolean;
    /** Optional embedding package present. False means an install is needed. */
    installed: boolean;
    packageName: string;
    /** Where the arithmetic runs. */
    runtime: 'transformers' | 'ollama';
    /** Configured catalogue model id. */
    model: string;
  } | null;
  index: {
    totalChunks: number;
    pendingEmbeddings: number;
    /** Vectors from a superseded encoder, waiting for the sweep to redo them. */
    staleModelChunks: number;
    chunksByKind: Record<string, number>;
    embeddingModels: string[];
    lastIndexedAt: string | null;
  } | null;
  /** Configured injection budget, or null for the engine default. */
  injectionCharBudget: number | null;
  /** True while a backfill is walking the corpus. */
  reindexing: boolean;
}

/** One retrieved excerpt, as /api/memory/search returns it. */
export interface MemorySnippetResult {
  sourceKind: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
  ticketId?: string | null;
  repo?: string | null;
  updatedAt?: string | null;
}

export async function fetchMemorySearch(query: string, limit = 10): Promise<MemorySnippetResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await request<{ query: string; results: MemorySnippetResult[] }>(`/memory/search?${params.toString()}`);
  return res.results;
}

/** How well retrieval finds things on this corpus. */
export interface MemoryBenchResult {
  model: string;
  dimensions: number;
  report: { cases: number; recallAtK: number; k: number; mrr: number; misses: Array<{ query: string }> };
  meanQueryMs: number;
  indexedChunks: number;
  reason?: 'unavailable' | 'empty_index' | 'no_cases';
}

export async function benchMemory(cases?: number): Promise<MemoryBenchResult> {
  const params = cases ? `?cases=${cases}` : '';
  return request<MemoryBenchResult>(`/memory/bench${params}`);
}

/** A cited answer drawn from the index. */
export interface MemoryAnswer {
  answer: string | null;
  sources: MemorySnippetResult[];
  reason?: 'no_results' | 'synthesis_failed' | 'unavailable';
}

/**
 * How long to wait for a cited answer.
 *
 * Answering means one embedding, one search and one model call, which measures
 * around fifteen seconds warm. Cold — with the encoder still loading — it is far
 * longer, and with no ceiling at all the browser eventually gave up on its own
 * and reported a bare network failure for what was really a slow success. Three
 * minutes is well past the worst observed, and the abort is reported as what it
 * is.
 */
const ASK_TIMEOUT_MS = 180_000;

export async function askMemory(question: string, limit?: number): Promise<MemoryAnswer> {
  try {
    return await request<MemoryAnswer>('/memory/ask', {
      method: 'POST',
      body: JSON.stringify(limit ? { question, limit } : { question }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        `Answering took longer than ${ASK_TIMEOUT_MS / 1000}s. The encoder may still be loading — try again in a moment.`,
      );
    }
    throw error;
  }
}

/** An existing ticket that looks like the one being typed. */
export interface SimilarTicketCandidate {
  ticketId: string;
  title: string;
  score: number;
  excerpt: string;
}

export async function fetchSimilarTickets(title: string, limit = 3): Promise<SimilarTicketCandidate[]> {
  const params = new URLSearchParams({ title, limit: String(limit) });
  const res = await request<{ candidates: SimilarTicketCandidate[] }>(`/memory/similar-tickets?${params.toString()}`);
  return res.candidates;
}

/** A drafted amendment to an agent's memory, awaiting review. */
export interface PersonaCoachProposal {
  personaId: string;
  personaName: string;
  currentMemoryMd: string;
  proposedMemoryMd: string | null;
  evidence: MemorySnippetResult[];
  reason?: string;
}

export async function fetchPersonaCoachProposal(personaId: string): Promise<PersonaCoachProposal> {
  return request<PersonaCoachProposal>(`/memory/personas/${encodeURIComponent(personaId)}/coach`);
}

export async function applyPersonaCoachProposal(personaId: string, memoryMd: string): Promise<void> {
  await request<{ ok: boolean }>(`/memory/personas/${encodeURIComponent(personaId)}/coach/apply`, {
    method: 'POST', body: JSON.stringify({ memoryMd }),
  });
}

/** A compiled reference document about a subject. */
export interface SynthesisResult {
  subject: string;
  document: string | null;
  sources: MemorySnippetResult[];
  deliverableId?: string;
  reason?: string;
}

export async function synthesiseMemory(
  subject: string,
  opts: { limit?: number; repo?: string | null; saveToTicketId?: string | null } = {},
): Promise<SynthesisResult> {
  return request<SynthesisResult>('/memory/synthesise', {
    method: 'POST',
    body: JSON.stringify({ subject, ...opts }),
  });
}

export async function curateMemory(input: {
  executionId: string;
  title?: string;
  content?: string;
  comment?: string | null;
  ticketId?: string | null;
  repo?: string | null;
}): Promise<{ ok: boolean; noteId?: string; reason?: string }> {
  return request<{ ok: boolean; noteId?: string; reason?: string }>('/memory/curate', {
    method: 'POST', body: JSON.stringify(input),
  });
}

/** Drop a kept note again. A wrong note outranks ordinary output, so it has to be undoable. */
export async function forgetCuratedMemory(noteId: string): Promise<void> {
  await request<{ ok: boolean }>(`/memory/curated/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
  });
}

/** Work repeated often enough that a routine could do it. */
export interface AutomationCandidate {
  key: string;
  kind: 'skill' | 'agent';
  target: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  meanGapHours: number;
  suggestedCron?: string;
  rationale: string;
  totalCostUsd: number;
}

export async function fetchAutomationCandidates(): Promise<AutomationCandidate[]> {
  const res = await request<{ candidates: AutomationCandidate[] }>('/memory/automation-candidates');
  return res.candidates;
}

/** Notes linking to a target, and notes semantically close to one. */
export interface NoteLinks {
  backlinks: Array<{ key: string; label: string }>;
  related: Array<{ key: string; label: string; score: number }>;
}

export async function fetchNoteLinks(key: string, target?: string): Promise<NoteLinks> {
  const params = new URLSearchParams({ key });
  if (target) params.set('target', target);
  return request<NoteLinks>(`/scratchpads/links?${params.toString()}`);
}

export async function fetchMemoryStatus(): Promise<MemoryStatus> {
  return request<MemoryStatus>('/memory/status');
}

/**
 * Kick off a full reindex. Returns as soon as the walk has started — it outlives
 * any request timeout, so progress is read from `fetchMemoryStatus` instead.
 */
export async function reindexMemory(): Promise<void> {
  await request<{ started: boolean }>('/memory/reindex', { method: 'POST' });
}
