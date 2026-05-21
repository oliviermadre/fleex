import type { Session, SessionGroup, WorktreeSessionGroup, AgentWorktreeInfo } from '@fleex/shared';
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

    // Surface every ticket in doing/reviewing as a worktree group (creating phantoms when
    // no live session matches). Tickets in other statuses are intentionally not hydrated.
    if (this.ticketStore && this.personaStore) {
      await this.injectAgentWorktreeInfo(groups);
    }

    // Any worktree-with-sessions that didn't receive an agentWorktree corresponds to a tmux
    // session not tied to a doing/reviewing ticket — move it to System > Shells.
    this.reclassifyOrphanSessions(groups);

    // Reconcile worktree paths for multi-machine support
    if (this.reconcileWorktree && this.hostFs) {
      await this.reconcileWorktreePaths(groups);
    }

    return groups;
  }

  /**
   * Surface every ticket in `doing`/`reviewing` as a WorktreeSessionGroup carrying
   * AgentWorktreeInfo. Attaches to an existing group when one matches by branch/title,
   * otherwise creates a phantom group (sessions: []). Persona and execution data are
   * best-effort — a ticket without either still appears.
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
    const activeTickets = allTickets.filter(
      (t) => t.status === 'doing' || t.status === 'reviewing',
    );

    if (activeTickets.length === 0) return;

    // Build persona lookups (best-effort: ticket still surfaces without a resolved persona)
    const personas = await this.personaStore.getAll();
    const personaByName = new Map(personas.map((p) => [p.name, p]));
    const personaById = new Map(personas.map((p) => [p.id, p]));

    for (const ticket of activeTickets) {
      const wtLink = ticket.links.find((l) => l.type === 'worktree');

      // Execution info is optional — without it the ticket is reported as idle
      const latestExecution = ticketLatestExec.get(ticket.id);
      const latestExecutionId = latestExecution?.id ?? null;
      const executionStatus: AgentWorktreeInfo['executionStatus'] =
        latestExecution?.status === 'running' ? 'running'
        : latestExecution?.status === 'completed' ? 'completed'
        : latestExecution?.status === 'failed' ? 'failed'
        : 'idle';

      // Persona is best-effort: try assignee first, then latest execution's persona
      const persona = (ticket.assignee ? personaByName.get(ticket.assignee) : undefined)
        ?? (latestExecution ? personaById.get(latestExecution.personaId) : undefined);

      const branch = wtLink?.label ?? ticket.title;

      const agentInfo: AgentWorktreeInfo = {
        ticketId: ticket.id,
        ticketDisplayId: ticket.displayId,
        ticketTitle: ticket.title,
        agentPersonaId: persona?.id ?? '',
        agentName: persona?.name ?? '',
        agentDisplayName: persona?.displayName ?? '',
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
        // Determine which repo group this belongs to.
        // Three cases:
        //   - 0 repository links → _unassigned
        //   - 1 repository link  → that repo
        //   - 2+ repository links → _multi-repo
        let org: string | undefined;
        let name: string | undefined;

        const repoLinks = ticket.links.filter((l) => l.type === 'repository');

        if (repoLinks.length === 1) {
          [org, name] = repoLinks[0]!.ref.split('/');
        } else if (repoLinks.length === 0) {
          // Fallback: parse repo from worktree link ref (format: "org/repo:branch")
          if (wtLink) {
            const colonIdx = wtLink.ref.indexOf(':');
            if (colonIdx > 0) {
              [org, name] = wtLink.ref.substring(0, colonIdx).split('/');
            }
          }
        }

        if (repoLinks.length >= 2) {
          // True multi-repo ticket
          org = '_multi-repo';
          name = '_multi-repo';
        } else if (org && name) {
          // Single repo — check it's a watched repo
          const resolved = this.config?.get().resolvedRepositories ?? [];
          if (!resolved.includes(`${org}/${name}`)) continue;
        } else {
          // No repo info at all — ticket is unassigned to any repo
          org = '_unassigned';
          name = '_unassigned';
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
   * Move any tmux sessions whose worktree was not hydrated with AgentWorktreeInfo into
   * the System (_ungrouped) bucket. These are shells not tied to a doing/reviewing
   * ticket — they belong under "System > Shells", not in the repo's flow sections.
   * Repo groups that become empty are removed.
   */
  private reclassifyOrphanSessions(groups: SessionGroup[]): void {
    type MutableSessionGroup = {
      repositoryOrg: string;
      repositoryName: string;
      worktrees: WorktreeSessionGroup[];
    };

    let systemGroup = groups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped',
    ) as MutableSessionGroup | undefined;

    const orphans: Session[] = [];

    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i] as MutableSessionGroup;
      if (group.repositoryOrg === '_ungrouped' && group.repositoryName === '_ungrouped') continue;

      const kept: WorktreeSessionGroup[] = [];
      for (const wt of group.worktrees) {
        if (wt.agentWorktree) {
          kept.push(wt);
        } else if (wt.sessions.length > 0) {
          orphans.push(...wt.sessions);
        }
        // worktrees with no sessions and no agentWorktree are dropped silently
      }

      group.worktrees = kept;

      if (group.worktrees.length === 0) {
        groups.splice(i, 1);
      }
    }

    if (orphans.length === 0) return;

    if (!systemGroup) {
      systemGroup = { repositoryOrg: '_ungrouped', repositoryName: '_ungrouped', worktrees: [] };
      (groups as MutableSessionGroup[]).push(systemGroup);
    }

    for (const session of orphans) {
      const label = session.worktreeBranch ?? '_default';
      let wt = systemGroup.worktrees.find((w) => w.branch === label) as
        | { branch: string; path: string; sessions: Session[] }
        | undefined;
      if (!wt) {
        wt = { branch: label, path: session.cwd ?? '', sessions: [] };
        systemGroup.worktrees.push(wt as WorktreeSessionGroup);
      }
      wt.sessions.push(session);
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
      // Pseudo-groups (multi-repo, unassigned) don't have a bare clone to reconcile.
      // Mark their agent worktrees as ready so the UI doesn't show "not available locally"
      // and the SmartSessionButton stays visible — sessions can still be opened at the
      // workspace path (or basePath fallback).
      const isPseudoGroup =
        (group.repositoryOrg === '_multi-repo' && group.repositoryName === '_multi-repo') ||
        (group.repositoryOrg === '_unassigned' && group.repositoryName === '_unassigned');

      for (const wt of group.worktrees) {
        if (!wt.agentWorktree) {
          // Not an agent worktree — mark as ready if path exists
          continue;
        }
        if (isPseudoGroup) {
          (wt as { worktreeStatus?: string }).worktreeStatus = 'ready';
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
