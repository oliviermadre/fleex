import type {
  NeedsYouItem,
  InFlightItem,
  DashboardDeliverable,
  TicketStatus,
  TicketMention,
  AgentExecution,
} from '@fleex/shared';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';

/**
 * Minimal ticket shape the launchpad needs. Derived from the dashboard's
 * already-loaded tickets so we don't re-query the ticket store.
 */
export interface LaunchpadTicket {
  readonly id: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  readonly updatedAt: string;
}

export interface LaunchpadDeps {
  readonly sessionStore: SessionStorePort;
  readonly agentEventStore: AgentEventStorePort;
  readonly deliverableStore: DeliverableStorePort;
  readonly mentionStore: MentionStorePort;
  readonly personaStore: PersonaStorePort;
  /** Null on storage drivers without workflow support (pgsql/json) → flows degrade. */
  readonly workflowRunStore: WorkflowRunStorePort | null;
  readonly tickets: LaunchpadTicket[];
  readonly now: Date;
  /** Hours of inactivity after which a ticket is "stale". Default 48. */
  readonly staleHours?: number;
  readonly recentOutputsLimit?: number;
}

/**
 * The non-GitHub half of the launchpad payload. GitHub-derived bits
 * (PR draft/conflict counts, review-requested items, branches) are merged
 * in the route which already holds that data.
 */
export interface LaunchpadResult {
  readonly liveRuns: number;
  readonly liveRunsNeedReview: number;
  readonly needsReview: number;
  readonly needsReviewFailed: number;
  readonly deliverablesToday: number;
  readonly spendTodayUsd: number;
  readonly needsYou: NeedsYouItem[];
  readonly inFlight: InFlightItem[];
  readonly recentOutputs: DashboardDeliverable[];
}

const HOUR_MS = 3_600_000;

function sameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Aggregate the live/agentic half of the dashboard launchpad from the
 * domain stores. Every store access is isolated so one failing source
 * degrades a single section rather than the whole dashboard.
 */
