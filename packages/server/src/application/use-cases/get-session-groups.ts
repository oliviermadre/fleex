import type { SessionGroup, WorktreeSessionGroup, AgentWorktreeInfo } from '@fleex/shared';
import type { SessionEntity } from '../../domain/entities.js';
import { SessionGroupingService } from '../../domain/services/session-grouping.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { HostFs } from '../../infrastructure/host/types.js';
import type { ConfigPort } from '../ports/config.port.js';
import { ListSessionsUseCase } from './list-sessions.js';
import type { EnrichClaudeActivityUseCase } from './enrich-claude-activity.js';
import type { DiscoverExistingSessionsUseCase } from './discover-existing-sessions.js';
import type { ReconcileWorktreeUseCase } from './reconcile-worktree.js';
import type { EventBus } from '../event-bus.js';

/** Cached result of the expensive agent worktree data (tickets + personas + executions). */
interface AgentWorktreeCache {
  agentInfoByBranch: Map<string, AgentWorktreeInfo>;
  phantomGroups: Array<{ org: string; name: string; branch: string; path: string; agentInfo: AgentWorktreeInfo }>;
  resolvedRepos: string[];
}

export class GetSessionGroupsUseCase {
  private readonly listSessions: ListSessionsUseCase;

  /** Cached agent worktree data — invalidated by domain events. */
  private agentWorktreeCache: AgentWorktreeCache | null = null;
  private agentWorktreeDirty = true;

  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly groupingService: SessionGroupingService,
    private readonly logger: LoggerPort,
    private readonly enrichClaudeActivity?: EnrichClaudeActivityUseCase,
    private readonly discoverSessions?: DiscoverExistingSessionsUseCase,
    private readonly ticketStore?: TicketStorePort,
    private readonly personaStore?: PersonaStorePort,
    private readonly agentEventStore?: AgentEventStorePort,
    private readonly reconcileWorktree?: ReconcileWorktreeUseCase,
    private readonly hostFs?: HostFs,
    private readonly config?: ConfigPort,
  ) {
    this.listSessions = new ListSessionsUseCase(sessionStore, tmux, logger);
  }

  /**
   * Subscribe to domain events that should invalidate the agent worktree cache.
   * Call this once after the event bus is available.
   */
  subscribeToEvents(eventBus: EventBus): void {
    const invalidate = () => { this.agentWorktreeDirty = true; };

    // Ticket changes affect agent worktree info
    eventBus.on('ticket.created', invalidate);
    eventBus.on('ticket.updated', invalidate);
    eventBus.on('ticket.moved', invalidate);
    eventBus.on('ticket.deleted', invalidate);

    // Persona changes affect name/displayName lookups
    eventBus.on('persona.created', invalidate);
    eventBus.on('persona.updated', invalidate);
    eventBus.on('persona.deleted', invalidate);

    // Execution start/completion changes execution status
    eventBus.on('persona.execution_started', invalidate);
  }

  async execute(): Promise<SessionGroup[]> {
    // Single tmux call to get both managed sessions and pane commands
    let paneCommands: Map<string, string>;
    let sessions: SessionEntity[];
    try {
      const combined = await this.tmux.listManagedSessionsWithPaneCommands();
      // Discover any new fleex_* sessions not yet in store (reuses pre-fetched list, no extra tmux call)
      await this.discoverSessions?.execute(combined.sessions);
      sessions = await this.listSessions.execute(combined.sessions);
      paneCommands = combined.paneCommands;
    } catch (err) {
      this.logger.debug('Failed combined tmux call, falling back', { error: String(err) });
      sessions = await this.listSessions.execute();
      paneCommands = new Map();
    }

    // Enrich foreground process from pane commands
    for (const session of sessions) {
      const command = paneCommands.get(session.tmuxName);
      if (command) {
        session.foregroundProcess = command;
      }
    }

    if (this.enrichClaudeActivity) {
      try {
        const activityMap = await this.enrichClaudeActivity.execute(sessions);
        for (const session of sessions) {
          const activity = activityMap.get(session.id);
          if (activity) {
            session.claudeActivity = activity;
          }
        }
      } catch (err) {
        this.logger.debug('Failed to enrich claude activity', { error: String(err) });
      }
    }

    const groups = this.groupingService.groupSessions(sessions);

    // Inject agent worktree info for tickets with worktree links and agent assignees
    if (this.ticketStore && this.personaStore) {
      await this.injectAgentWorktreeInfo(groups);
    }

    // Reconcile worktree paths for multi-machine support
    if (this.reconcileWorktree && this.hostFs) {
      await this.reconcileWorktreePaths(groups);
    }

    return groups;
  }

  /**
   * Refresh the agent worktree cache by querying tickets, personas, and executions.
   * Only called when the cache is dirty (invalidated by domain events).
   */
  private async refreshAgentWorktreeCache(): Promise<AgentWorktreeCache> {
    const ticketStore = this.ticketStore!;
    const personaStore = this.personaStore!;

    const [allTickets, personas] = await Promise.all([
      ticketStore.getAllTickets(),
      personaStore.getAll(),
    ]);

    const agentTickets = allTickets.filter(
      (t) =>
        t.status !== 'done' && t.status !== 'cancelled' &&
        t.links.some((l) => l.type === 'worktree') &&
        (
          ((t.status === 'doing' || t.status === 'reviewing') && t.assignee) ||
          t.agentClaimedAt !== null
        ),
    );

    const personaByName = new Map(personas.map((p) => [p.name, p]));
    const personaById = new Map(personas.map((p) => [p.id, p]));

    const agentInfoByBranch = new Map<string, AgentWorktreeInfo>();
    const phantomGroups: AgentWorktreeCache['phantomGroups'] = [];
    const resolved = this.config?.get().resolvedRepositories ?? [];

    for (const ticket of agentTickets) {
      const wtLink = ticket.links.find((l) => l.type === 'worktree');
      if (!wtLink) continue;

      let executionStatus: AgentWorktreeInfo['executionStatus'] = 'idle';
      let latestExecutionId: string | null = null;
      let latestExecution: { id: string; status: string; personaId: string } | null = null;
      if (this.agentEventStore) {
        try {
          const executions = await this.agentEventStore.getExecutionsByTicket(ticket.id);
          if (executions.length > 0) {
            const latest = executions[0]!;
            latestExecution = latest;
            latestExecutionId = latest.id;
            executionStatus = latest.status === 'running' ? 'running'
              : latest.status === 'completed' ? 'completed'
              : latest.status === 'failed' ? 'failed'
              : 'idle';
          }
        } catch {
          // ignore event store errors
        }
      }

      const isActiveAgent = (ticket.status === 'doing' || ticket.status === 'reviewing') && !!ticket.assignee;
      if (!isActiveAgent && !latestExecution) continue;

      const persona = (ticket.assignee ? personaByName.get(ticket.assignee) : undefined)
        ?? (latestExecution ? personaById.get(latestExecution.personaId) : undefined);
      if (!persona) continue;

      const agentInfo: AgentWorktreeInfo = {
        ticketId: ticket.id,
        ticketDisplayId: ticket.displayId,
        ticketTitle: ticket.title,
        agentPersonaId: persona.id,
        agentName: persona.name,
        agentDisplayName: persona.displayName,
        executionStatus,
        latestExecutionId,
      };

      const branch = wtLink.label;
      agentInfoByBranch.set(branch, agentInfo);

      // Prepare phantom group data for active agents
      if (isActiveAgent) {
        let org: string | undefined;
        let name: string | undefined;

        const repoLink = ticket.links.find((l) => l.type === 'repository');
        if (repoLink) {
          [org, name] = repoLink.ref.split('/');
        }

        if (!org || !name) {
          const colonIdx = wtLink.ref.indexOf(':');
          if (colonIdx > 0) {
            [org, name] = wtLink.ref.substring(0, colonIdx).split('/');
          }
        }

        if (org && name && resolved.includes(`${org}/${name}`)) {
          phantomGroups.push({
            org,
            name,
            branch,
            path: wtLink.url ?? wtLink.ref,
            agentInfo,
          });
        }
      }
    }

    return { agentInfoByBranch, phantomGroups, resolvedRepos: resolved };
  }

  /**
   * Inject cached agent worktree info into session groups.
   * Only re-queries Supabase when the cache has been invalidated by domain events.
   */
  private async injectAgentWorktreeInfo(groups: SessionGroup[]): Promise<void> {
    if (!this.ticketStore || !this.personaStore) return;

    // Refresh cache only if dirty
    if (this.agentWorktreeDirty || !this.agentWorktreeCache) {
      this.agentWorktreeCache = await this.refreshAgentWorktreeCache();
      this.agentWorktreeDirty = false;
    }

    const cache = this.agentWorktreeCache;
    if (cache.agentInfoByBranch.size === 0) return;

    // Attach agent info to matching worktree groups by branch
    const matchedBranches = new Set<string>();
    for (const group of groups) {
      for (const wt of group.worktrees) {
        const agentInfo = cache.agentInfoByBranch.get(wt.branch);
        if (agentInfo) {
          (wt as { agentWorktree?: AgentWorktreeInfo }).agentWorktree = agentInfo;
          matchedBranches.add(wt.branch);
        }
      }
    }

    // Create phantom groups for unmatched active agents
    for (const phantom of cache.phantomGroups) {
      if (matchedBranches.has(phantom.branch)) continue;

      let repoGroup = groups.find(
        (g) => g.repositoryOrg === phantom.org && g.repositoryName === phantom.name,
      );
      if (!repoGroup) {
        repoGroup = { repositoryOrg: phantom.org, repositoryName: phantom.name, worktrees: [] };
        groups.push(repoGroup);
      }
      const newWt: WorktreeSessionGroup = {
        branch: phantom.branch,
        path: phantom.path,
        sessions: [],
        agentWorktree: phantom.agentInfo,
      };
      (repoGroup.worktrees as WorktreeSessionGroup[]).push(newWt);
    }
  }

  /**
   * For each agent worktree group, check if the path exists locally.
   * If not, attempt to recreate it via ReconcileWorktreeUseCase.
   */
  private async reconcileWorktreePaths(groups: SessionGroup[]): Promise<void> {
    if (!this.reconcileWorktree || !this.hostFs) return;

    type WorktreeRef = {
      group: SessionGroup;
      wt: WorktreeSessionGroup;
      org: string;
      name: string;
    };

    const toReconcile: WorktreeRef[] = [];

    for (const group of groups) {
      for (const wt of group.worktrees) {
        if (!wt.agentWorktree) {
          // Not an agent worktree — mark as ready if path exists
          continue;
        }
        toReconcile.push({
          group,
          wt,
          org: group.repositoryOrg,
          name: group.repositoryName,
        });
      }
    }

    if (toReconcile.length === 0) return;

    const results = await Promise.allSettled(
      toReconcile.map(async (ref) => {
        // Quick check: does the path already exist?
        const pathExists = ref.wt.path
          ? await this.hostFs!.exists(ref.wt.path).catch(() => false)
          : false;

        if (pathExists) {
          (ref.wt as { worktreeStatus?: string }).worktreeStatus = 'ready';
          return;
        }

        // Path doesn't exist — reconcile
        const result = await this.reconcileWorktree!.execute(
          ref.org,
          ref.name,
          ref.wt.branch,
        );

        const mutableWt = ref.wt as {
          path: string;
          worktreeStatus?: string;
        };

        switch (result.status) {
          case 'exists':
          case 'created':
            mutableWt.path = result.path!;
            mutableWt.worktreeStatus = 'ready';
            break;
          case 'repo_missing':
            mutableWt.path = '';
            mutableWt.worktreeStatus = 'repo_missing';
            break;
          case 'failed':
            mutableWt.path = '';
            mutableWt.worktreeStatus = 'unavailable';
            break;
        }
      }),
    );

    // Log any unexpected errors
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.debug('Worktree reconciliation error', { error: String(r.reason) });
      }
    }
  }
}
