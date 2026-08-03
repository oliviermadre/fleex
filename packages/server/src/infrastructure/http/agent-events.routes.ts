import {
  computeInitials,
  type PanelMemberSummary,
  type ExecutionLogEntry,
  type AgentExecution,
  type WorkflowStepSummary,
} from '@fleex/shared';

import { AgentPersonaNotFoundError } from '../../domain/errors.js';

import type { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

const VALID_STATUSES = new Set<AgentExecution['status']>([
  'running',
  'completed',
  'failed',
  'interrupted',
]);
const VALID_TYPES = new Set<ExecutionLogEntry['type']>(['agent', 'panel', 'skill', 'workflow']);
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const MAX_Q_LENGTH = 200;

function parseCsvWhitelist<T extends string>(
  raw: string | undefined,
  whitelist: Set<T>,
): T[] | null {
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const allowed = parts.filter((p): p is T => whitelist.has(p as T));
  return allowed.length > 0 ? allowed : null;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (!raw) return def;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return def;
  return Math.min(Math.max(parsed, min), max);
}

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
      // ── Query param validation (defensive) ──────────────────────────────
      const statusFilter = parseCsvWhitelist<AgentExecution['status']>(
        request.query.status,
        VALID_STATUSES,
      );
      const typeFilter = parseCsvWhitelist<ExecutionLogEntry['type']>(
        request.query.type,
        VALID_TYPES,
      );
      const q = request.query.q ? request.query.q.slice(0, MAX_Q_LENGTH).toLowerCase() : undefined;
      const limit = clampInt(request.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
      const offset = clampInt(request.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

      // Fetch executions and workflow runs upfront so we can collect ticket
      // IDs from BOTH sources before firing the bulk lookups — a workflow run
      // can be on a ticket with no prior agent execution, in which case its
      // ticket would otherwise be missing from commentCount/deliverableCount maps.
      const [allExecutions, allWorkflowRuns] = await Promise.all([
        container.agentEventStore.getAllExecutions(),
        container.workflowRunStore?.getAll().catch((err: unknown) => {
          request.log.error({ err }, 'executions: workflowRunStore.getAll failed');
          return [] as WorkflowRunEntity[];
        }) ?? Promise.resolve([] as WorkflowRunEntity[]),
      ]);

      // Collect unique IDs for bulk lookups
      const ticketIds = new Set<string>();
      const personaIds = new Set<string>();
      const mentionIds = new Set<string>();
      for (const exec of allExecutions) {
        if (exec.ticketId) ticketIds.add(exec.ticketId);
        if (exec.personaId) personaIds.add(exec.personaId);
        if (exec.mentionId) mentionIds.add(exec.mentionId);
      }
      for (const run of allWorkflowRuns) {
        ticketIds.add(run.ticketId);
      }

      // Bulk fetch tickets, personas, mentions, comments, deliverables, panels, skills.
      // Each lookup falls back to an empty result on failure so a transient store
      // error in one collection doesn't 500 the whole Execution Log view.
      const ticketIdArr = [...ticketIds];
      const [
        allTickets,
        allPersonas,
        allMentions,
        allComments,
        allDeliverables,
        allPanels,
        allSkills,
        allStepRuns,
      ] = await Promise.all([
        container.ticketStore.getAllTickets().catch((err: unknown) => {
          request.log.error({ err }, 'executions: ticketStore.getAllTickets failed');
          return [];
        }),
        container.personaStore.getAll().catch((err: unknown) => {
          request.log.error({ err }, 'executions: personaStore.getAll failed');
          return [];
        }),
        mentionIds.size > 0
          ? container.mentionStore.getByIds([...mentionIds]).catch((err: unknown) => {
              request.log.error({ err }, 'executions: mentionStore.getByIds failed');
              return [];
            })
          : Promise.resolve([]),
        ticketIdArr.length > 0
          ? container.commentStore.getByTicketIds(ticketIdArr).catch((err: unknown) => {
              request.log.error({ err }, 'executions: commentStore.getByTicketIds failed');
              return [];
            })
          : Promise.resolve([]),
        ticketIdArr.length > 0
          ? container.deliverableStore.getByTicketIds(ticketIdArr).catch((err: unknown) => {
              request.log.error({ err }, 'executions: deliverableStore.getByTicketIds failed');
              return [];
            })
          : Promise.resolve([]),
        container.panelStore.getAll().catch((err: unknown) => {
          request.log.error({ err }, 'executions: panelStore.getAll failed');
          return [];
        }),
        container.skillStore.getAll().catch((err: unknown) => {
          request.log.error({ err }, 'executions: skillStore.getAll failed');
          return [];
        }),
        // Step runs are optional — undefined on instances that never ran the
        // workflow migration, in which case the Execution Log renders 0 workflow
        // entries (gated by allWorkflowRuns being empty too).
        container.stepRunStore?.getAll().catch((err: unknown) => {
          request.log.error({ err }, 'executions: stepRunStore.getAll failed');
          return [] as StepRunEntity[];
        }) ?? Promise.resolve([] as StepRunEntity[]),
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
      const mentionMap = new Map(allMentions.map((m) => [m.id, m]));
      const panelByName = new Map(allPanels.map((p) => [p.name, p]));
      const panelById = new Map(allPanels.map((p) => [p.id, p]));
      const skillById = new Map(allSkills.map((s) => [s.id, s]));

      // ── Identify executions owned by a workflow step ─────────────────────
      // Each agent/skill/panel step records the underlying agent_execution.id
      // on its step_run.executionId. We must exclude those executions from
      // the standalone/panel listings — otherwise the same work shows up
      // twice in the Execution Log (once as the workflow aggregate, once as
      // the bare agent/skill/panel run).
      const workflowOwnedExecutionIds = new Set<string>();
      for (const sr of allStepRuns) {
        if (sr.executionId) workflowOwnedExecutionIds.add(sr.executionId);
      }
      // Belt and suspenders: also catch agent_executions tagged with a
      // `workflow:` mentionId prefix from `executeForWorkflowStep`. The
      // orchestrator's catch block fails the step_run WITHOUT capturing
      // the executionId, so a failed/crashed workflow agent step otherwise
      // leaks through as a bare AGENT row in the log.
      for (const exec of allExecutions) {
        if (exec.mentionId?.startsWith('workflow:')) {
          workflowOwnedExecutionIds.add(exec.id);
        }
      }
      // Panel steps: only the orchestrator's executionId is stored on the
      // step_run. We need to hide the OTHER panel members too, otherwise the
      // panel group renders incomplete (missing orchestrator) but with the
      // remaining members still visible. Resolve the mentionId of every
      // workflow-owned panel exec and propagate the hide to every member.
      const workflowOwnedPanelMentionIds = new Set<string>();
      for (const exec of allExecutions) {
        if (!workflowOwnedExecutionIds.has(exec.id)) continue;
        const mention = exec.mentionId ? mentionMap.get(exec.mentionId) : null;
        const isPanelMention = mention?.targetType === 'panel';
        const isSyntheticPanelMentionId = exec.mentionId?.startsWith('panel:') ?? false;
        if ((isPanelMention || isSyntheticPanelMentionId) && exec.mentionId) {
          workflowOwnedPanelMentionIds.add(exec.mentionId);
        }
      }

      // ── Split executions: panel-run groups vs. standalone ─────────────────
      const panelGroups = new Map<string, AgentExecution[]>();
      const standaloneExecs: AgentExecution[] = [];
      for (const exec of allExecutions) {
        // Drop executions that are already represented by a workflow row.
        if (workflowOwnedExecutionIds.has(exec.id)) continue;
        if (exec.mentionId && workflowOwnedPanelMentionIds.has(exec.mentionId)) continue;

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
        // the agent that happens to be running it. Keep the agent displayName
        // in runByName so the UI can show "by <agent>".
        const agentDisplayName = persona?.displayName ?? persona?.name ?? exec.personaId;
        let executorName = agentDisplayName;
        let runByName: string | undefined;
        if (targetType === 'skill') {
          const skillId = isSyntheticSkillMentionId
            ? exec.mentionId!.slice('skill:'.length)
            : mention?.targetAgent;
          const skill = skillId ? skillById.get(skillId) : null;
          if (skill) executorName = skill.displayName ?? skill.name;
          else if (mention?.targetAgent) executorName = mention.targetAgent;
          runByName = agentDisplayName;
        }
        return {
          ...exec,
          type: targetType,
          executorName,
          runByName,
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

        // Inject a pending orchestrator bubble when the orchestrator has not
        // started yet — keeps the panel row visually complete from the start.
        if (panel?.orchestratorPersonaId) {
          const hasOrchestrator = members.some((m) => m.isOrchestrator);
          if (!hasOrchestrator) {
            const orchestratorPersona = personaMap.get(panel.orchestratorPersonaId);
            if (orchestratorPersona) {
              const displayName =
                orchestratorPersona.displayName ??
                orchestratorPersona.name ??
                panel.orchestratorPersonaId;
              members.push({
                executionId: `orchestrator-pending:${mentionId}`,
                personaId: panel.orchestratorPersonaId,
                displayName,
                initials: computeInitials(displayName),
                status: 'pending',
                isOrchestrator: true,
              });
            }
          }
        }

        // Aggregated status: running > failed > interrupted > completed
        let aggStatus: AgentExecution['status'] = 'completed';
        if (sorted.some((e) => e.status === 'running')) aggStatus = 'running';
        else if (sorted.some((e) => e.status === 'failed')) aggStatus = 'failed';
        else if (sorted.some((e) => e.status === 'interrupted')) aggStatus = 'interrupted';

        // Aggregated timing
        const startedAt = sorted[0]!.startedAt;
        const completedAts = sorted.map((e) => e.completedAt).filter((x): x is string => !!x);
        const allCompleted = aggStatus !== 'running' && completedAts.length === sorted.length;
        const completedAt = allCompleted ? (completedAts.sort().slice(-1)[0] ?? null) : null;
        const durationMs =
          allCompleted && completedAt
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
        const orchestratorExec =
          sorted.find((e) => e.personaId === panel?.orchestratorPersonaId) ?? sorted[0]!;
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
          executorName:
            orchestratorPersona?.displayName ??
            orchestratorPersona?.name ??
            orchestratorExec.personaId,
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

      // ── Workflow runs aggregation ─────────────────────────────────────────
      // Group step_runs by their workflow_run_id once, then map each WorkflowRun
      // to an ExecutionLogEntry summarising progress (dots, current step name,
      // and a 'needs_review' sub-status that the UI shows as an amber badge).
      const stepRunsByRun = new Map<string, StepRunEntity[]>();
      for (const sr of allStepRuns) {
        const list = stepRunsByRun.get(sr.workflowRunId);
        if (list) list.push(sr);
        else stepRunsByRun.set(sr.workflowRunId, [sr]);
      }

      function enrichWorkflowRun(run: WorkflowRunEntity): ExecutionLogEntry {
        const ticket = ticketMap.get(run.ticketId);
        const allSteps = run.templateSnapshot.steps;
        const stepRuns = stepRunsByRun.get(run.id) ?? [];

        // Latest attempt wins for each step's STATUS (matches WorkflowRunView):
        // if a step was retried, the dot reflects the retry's outcome.
        const latestPerStep = new Map<string, StepRunEntity>();
        // Earliest attempt determines the step's POSITION in the dot row:
        // the dots represent execution order, so Spec ran first (even if it
        // was later retried via a reject loop), Check Spec second, etc.
        // Using the earliest createdAt keeps a step at its original position
        // even when a loop edge brings the run back to it.
        const earliestCreatedAt = new Map<string, Date>();
        for (const sr of stepRuns) {
          const curLatest = latestPerStep.get(sr.stepId);
          if (!curLatest || sr.attempt > curLatest.attempt) latestPerStep.set(sr.stepId, sr);
          const curEarliest = earliestCreatedAt.get(sr.stepId);
          if (!curEarliest || sr.createdAt < curEarliest)
            earliestCreatedAt.set(sr.stepId, sr.createdAt);
        }

        // Build the dot list in execution order: steps that ran appear first,
        // ordered by the orchestrator's visit timestamp; steps that never ran
        // on this path (other branches, unreachable from current state) are
        // appended at the end in their template declaration order.
        const indexed = allSteps.map((s, i) => ({ step: s, originalIndex: i }));
        indexed.sort((a, b) => {
          const ta = earliestCreatedAt.get(a.step.id);
          const tb = earliestCreatedAt.get(b.step.id);
          if (ta && tb) return ta.getTime() - tb.getTime();
          if (ta) return -1;
          if (tb) return 1;
          return a.originalIndex - b.originalIndex;
        });

        const progress: WorkflowStepSummary[] = indexed.map(({ step: s }) => {
          const sr = latestPerStep.get(s.id);
          return {
            stepId: s.id,
            name: s.name,
            status: sr?.status ?? 'pending',
            isCurrent: run.currentStepId === s.id,
          };
        });

        const completedSteps = progress.filter((p) => p.status === 'completed').length;
        let currentStep = run.currentStepId
          ? allSteps.find((s) => s.id === run.currentStepId)
          : undefined;

        // `WorkflowRunEntity.fail()` nulls `currentStepId`, so we can't recover
        // the failing step name from the run alone. Look it up via step_runs:
        // the latest step_run with status='failed' is the one that broke the
        // flow. Same fallback for `cancelled` so the row shows the right name.
        if (!currentStep && (run.status === 'failed' || run.status === 'cancelled')) {
          const targetStatus = run.status === 'failed' ? 'failed' : 'cancelled';
          const sr = [...stepRuns]
            .filter((s) => s.status === targetStatus)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
          if (sr) {
            currentStep = allSteps.find((s) => s.id === sr.stepId);
          }
        }

        // Map WorkflowRunStatus → AgentExecution['status'] expected by the UI.
        // The `needs_review` / `blocked` distinction is surfaced via
        // workflowSubStatus so the UI can render a dedicated amber badge.
        let mappedStatus: AgentExecution['status'];
        let subStatus: 'needs_review' | 'blocked' | undefined;
        switch (run.status) {
          case 'running':
            mappedStatus = 'running';
            break;
          case 'needs_review':
            mappedStatus = 'running';
            subStatus = 'needs_review';
            break;
          case 'blocked':
            mappedStatus = 'running';
            subStatus = 'blocked';
            break;
          case 'completed':
            mappedStatus = 'completed';
            break;
          case 'failed':
            mappedStatus = 'failed';
            break;
          case 'cancelled':
            mappedStatus = 'interrupted';
            break;
        }

        const completedAt = run.completedAt?.toISOString() ?? null;
        const startedAt = run.startedAt.toISOString();
        const durationMs = completedAt
          ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
          : null;

        return {
          id: `workflow:${run.id}`,
          // Workflow runs aren't tied to a single persona — leave persona-shaped
          // fields empty so the row UI knows not to render persona/model columns.
          personaId: '',
          ticketId: run.ticketId,
          mentionId: `workflow:${run.id}`,
          eventCount: stepRuns.length,
          status: mappedStatus,
          startedAt,
          completedAt,
          lastEventAt: null,
          sdkSessionId: null,
          model: null,
          effectiveMode: null,
          durationMs,
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,

          type: 'workflow',
          executorName: run.templateSnapshot.name,
          ticketTitle: ticket?.title ?? null,
          ticketSlug: ticket ? `#t-${ticket.displayId}` : null,
          ticketPriority: ticket?.priority ?? null,
          ticketType: ticket?.type ?? null,
          commentCount: commentCountMap.get(run.ticketId) ?? 0,
          deliverableCount: deliverableCountMap.get(run.ticketId) ?? 0,

          workflowRunId: run.id,
          workflowSubStatus: subStatus,
          workflowCurrentStepName: currentStep?.name,
          workflowStepProgress: progress,
          workflowCompletedSteps: completedSteps,
          workflowTotalSteps: allSteps.length,
        };
      }

      let entries: ExecutionLogEntry[] = [
        ...standaloneExecs.map(enrichStandalone),
        ...[...panelGroups.entries()].map(([mid, execs]) => aggregatePanelRun(mid, execs)),
        ...allWorkflowRuns.map(enrichWorkflowRun),
      ];

      // Filter by status (statusFilter is pre-validated)
      if (statusFilter) {
        const statuses = new Set(statusFilter);
        entries = entries.filter((e) => statuses.has(e.status));
      }

      // Filter by search query (ticket title or executor name) — applied BEFORE type
      // so type tab counts reflect the current search.
      if (q) {
        entries = entries.filter(
          (e) =>
            (e.ticketTitle && e.ticketTitle.toLowerCase().includes(q)) ||
            e.executorName.toLowerCase().includes(q),
        );
      }

      // Compute per-type counts BEFORE applying the type filter, so tab badges
      // show accurate totals across all types.
      const typeCounts = { all: entries.length, agent: 0, panel: 0, skill: 0, workflow: 0 };
      for (const e of entries) {
        typeCounts[e.type] += 1;
      }

      // Filter by type (typeFilter is pre-validated)
      if (typeFilter) {
        const types = new Set(typeFilter);
        entries = entries.filter((e) => types.has(e.type));
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

      // Pagination — limit/offset are pre-validated and clamped (limit ≤ 500).
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
    app.get<{ Params: { id: string } }>('/api/tickets/:id/executions', async (request) => {
      return container.agentEventStore.getExecutionsByTicket(request.params.id);
    });

    // POST /api/executions/:id/cancel — cancel a running execution
    app.post<{ Params: { id: string } }>('/api/executions/:id/cancel', async (request, reply) => {
      const cancelled = await container.executeAgent.cancelExecution(request.params.id);
      if (!cancelled) {
        return reply.status(404).send({ error: 'Execution not found or not running' });
      }
      return { cancelled: true };
    });

    // GET /api/executions/:id/events — get all events for an execution (historical replay)
    app.get<{ Params: { id: string } }>('/api/executions/:id/events', async (request) => {
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
    });
  };
}