export async function getDashboardLaunchpad(deps: LaunchpadDeps): Promise<LaunchpadResult> {
  const staleHours = deps.staleHours ?? 48;
  const recentLimit = deps.recentOutputsLimit ?? 8;
  const now = deps.now;
  const nowMs = now.getTime();
  const recentMs = staleHours * HOUR_MS;

  const ticketById = new Map(deps.tickets.map((t) => [t.id, t] as const));
  const slug = (id: string): string => {
    const t = ticketById.get(id);
    return t ? `#t-${t.displayId}` : '';
  };

  // ── Sessions → live runs KPI ──
  let liveRuns = 0;
  let liveRunsNeedReview = 0;
  try {
    const sessions = (await deps.sessionStore.getAll()).map((s) => s.toDTO());
    for (const s of sessions) {
      if (s.type !== 'claude' || s.status !== 'running') continue;
      liveRuns += 1;
      if (s.hookStatus === 'waiting') liveRunsNeedReview += 1;
    }
  } catch {
    /* degrade: leave counts at 0 */
  }

  // ── Executions → spend today + In-Flight grouping ──
  let spendTodayUsd = 0;
  let executions: AgentExecution[] = [];
  try {
    executions = await deps.agentEventStore.getAllExecutions();
    for (const e of executions) {
      if (e.costUsd && sameLocalDay(e.startedAt, now)) spendTodayUsd += e.costUsd;
    }
  } catch {
    executions = [];
  }

  // persona display names
  const personaName = new Map<string, string>();
  try {
    for (const p of await deps.personaStore.getAll()) {
      personaName.set(p.id, p.displayName || p.name);
    }
  } catch {
    /* degrade: fall back to persona id / mention target */
  }

  // mentions
  let mentions: TicketMention[] = [];
  try {
    mentions = (await deps.mentionStore.getAll()).map((m) => m.toDTO());
  } catch {
    mentions = [];
  }
  const mentionById = new Map(mentions.map((m) => [m.id, m] as const));

  // ── In-Flight ──
  const inFlight: InFlightItem[] = [];

  // flows (workflow runs that are running) — degrade if store absent
  if (deps.workflowRunStore) {
    try {
      const running = (await deps.workflowRunStore.getByStatus('running')).map((r) => r.toDTO());
      for (const r of running) {
        const steps = r.templateSnapshot.steps;
        const idx = r.currentStepId ? steps.findIndex((s) => s.id === r.currentStepId) : -1;
        const current = idx >= 0 ? steps[idx] : undefined;
        const t = ticketById.get(r.ticketId);
        inFlight.push({
          id: `flow:${r.id}`,
          kind: 'flow',
          title: r.templateSnapshot.name,
          ticketId: r.ticketId,
          ticketDisplayId: t?.displayId ?? null,
          status: 'running',
          detail: current?.name ?? null,
          stepIndex: idx >= 0 ? idx + 1 : null,
          stepTotal: steps.length,
          at: r.startedAt,
        });
      }
    } catch {
      /* degrade: no flows */
    }
  }

  // agent / panel / skill: group executions by mention, keep groups with a running member
  const byMention = new Map<string, AgentExecution[]>();
  for (const e of executions) {
    const arr = byMention.get(e.mentionId);
    if (arr) arr.push(e);
    else byMention.set(e.mentionId, [e]);
  }
  for (const [mentionId, group] of byMention) {
    if (!group.some((e) => e.status === 'running')) continue;
    const mention = mentionById.get(mentionId);
    const membersTotal = group.length;
    const membersDone = group.filter((e) => e.status === 'completed').length;
    const lead = [...group].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!;
    const runningMember = group.find((e) => e.status === 'running') ?? lead;
    const ticketDisplayId = ticketById.get(lead.ticketId)?.displayId ?? null;
    const targetType = mention?.targetType;

    if (targetType === 'panel' || membersTotal > 1) {
      inFlight.push({
        id: `panel:${mentionId}`,
        kind: 'panel',
        title: mention?.targetAgent ?? 'Panel',
        ticketId: lead.ticketId,
        ticketDisplayId,
        status: 'running',
        membersDone,
        membersTotal,
        executionId: runningMember.id,
        at: lead.startedAt,
      });
    } else if (targetType === 'skill') {
      inFlight.push({
        id: `skill:${mentionId}`,
        kind: 'skill',
        title: mention?.targetAgent ?? 'Skill',
        ticketId: lead.ticketId,
        ticketDisplayId,
        status: 'running',
        executionId: runningMember.id,
        at: lead.startedAt,
      });
    } else {
      inFlight.push({
        id: `agent:${mentionId}`,
        kind: 'agent',
        title: personaName.get(runningMember.personaId) ?? mention?.targetAgent ?? runningMember.personaId,
        ticketId: lead.ticketId,
        ticketDisplayId,
        status: 'running',
        executionId: runningMember.id,
        at: lead.startedAt,
      });
    }
  }
  inFlight.sort((a, b) => b.at.localeCompare(a.at));

  // ── Needs You ──
  const needsYou: NeedsYouItem[] = [];

  // failed workflow runs (recent window)
  let needsReviewFailed = 0;
  if (deps.workflowRunStore) {
    try {
      const failed = (await deps.workflowRunStore.getByStatus('failed')).map((r) => r.toDTO());
      for (const r of failed) {
        const at = r.completedAt ?? r.updatedAt;
        if (nowMs - new Date(at).getTime() > recentMs) continue;
        needsReviewFailed += 1;
        needsYou.push({
          id: `failed:${r.id}`,
          kind: 'failed_run',
          title: `${r.templateSnapshot.name} failed`,
          subtitle: slug(r.ticketId) || 'Workflow run',
          ticketId: r.ticketId,
          ticketDisplayId: ticketById.get(r.ticketId)?.displayId ?? null,
          at,
        });
      }
    } catch {
      /* degrade */
    }
  }

  // mentions waiting for info
  for (const m of mentions) {
    if (m.status !== 'waiting_for_info') continue;
    needsYou.push({
      id: `mention:${m.id}`,
      kind: 'mention_waiting',
      title: `${m.targetAgent} needs info`,
      subtitle: slug(m.ticketId) || 'Mention',
      ticketId: m.ticketId,
      ticketDisplayId: ticketById.get(m.ticketId)?.displayId ?? null,
      at: m.createdAt,
    });
  }

  // deliverables: recent outputs + "plan ready" needs-you + today count
  let deliverablesToday = 0;
  let recentOutputs: DashboardDeliverable[] = [];
  try {
    const deliverables = (await deps.deliverableStore.getAll()).map((d) => d.toDTO());
    const sorted = [...deliverables].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const d of deliverables) {
      if (sameLocalDay(d.createdAt, now)) deliverablesToday += 1;
    }
    recentOutputs = sorted.slice(0, recentLimit).map((d) => ({
      id: d.id,
      ticketId: d.ticketId,
      ticketDisplayId: ticketById.get(d.ticketId)?.displayId ?? null,
      agentName: d.agentName,
      type: d.type,
      title: d.title,
      status: d.status,
      createdAt: d.createdAt,
    }));
    for (const d of sorted) {
      if (d.type !== 'plan') continue;
      if (nowMs - new Date(d.createdAt).getTime() > recentMs) continue;
      needsYou.push({
        id: `plan:${d.id}`,
        kind: 'plan_ready',
        title: `Plan ready — ${d.title}`,
        subtitle: `by ${d.agentName}${slug(d.ticketId) ? ` · ${slug(d.ticketId)}` : ''}`,
        ticketId: d.ticketId,
        ticketDisplayId: ticketById.get(d.ticketId)?.displayId ?? null,
        at: d.createdAt,
      });
    }
  } catch {
    /* degrade */
  }

  // stale tickets + needs-review KPI
  let needsReview = 0;
  for (const t of deps.tickets) {
    if (t.status === 'reviewing') needsReview += 1;
    const isActive = t.status !== 'done' && t.status !== 'cancelled';
    if (!isActive) continue;
    const idleMs = nowMs - new Date(t.updatedAt).getTime();
    if (idleMs <= recentMs) continue;
    needsYou.push({
      id: `stale:${t.id}`,
      kind: 'stale',
      title: `${t.title} is stale`,
      subtitle: `#t-${t.displayId} · no activity ${Math.floor(idleMs / HOUR_MS)}h`,
      ticketId: t.id,
      ticketDisplayId: t.displayId,
      at: t.updatedAt,
    });
  }

  needsYou.sort((a, b) => b.at.localeCompare(a.at));

  return {
    liveRuns,
    liveRunsNeedReview,
    needsReview,
    needsReviewFailed,
    deliverablesToday,
    spendTodayUsd: Math.round(spendTodayUsd * 100) / 100,
    needsYou,
    inFlight,
    recentOutputs,
  };
}
