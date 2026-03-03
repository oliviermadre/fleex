import type { SessionGroup, WorktreeSessionGroup, AgentWorktreeInfo } from '@asm/shared';
import type { SessionEntity } from '../../domain/entities.js';
import { SessionGroupingService } from '../../domain/services/session-grouping.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { ListSessionsUseCase } from './list-sessions.js';
import type { EnrichClaudeActivityUseCase } from './enrich-claude-activity.js';
import type { DiscoverExistingSessionsUseCase } from './discover-existing-sessions.js';

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
  ) {
    this.listSessions = new ListSessionsUseCase(sessionStore, tmux, logger);
  }

  async execute(): Promise<SessionGroup[]> {
    // Single tmux call to get both managed sessions and pane commands
    let paneCommands: Map<string, string>;
    let sessions: SessionEntity[];
    try {
      const combined = await this.tmux.listManagedSessionsWithPaneCommands();
      // Discover any new asm_* sessions not yet in store (reuses pre-fetched list, no extra tmux call)
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

    return groups;
  }

  /**
   * Find tickets in "doing" or "reviewing" status with an agent assignee
   * and a worktree link, then attach AgentWorktreeInfo to matching
   * WorktreeSessionGroups. If no matching group exists (agent worktree
   * has 0 tmux sessions), create one.
   */
  private async injectAgentWorktreeInfo(groups: SessionGroup[]): Promise<void> {
    if (!this.ticketStore || !this.personaStore) return;

    const allTickets = await this.ticketStore.getAllTickets();
    const agentTickets = allTickets.filter(
      (t) =>
        (t.status === 'doing' || t.status === 'reviewing') &&
        t.assignee &&
        t.links.some((l) => l.type === 'worktree'),
    );

    if (agentTickets.length === 0) return;

    // Build persona lookup
    const personas = await this.personaStore.getAll();
    const personaByName = new Map(personas.map((p) => [p.name, p]));

    for (const ticket of agentTickets) {
      const wtLink = ticket.links.find((l) => l.type === 'worktree');
      if (!wtLink) continue;

      const persona = personaByName.get(ticket.assignee!);
      if (!persona) continue;

      // Determine execution status
      let executionStatus: AgentWorktreeInfo['executionStatus'] = 'idle';
      let latestExecutionId: string | null = null;
      if (this.agentEventStore) {
        try {
          const executions = await this.agentEventStore.getExecutionsByTicket(ticket.id);
          if (executions.length > 0) {
            const latest = executions[0]!;
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

      // Find matching worktree group by branch label
      const branch = wtLink.label;
      let found = false;

      for (const group of groups) {
        for (const wt of group.worktrees) {
          if (wt.branch === branch) {
            // Attach agent info to existing group (cast to mutable)
            (wt as { agentWorktree?: AgentWorktreeInfo }).agentWorktree = agentInfo;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      // If no matching group found, create a new one
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
        if (!org || !name) {
          const colonIdx = wtLink.ref.indexOf(':');
          if (colonIdx > 0) {
            [org, name] = wtLink.ref.substring(0, colonIdx).split('/');
          }
        }

        if (org && name) {
          let repoGroup = groups.find(
            (g) => g.repositoryOrg === org && g.repositoryName === name,
          );
          if (!repoGroup) {
            repoGroup = { repositoryOrg: org, repositoryName: name, worktrees: [] };
            groups.push(repoGroup);
          }
          const newWt: WorktreeSessionGroup = {
            branch,
            path: wtLink.url ?? wtLink.ref,
            sessions: [],
            agentWorktree: agentInfo,
          };
          (repoGroup.worktrees as WorktreeSessionGroup[]).push(newWt);
        }
      }
    }
  }
}
