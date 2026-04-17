import type { FastifyInstance } from 'fastify';
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

      // Bulk fetch tickets, personas, mentions, comments, deliverables
      const ticketIdArr = [...ticketIds];
      const [allTickets, allPersonas, allMentions, allComments, allDeliverables] = await Promise.all([
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

      // Enrich executions
      let entries = allExecutions.map((exec) => {
        const ticket = ticketMap.get(exec.ticketId);
        const persona = personaMap.get(exec.personaId);
        const mention = exec.mentionId ? mentionMap.get(exec.mentionId) : null;
        const rawType = mention?.targetType;
        const targetType = rawType === 'panel' ? 'panel' : rawType === 'skill' ? 'skill' : 'agent';

        return {
          ...exec,
          type: targetType as 'agent' | 'panel' | 'skill',
          executorName: persona?.displayName ?? persona?.name ?? exec.personaId,
          ticketTitle: ticket?.title ?? null,
          ticketSlug: ticket ? `#t-${ticket.displayId}` : null,
          ticketPriority: ticket?.priority ?? null,
          ticketType: ticket?.type ?? null,
          commentCount: commentCountMap.get(exec.ticketId) ?? 0,
          deliverableCount: deliverableCountMap.get(exec.ticketId) ?? 0,
        };
      });

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
