/**
 * The single `toDTO()` boundary of the statistics read model.
 *
 * Everything upstream is entities; everything downstream is plain rows. Each
 * entity is converted exactly once here, no matter how many buckets or
 * aggregates end up reading it.
 */
import type { RawStatsData } from './raw-data.js';
import type {
  TicketRow,
  CommentRow,
  MentionRow,
  DeliverableRow,
  ExecutionRow,
  SessionRow,
  PanelEventRow,
  WorkflowRunRow,
  TicketMove,
  NamedRef,
} from './rows.js';

export type * from './rows.js';
export type { RawStatsData, RawEvent } from './raw-data.js';

export interface StatsDataset {
  readonly tickets: TicketRow[];
  readonly comments: CommentRow[];
  readonly mentions: MentionRow[];
  readonly deliverables: DeliverableRow[];
  readonly executions: ExecutionRow[];
  readonly sessions: SessionRow[];
  readonly panelEvents: PanelEventRow[];
  readonly workflowRuns: WorkflowRunRow[];
  readonly personaById: ReadonlyMap<string, NamedRef>;
  readonly skillById: ReadonlyMap<string, NamedRef>;
  /** Per-ticket transition timelines, sorted ascending. */
  readonly movesByTicket: ReadonlyMap<string, TicketMove[]>;
}

export function buildDataset(raw: RawStatsData): StatsDataset {
  const boardNameById = new Map(raw.boards.map((b) => [b.id, b.name]));

  const tickets: TicketRow[] = raw.tickets.map((entity) => {
    const t = entity.toDTO();
    const createdAt = new Date(t.createdAt);
    const statusChangedAt = new Date(t.statusChangedAt);
    let prLinkCount = 0;
    for (const l of t.links) if (l.type === 'github_pr') prLinkCount += 1;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      boardName: boardNameById.get(t.boardId) ?? 'Unknown',
      createdAt,
      createdAtMs: createdAt.getTime(),
      statusChangedAt,
      statusChangedAtMs: statusChangedAt.getTime(),
      prLinkCount,
    };
  });

  const comments: CommentRow[] = raw.comments.map((entity) => {
    const c = entity.toDTO();
    return { ticketId: c.ticketId, authorType: c.authorType, createdAtMs: Date.parse(c.createdAt) };
  });

  const mentions: MentionRow[] = raw.mentions.map((entity) => {
    const m = entity.toDTO();
    return {
      id: m.id,
      ticketId: m.ticketId,
      status: m.status,
      createdAtMs: Date.parse(m.createdAt),
    };
  });

  const deliverables: DeliverableRow[] = raw.deliverables.map((entity) => ({
    createdAtMs: Date.parse(entity.toDTO().createdAt),
  }));

  const executions: ExecutionRow[] = raw.executions.map((e) => {
    const startedAtMs = Date.parse(e.startedAt);
    const isSkill = e.mentionId.startsWith('skill:');
    return {
      personaId: e.personaId,
      mentionId: e.mentionId,
      status: e.status,
      source: e.source === 'cli' ? 'cli' : 'sdk',
      startedAtMs,
      durationMs: e.completedAt ? Date.parse(e.completedAt) - startedAtMs : null,
      costUsd: e.costUsd ?? null,
      inputTokens: e.inputTokens ?? null,
      outputTokens: e.outputTokens ?? null,
      isSkill,
      skillId: isSkill ? e.mentionId.slice('skill:'.length) : null,
    };
  });

  const sessions: SessionRow[] = raw.sessions.map((s) => ({
    createdAtMs: s.createdAt.getTime(),
    isWorktree: Boolean(s.worktreeBranch) || s.type === 'claude',
    isActive: s.status === 'running',
  }));

  const panelEvents: PanelEventRow[] = raw.panelEvents.map((ev) => {
    const p = ev.payload;
    return {
      rawPanelId: p['panelId'],
      panelId: (p['panelId'] as string) ?? 'unknown',
      panelName: (p['panelName'] as string) ?? null,
      panelDisplayName: (p['panelDisplayName'] as string) ?? null,
      status: (p['status'] as string) ?? 'completed',
      durationMs: (p['durationMs'] as number) ?? 0,
      respondedMembers: (p['respondedMembers'] as number) ?? 0,
      occurredAtMs: ev.occurredAt.getTime(),
    };
  });

  const workflowRuns: WorkflowRunRow[] = raw.workflowRuns.map((r) => ({
    ticketId: r.ticketId,
    templateId: r.templateId,
    templateName: r.templateSnapshot?.name ?? null,
    status: r.status as WorkflowRunRow['status'],
    startedAtMs: r.startedAt.getTime(),
    durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
  }));

  const movesByTicket = new Map<string, TicketMove[]>();
  for (const ev of raw.moveEvents) {
    const tid = ev.payload['ticketId'] as string | undefined;
    const to = ev.payload['toStatus'] as string | undefined;
    if (!tid || !to) continue;
    const list = movesByTicket.get(tid) ?? [];
    list.push({ at: ev.occurredAt, atMs: ev.occurredAt.getTime(), to });
    movesByTicket.set(tid, list);
  }
  // `Array.prototype.sort` is stable, so moves recorded at the same instant keep
  // their store order. The cumulative-flow sweep relies on that.
  for (const list of movesByTicket.values()) list.sort((a, b) => a.atMs - b.atMs);

  return {
    tickets,
    comments,
    mentions,
    deliverables,
    executions,
    sessions,
    panelEvents,
    workflowRuns,
    personaById: new Map(raw.personas.map((p) => [p.id, p])),
    skillById: new Map(raw.skills.map((s) => [s.id, s])),
    movesByTicket,
  };
}
