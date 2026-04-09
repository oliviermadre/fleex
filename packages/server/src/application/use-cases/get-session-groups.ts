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

export class GetSessionGroupsUseCase {
  private readonly listSessions: ListSessionsUseCase;

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

  async execute(): Promise<SessionGroup[]> {
    // Single tmux call to get both managed sessions and pane commands
    let paneCommands: Map<string, string>;
    let paneCwds: Map<string, string>;
    let sessions: SessionEntity[];
    try {
      const combined = await this.tmux.listManagedSessionsWithPaneCommands();
      // Discover any new fleex_* sessions not yet in store (reuses pre-fetched list, no extra tmux call)
      await this.discoverSessions?.execute(combined.sessions);
      sessions = await this.listSessions.execute(combined.sessions);
      paneCommands = combined.paneCommands;
      paneCwds = combined.paneCwds;
    } catch (err) {
      this.logger.debug('Failed combined tmux call, falling back', { error: String(err) });
      sessions = await this.listSessions.execute();
      paneCommands = new Map();
      paneCwds = new Map();
    }

    // Enrich foreground process and pane CWD from tmux
    for (const session of sessions) {
      const command = paneCommands.get(session.tmuxName);
      if (command) {
        session.foregroundProcess = command;
      }
      const cwd = paneCwds.get(session.tmuxName);
      if (cwd) {
        session.paneCwd = cwd;
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

    const groups = await this.groupingService.groupSessions(sessions);

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
   * Find tickets with a worktree link that have an active agent assignment
   * (doing/reviewing + assignee) or past agent work (agentClaimedAt set),
   * then attach AgentWorktreeInfo to matching WorktreeSessionGroups.
   * If no matching group exists (agent worktree has 0 tmux sessions), create one.
   */
  private async injectAgentWorktreeInfo(groups: SessionGroup[]): Promise<void> {
    if (!this.ticketStore || !this.personaStore) return;

    // Build a map of ticketId → latest execution in a single query
    const ticketLatestExec = new Map<string, { id: string; status: string; personaId: string }>();
    if (this.agentEventStore) {
      try {
        const allExecs = await this.agentEventStore.getAllExecutions();
        for (const exec of allExecs) {
          // getAllExecutions returns newest first; keep only the first (latest) per ticket
          if (!ticketLatestExec.has(exec.ticketId)) {
            ticketLatestExec.set(exec.ticketId, exec);
          }
        }
      } catch {
        // ignore event store errors
      }
    }

    const allTickets = await this.ticketStore.getAllTickets();
    const agentTickets = allTickets.filter(
      (t) =>
        t.status !== 'done' && t.status !== 'cancelled' &&
        ticketLatestExec.has(t.id),
    );

    if (agentTickets.length === 0) return;

    // Build persona lookups
    const personas = await this.personaStore.getAll();
    const personaByName = new Map(personas.map((p) => [p.name, p]));
    const personaById = new Map(personas.map((p) => [p.id, p]));

    for (const ticket of agentTickets) {
      const wtLink = ticket.links.find((l) => l.type === 'worktree');

      // Get execution info from pre-fetched map
      const latestExecution = ticketLatestExec.get(ticket.id)!;
      const latestExecutionId = latestExecution.id;
      const executionStatus: AgentWorktreeInfo['executionStatus'] =
        latestExecution.status === 'running' ? 'running'
        : latestExecution.status === 'completed' ? 'completed'
        : latestExecution.status === 'failed' ? 'failed'
        : 'idle';

      // Resolve persona: from current assignee, or from latest execution's personaId
      const persona = (ticket.assignee ? personaByName.get(ticket.assignee) : undefined)
        ?? personaById.get(latestExecution.personaId);
      if (!persona) continue;

      const branch = wtLink?.label ?? ticket.title;

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

      // Find matching worktree group by branch label OR by ticket title
      // (the grouping service uses ticket title as the branch label for manifest-resolved sessions)
      let found = false;

      for (const group of groups) {
        for (const wt of group.worktrees) {
          if (wt.branch === branch || wt.branch === ticket.title) {
            // Attach agent info to existing group (cast to mutable)
            (wt as { agentWorktree?: AgentWorktreeInfo }).agentWorktree = agentInfo;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      // If no matching group found, create a phantom group
      if (!found) {
        // Determine which repo group this belongs to
        let org: string | undefined;
        let name: string | undefined;

        // Try repository link first
        const repoLink = ticket.links.find((l) => l.type === 'repository');
        if (repoLink) {
          [org, name] = repoLink.ref.split('/');
        }

        // Fallback: parse repo from worktree link ref (format: "org/repo:branch")
        if ((!org || !name) && wtLink) {
          const colonIdx = wtLink.ref.indexOf(':');
          if (colonIdx > 0) {
            [org, name] = wtLink.ref.substring(0, colonIdx).split('/');
          }
        }

        // If repo info found, check it's a watched repo
        if (org && name) {
          const resolved = this.config?.get().resolvedRepositories ?? [];
          if (!resolved.includes(`${org}/${name}`)) continue;
        } else {
          // No repo info — use multi-repo fallback
          org = '_multi-repo';
          name = '_multi-repo';
        }

        let repoGroup = groups.find(
          (g) => g.repositoryOrg === org && g.repositoryName === name,
        );
        if (!repoGroup) {
          repoGroup = { repositoryOrg: org, repositoryName: name, worktrees: [] };
          groups.push(repoGroup);
        }
        const newWt: WorktreeSessionGroup = {
          branch,
          path: wtLink?.url ?? wtLink?.ref ?? '',
          sessions: [],
          agentWorktree: agentInfo,
          ticketId: ticket.id,
        };
        (repoGroup.worktrees as WorktreeSessionGroup[]).push(newWt);
      }
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
