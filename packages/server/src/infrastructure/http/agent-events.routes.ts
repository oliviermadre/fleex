import type { FastifyInstance } from 'fastify';
import { computeInitials, type PanelMemberSummary, type ExecutionLogEntry, type AgentExecution } from '@fleex/shared';
import { AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentEventsRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    // GET /api/executions — list all executions (enriched for Execution Log view)
    app.get<{
      Querystring: {
        status?: string;
        type?: string;
        q?: string;
        limit?: string;
        offset?: string;
      };
    }>('/api/executions', async (request) => {
      const allExecutions = await container.agentEventStore.getAllExecutions();

      // Collect unique IDs for bulk lookups
      const ticketIds = new Set<string>();
      const personaIds = new Set<string>();
      const mentionIds = new Set<string>();
      for (const exec of allExecutions) {
        if (exec.ticketId) ticketIds.add(exec.ticketId);
        if (exec.personaId) personaIds.add(exec.personaId);
        if (exec.mentionId) mentionIds.add(exec.mentionId);
      }

      // Bulk fetch tickets, personas, mentions, comments, deliverables, panels, skills
      const ticketIdArr = [...ticketIds];
      const [allTickets, allPersonas, allMentions, allComments, allDeliverables, allPanels, allSkills] = await Promise.all([
        container.ticketStore.getAllTickets(),
        container.personaStore.getAll(),
        Promise.all(
          [...mentionIds].map((id) =>
            container.mentionStore.getById(id).catch(() => null),
          ),
        ),
        ticketIdArr.length > 0
          ? container.commentStore.getByTicketIds(ticketIdArr)
          : Promise.resolve([]),
        ticketIdArr.length > 0
          ? container.deliverableStore.getByTicketIds(ticketIdArr)
          : Promise.resolve([]),
        container.panelStore.getAll(),
        container.skillStore.getAll(),
      ]);

      // Build comment/deliverable count maps
      const commentCountMap = new Map<string, number>();
      for (const c of allComments) {
        commentCountMap.set(c.ticketId, (commentCountMap.get(c.ticketId) ?? 0) + 1);
      }
      const deliverableCountMap = new Map<string, number>();
      for (const d of allDeliverables) {
        deliverableCountMap.set(d.ticketId, (deliverableCountMap.get(d.ticketId) ?? 0) + 1);
      }

      const ticketMap = new Map(allTickets.map((t) => [t.id, t]));
      const personaMap = new Map(allPersonas.map((p) => [p.id, p]));
      const mentionMap = new Map(
        allMentions
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map((m) => [m.id, m]),
      );
      const panelByName = new Map(allPanels.map((p) => [p.name, p]));
      const panelById = new Map(allPanels.map((p) => [p.id, p]));
      const skillById = new Map(allSkills.map((s) => [s.id, s]));

      // ── Split executions: panel-run groups vs. standalone ─────────────────
      const panelGroups = new Map<string, AgentExecution[]>();
      const standaloneExecs: AgentExecution[] = [];
      for (const exec of allExecutions) {
        const mention = exec.mentionId ? mentionMap.get(exec.mentionId) : null;
        const isPanelMention = mention?.targetType === 'panel';
        const isSyntheticPanelMentionId = exec.mentionId?.startsWith('panel:') ?? false;
        if (isPanelMention || isSyntheticPanelMentionId) {
          const key = exec.mentionId!;
          if (!panelGroups.has(key)) panelGroups.set(key, []);
          panelGroups.get(key)!.push(exec);
        } else {
          standaloneExecs.push(exec);
        }
      }

      function enrichStandalone(exec: AgentExecution): ExecutionLogEntry {
        const ticket = ticketMap.get(exec.ticketId);
        const persona = personaMap.get(exec.personaId);
        const mention = exec.mentionId ? mentionMap.get(exec.mentionId) : null;
        const rawType = mention?.targetType;
        // Skill executions don't create TicketMention records — they use a
        // synthetic mentionId of the form "skill:<id>" (see execute-agent.ts).
        const isSyntheticSkillMentionId = exec.mentionId?.startsWith('skill:') ?? false;
        const targetType: ExecutionLogEntry['type'] =
          rawType === 'panel'
            ? 'panel'
            : rawType === 'skill' || isSyntheticSkillMentionId
              ? 'skill'
              : 'agent';
        // For skills, show the skill's displayName as the executor instead of
        // the agent that happens to be running it.
        let executorName = persona?.displayName ?? persona?.name ?? exec.personaId;
        if (targetType === 'skill') {
          const skillId = isSyntheticSkillMentionId
            ? exec.mentionId!.slice('skill:'.length)
            : mention?.targetAgent;
          const skill = skillId ? skillById.get(skillId) : null;
          if (skill) executorName = skill.displayName ?? skill.name;
          else if (mention?.targetAgent) executorName = mention.targetAgent;
        }
        return {
          ...exec,
          type: targetType,
          executorName,
          ticketTitle: ticket?.title ?? null,
          ticketSlug: ticket ? `#t-${ticket.displayId}` : null,
          ticketPriority: ticket?.priority ?? null,
          ticketType: ticket?.type ?? null,
          commentCount: commentCountMap.get(exec.ticketId) ?? 0,
          deliverableCount: deliverableCountMap.get(exec.ticketId) ?? 0,
        };
      }

      function aggregatePanelRun(mentionId: string, execs: AgentExecution[]): ExecutionLogEntry {
        // Sort by startedAt so we have deterministic ordering of members.
        const sorted = [...execs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        const mention = mentionMap.get(mentionId);
        const panel =
          (mention && panelByName.get(mention.targetAgent)) ??
          panelById.get(mentionId.split(':')[1] ?? '') ??
          null;

        // Panel members
        const members: PanelMemberSummary[] = sorted.map((e) => {
          const persona = personaMap.get(e.personaId);
          const displayName = persona?.displayName ?? persona?.name ?? e.personaId;
          return {
            executionId: e.id,
            personaId: e.personaId,
            displayName,
            initials: computeInitials(displayName),
            status: e.status,
            isOrchestrator: panel?.orchestratorPersonaId === e.personaId,
          };
        });

        // Aggregated status: running > failed > interrupted > completed
        let aggStatus: AgentExecution['status'] = 'completed';
        if (sorted.some((e) => e.status === 'running')) aggStatus = 'running';
        else if (sorted.some((e) => e.status === 'failed')) aggStatus = 'failed';
        else if (sorted.some((e) => e.status === 'interrupted')) aggStatus = 'interrupted';

        // Aggregated timing
        const startedAt = sorted[0]!.startedAt;
        const completedAts = sorted.map((e) => e.completedAt).filter((x): x is string => !!x);
        const allCompleted = aggStatus !== 'running' && completedAts.length === sorted.length;
        const completedAt = allCompleted
          ? completedAts.sort().slice(-1)[0] ?? null
          : null;
        const durationMs = allCompleted && completedAt
          ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
          : null;

        // Aggregated tokens + cost (SUM across members)
        const sumOrNull = (vals: (number | null | undefined)[]): number | null => {
          const nums = vals.filter((v): v is number => typeof v === 'number');
          return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
        };
        const inputTokens = sumOrNull(sorted.map((e) => e.inputTokens));
        const outputTokens = sumOrNull(sorted.map((e) => e.outputTokens));
        const cacheReadTokens = sumOrNull(sorted.map((e) => e.cacheReadTokens));
        const cacheCreationTokens = sumOrNull(sorted.map((e) => e.cacheCreationTokens));
        const costUsd = sumOrNull(sorted.map((e) => e.costUsd));

        // Orchestrator's exec (for personaId / executorName / model anchor)
        const orchestratorExec = sorted.find((e) => e.personaId === panel?.orchestratorPersonaId) ?? sorted[0]!;
        const orchestratorPersona = personaMap.get(orchestratorExec.personaId);

        // Ticket context — pull from any exec, they share it
        const ticket = ticketMap.get(orchestratorExec.ticketId);

        // effectiveMode / model: prefer orchestrator's
        const effectiveMode = orchestratorExec.effectiveMode ?? sorted[0]!.effectiveMode ?? null;
        const model = orchestratorExec.model ?? null;

        // SDK session id: not meaningful at aggregate level
        const lastEventAts = sorted.map((e) => e.lastEventAt).filter((x): x is string => !!x);
        const lastEventAt = lastEventAts.length > 0 ? lastEventAts.sort().slice(-1)[0]! : null;

        return {
          id: `panelrun:${mentionId}`,
          personaId: orchestratorExec.personaId,
          ticketId: orchestratorExec.ticketId,
          mentionId,
          eventCount: sorted.reduce((n, e) => n + (e.eventCount ?? 0), 0),
          status: aggStatus,
          startedAt,
          completedAt,
          lastEventAt,
          sdkSessionId: null,
          model,
          effectiveMode,
          durationMs,
          costUsd,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,

          type: 'panel',
          executorName: orchestratorPersona?.displayName ?? orchestratorPersona?.name ?? orchestratorExec.personaId,
          ticketTitle: ticket?.title ?? null,
          ticketSlug: ticket ? `#t-${ticket.displayId}` : null,
          ticketPriority: ticket?.priority ?? null,
          ticketType: ticket?.type ?? null,
          commentCount: commentCountMap.get(orchestratorExec.ticketId) ?? 0,
          deliverableCount: deliverableCountMap.get(orchestratorExec.ticketId) ?? 0,

          panelDisplayName: panel?.displayName ?? mention?.targetAgent ?? 'Panel',
          panelMembers: members,
          memberCount: members.length,
        };
      }

      let entries: ExecutionLogEntry[] = [
        ...standaloneExecs.map(enrichStandalone),
        ...[...panelGroups.entries()].map(([mid, execs]) => aggregatePanelRun(mid, execs)),
      ];

      // Filter by status
      const statusFilter = request.query.status;
      if (statusFilter) {
        const statuses = statusFilter.split(',');
        entries = entries.filter((e) => statuses.includes(e.status));
      }

      // Filter by search query (ticket title or executor name) — applied BEFORE type
      // so type tab counts reflect the current search.
      const q = request.query.q?.toLowerCase();
      if (q) {
        entries = entries.filter(
          (e) =>
            (e.ticketTitle && e.ticketTitle.toLowerCase().includes(q)) ||
            e.executorName.toLowerCase().includes(q),
        );
      }

      // Compute per-type counts BEFORE applying the type filter, so tab badges
      // show accurate totals across all types.
      const typeCounts = { all: entries.length, agent: 0, panel: 0, skill: 0 };
      for (const e of entries) {
        typeCounts[e.type] += 1;
      }

      // Filter by type
      const typeFilter = request.query.type;
      if (typeFilter) {
        const types = typeFilter.split(',');
        entries = entries.filter((e) => types.includes(e.type));
      }

      // Sort: running first (by startedAt DESC), then completed (by completedAt DESC)
      entries.sort((a, b) => {
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (a.status !== 'running' && b.status === 'running') return 1;
        const dateA = a.completedAt ?? a.startedAt;
        const dateB = b.completedAt ?? b.startedAt;
        return dateB.localeCompare(dateA);
      });

      // Live/history counts reflect the current type filter (so HISTORY · N
      // matches the entries being shown in the list).
      const total = entries.length;
      const liveCount = entries.filter((e) => e.status === 'running').length;
      const historyCount = total - liveCount;

      // Pagination
      const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      entries = entries.slice(offset, offset + limit);

      return { entries, total, liveCount, historyCount, typeCounts };
    });

    // GET /api/personas/:id/executions — list executions for a persona
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/api/personas/:id/executions',
      async (request) => {
        const persona = await container.personaStore.getById(request.params.id);
        if (!persona) throw new AgentPersonaNotFoundError(request.params.id);

        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        return container.agentEventStore.getExecutionsByPersona(request.params.id, limit);
      },
    );

    // GET /api/tickets/:id/executions — list executions for a ticket
    app.get<{ Params: { id: string } }>(
      '/api/tickets/:id/executions',
      async (request) => {
        return container.agentEventStore.getExecutionsByTicket(request.params.id);
      },
    );

    // POST /api/executions/:id/cancel — cancel a running execution
    app.post<{ Params: { id: string } }>(
      '/api/executions/:id/cancel',
      async (request, reply) => {
        const cancelled = await container.executeAgent.cancelExecution(request.params.id);
        if (!cancelled) {
          return reply.status(404).send({ error: 'Execution not found or not running' });
        }
        return { cancelled: true };
      },
    );

    // GET /api/executions/:id/events — get all events for an execution (historical replay)
    app.get<{ Params: { id: string } }>(
      '/api/executions/:id/events',
      async (request) => {
        const executionId = request.params.id;
        const events = await container.agentEventStore.getEventsByExecution(executionId);
        const dtos = events.map((e) => e.toDTO());

        // Backfill execution_start events that lack executionId/sdkSessionId (old events)
        for (const dto of dtos) {
          if (dto.eventType === 'execution_start' && dto.data && typeof dto.data === 'object') {
            const data = dto.data as Record<string, unknown>;
            if (!data['executionId']) {
              data['executionId'] = executionId;
            }
            if (!data['resumeSessionId']) {
              // Look up sdkSessionId from execution index
              const executions = await container.agentEventStore.getExecutionsByTicket(
                (data['ticketId'] as string) ?? '',
              );
              // Find the execution just before this one for the same persona to get the resume session
              const thisExec = executions.find((e) => e.id === executionId);
              if (thisExec?.sdkSessionId) {
                // This is the session that was obtained *during* this execution,
                // not the one it resumed from — but still useful to show
                data['sdkSessionId'] = thisExec.sdkSessionId;
              }
            }
          }
        }

        return dtos;
      },
    );
  };
}
