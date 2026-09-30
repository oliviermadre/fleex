/**
 * The ticket Timeline's event model — a PURE derivation (no React, no store) of
 * everything that already exists about a ticket: activity log, comments,
 * deliverables, executions, mentions, workflow runs, linked PRs and sessions.
 * No new data is stored anywhere; see SPEC §5.
 *
 * The timeline is FLAT: every step run of every workflow run is merged and
 * sorted by time, so a branch the workflow did not take is never drawn. The one
 * glimpse of the future is `pendingFork`: when a human gate / ambiguous route is
 * waiting, the possible outcomes fan out after "now".
 *
 * Display strings (labels, tooltip rows) are computed here rather than in the
 * components so the whole thing is testable and the renderer stays dumb.
 */
import {
  evaluateConditionGroup,
  getByPath,
  normalizeEdgeCondition,
  TICKET_STATUS_LABELS,
} from '@fleex/shared';
import type {
  AgentExecution,
  StepRun,
  TicketActivity,
  TicketComment,
  TicketDeliverable,
  TicketLink,
  TicketMention,
  TicketStatus,
  WorkflowExecutorType,
  WorkflowRun,
  WorkflowStep,
} from '@fleex/shared';
import type { WorkPrLink, WorkPrState } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lane = 'status' | 'top' | 'spine' | 'bottom';

/** The launchable primitives (mirrors lib/primitives' PrimitiveKind, kept React-free). */
export type TimelinePrimitive = 'persona' | 'skill' | 'panel' | 'workflow';

export type TimelineEventKind =
  | 'created'
  | 'status'
  | 'priority'
  | 'workflowStart'
  | 'cli'
  | 'step'
  | 'run'
  | 'deliverable'
  | 'pr'
  | 'comment';

/** What icon the renderer draws — resolved to existing iconography there. */
export type TimelineGlyph =
  | { type: 'human' }
  | { type: 'primitive'; kind: TimelinePrimitive }
  | { type: 'executor'; executor: WorkflowExecutorType }
  | { type: 'cli'; session: 'claude' | 'shell' }
  | { type: 'deliverable'; deliverableType: string; unread: boolean }
  | { type: 'comment'; human: boolean }
  | { type: 'pr'; state: WorkPrState | null; label: string }
  | { type: 'priority' }
  | { type: 'status'; status: TicketStatus };

export type NoteTone = 'ok' | 'ko' | 'warn';
export interface TimelineNote {
  text: string;
  tone: NoteTone;
}

/** Visual state of a spine node. */
export type NodeState = 'running' | 'pending' | 'ok' | 'ko' | 'cancelled';

/** What a click on the picto does (the component maps it to real actions). */
export type TimelineAction =
  | { type: 'execution'; executionId: string; title: string }
  | { type: 'workflow' }
  | { type: 'deliverable'; deliverableId: string }
  | { type: 'comment'; commentId: string }
  | { type: 'url'; url: string }
  | { type: 'session'; sessionId: string };

export interface TooltipContent {
  overline: string;
  title: string;
  chip: { text: string; tone: NoteTone | 'running' | 'muted' } | null;
  rows: [string, string][];
  footer: string | null;
}

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  /** ms epoch, already clamped to `now`. */
  at: number;
  lane: Lane;
  /** A spine event this picto is visually attached to (never implies causality). */
  parentId: string | null;
  glyph: TimelineGlyph;
  label: string;
  /** Sub-label without the time (the time is `clock`). */
  sub: string | null;
  /** "HH:mm", or "dd/MM HH:mm" on the first spine event of a new day. */
  clock: string;
  state: NodeState;
  /** Step replay counter (badge "2e" when > 1). */
  attempt: number;
  note: TimelineNote | null;
  /** Human gate: double ring + yellow label. */
  gate: boolean;
  tooltip: TooltipContent;
  action: TimelineAction | null;
  ariaLabel: string;
  /** Status events only: the status the zone switches to. */
  status?: TicketStatus;
  /** Status events only: the date is a guess (untracked move). */
  approximate?: boolean;
}

export interface TimelineZone {
  status: TicketStatus;
  from: number;
  to: number;
  actorName: string | null;
  approximate: boolean;
  /** The status event heading the zone. */
  eventId: string;
}

export interface ForkOption {
  label: string;
  hint: string | null;
  executor: WorkflowExecutorType | null;
  /** No target step — the workflow ends there. */
  done: boolean;
}

export interface PendingFork {
  anchorId: string;
  kind: 'gate' | 'route';
  options: ForkOption[];
}

export interface TimelineModel {
  events: TimelineEvent[];
  zones: TimelineZone[];
  pendingFork: PendingFork | null;
  /** PRs we could not date — listed in the fixed column instead. */
  undatedPrs: WorkPrLink[];
  /** Agentic span of the spine (tinted), or null when nothing ran. */
  activeSpan: { from: number; to: number; workflow: boolean } | null;
  now: number;
}

export interface RunWithSteps {
  run: WorkflowRun;
  /** Empty until the run detail is loaded. */
  stepRuns: StepRun[];
}

export interface SessionInfo {
  type: 'claude' | 'shell';
  status: 'running' | 'dead' | 'unknown';
  title: string;
  branch: string | null;
}

export interface PrDates {
  createdAt: string | null;
  mergedAt: string | null;
  branch: string | null;
}

/** Name lookups, keyed by BOTH id and slug/name so any reference resolves. */
export interface TimelineNames {
  personas: Record<string, string>;
  panels: Record<string, { name: string; members: string[] }>;
  skills: Record<string, string>;
}

export interface TimelineSources {
  ticket: {
    id: string;
    status: TicketStatus;
    createdAt: string;
    statusChangedAt: string | null;
    updatedAt: string;
    links: readonly TicketLink[];
  };
  /** Any order (the API returns newest first). */
  activities: readonly TicketActivity[];
  comments: readonly TicketComment[];
  deliverables: readonly TicketDeliverable[];
  seenDeliverableIds: ReadonlySet<string>;
  executions: readonly AgentExecution[];
  mentions: readonly TicketMention[];
  runs: readonly RunWithSteps[];
  prs: readonly WorkPrLink[];
  /** Keyed by PR ref "org/name#123" — from the repo PR polling, when known. */
  prDates: Readonly<Record<string, PrDates>>;
  /** Live tmux sessions by id. */
  sessions: Readonly<Record<string, SessionInfo>>;
  names: TimelineNames;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Tie-break at equal timestamps (SPEC §5.1). */
const RANK: Record<TimelineEventKind, number> = {
  created: 0, status: 1, priority: 2, workflowStart: 3, cli: 4, step: 5, run: 5, deliverable: 6, pr: 7, comment: 8,
};

const PRIORITY_FR: Record<string, string> = { none: 'aucune', low: 'basse', medium: 'moyenne', high: 'haute' };

const EXECUTOR_LABEL: Record<WorkflowExecutorType, string> = {
  agent: 'Agent', skill: 'Skill', panel: 'Panel', human_gate: 'Human gate', native: 'Native', route: 'Route',
};

const STEP_RUN_STATUS_FR: Record<string, string> = {
  running: 'en cours', completed: 'ok', failed: 'échec', needs_review: 'à valider',
  awaiting_routing: 'routage à choisir', cancelled: 'annulé',
};

// Greedy on the workflow name: "workflow:Feature → PR → Valider la spec" names step "Valider la spec".
const GATE_DECISION_AUTHOR = /^workflow:(.+)\s*→\s*(.+)$/;

// ── Small helpers ─────────────────────────────────────────────────────────────

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:mm". */
export function hhmm(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local "dd/MM HH:mm". */
function ddmmhhmm(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm(t)}`;
}

export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "08:54 · il y a 1 h" — the tooltip "Quand" row. */
export function whenLabel(t: number, now: number): string {
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  let ago: string;
  if (min < 1) ago = "à l'instant";
  else if (min < 60) ago = `il y a ${min} min`;
  else if (min < 60 * 24) ago = `il y a ${Math.floor(min / 60)} h`;
  else ago = `il y a ${Math.floor(min / (60 * 24))} j`;
  return `${sameLocalDay(t, now) ? hhmm(t) : ddmmhhmm(t)} · ${ago}`;
}

function durationLabel(fromIso: string | null, toIso: string | null): string | null {
  const a = ms(fromIso);
  const b = ms(toIso);
  if (a == null || b == null || b < a) return null;
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}

/** First line of a markdown body, stripped of the obvious syntax, truncated. */
export function excerpt(body: string, max: number): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  const plain = line
    .replace(/^#+\s*|^>\s*|^[-*]\s+/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/@agent:\S+|@workflow:\S+|@skill:\S+|@panel:\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** Plain text of a body (for a 3-line tooltip excerpt). */
function plainText(body: string, max: number): string {
  const plain = body.replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function statusLabel(s: string): string {
  return TICKET_STATUS_LABELS[s] ?? s;
}

function personaLabel(names: TimelineNames, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const n = names.personas[ref];
  return n ? `@${n}` : null;
}

/**
 * The primitive an out-of-workflow execution ran, from its mention, else from
 * the synthetic `mentionId` prefixes the server writes (skill:<id>,
 * panel:<id>:<rand>, workflow:<execId>, cli:…). Same rules as the server-side
 * classifier (server/src/domain/services/ticket-agent-activity.ts).
 */
export function classifyExecution(
  e: Pick<AgentExecution, 'mentionId' | 'source'>,
  mention: Pick<TicketMention, 'targetType'> | null,
): TimelinePrimitive | 'cli' {
  if (e.source === 'cli') return 'cli';
  if (mention) {
    switch (mention.targetType) {
      case 'skill': return 'skill';
      case 'panel': return 'panel';
      case 'workflow': return 'workflow';
      default: return 'persona';
    }
  }
  const id = e.mentionId ?? '';
  if (id.startsWith('skill:')) return 'skill';
  if (id.startsWith('panel:')) return 'panel';
  if (id.startsWith('workflow:')) return 'workflow';
  if (id.startsWith('cli:')) return 'cli';
  return 'persona';
}

function execState(status: AgentExecution['status']): NodeState {
  switch (status) {
    case 'running': return 'running';
    case 'failed': return 'ko';
    case 'interrupted': return 'cancelled';
    default: return 'ok';
  }
}

function stepState(sr: StepRun): NodeState {
  switch (sr.status) {
    case 'running': return 'running';
    case 'needs_review':
    case 'awaiting_routing': return 'pending';
    case 'failed': return 'ko';
    case 'cancelled': return 'cancelled';
    default: return sr.result === 'ko' ? 'ko' : 'ok';
  }
}

function chipFor(state: NodeState, text: string): TooltipContent['chip'] {
  const tone = state === 'running' ? 'running' : state === 'ko' ? 'ko' : state === 'pending' ? 'warn' : state === 'cancelled' ? 'muted' : 'ok';
  return { text, tone };
}

function glyphForExecutor(t: WorkflowExecutorType): TimelineGlyph {
  switch (t) {
    case 'agent': return { type: 'primitive', kind: 'persona' };
    case 'skill': return { type: 'primitive', kind: 'skill' };
    case 'panel': return { type: 'primitive', kind: 'panel' };
    default: return { type: 'executor', executor: t };
  }
}

/** The edge a step run took, when known. */
function chosenEdgeId(sr: StepRun): string | null {
  return sr.nextEdgeId ?? sr.output?.routing?.chosenEdgeId ?? null;
}

/** Outgoing edge a gate outcome leads to (condition match, else the default edge). */
export function edgeForOutcome(run: WorkflowRun, stepId: string, outcome: string) {
  const edges = run.templateSnapshot.edges.filter((e) => e.source === stepId);
  const output = { outcome };
  const matched = edges.find((edge) => {
    const group = normalizeEdgeCondition(edge);
    if (!group) return false;
    return evaluateConditionGroup(group, (clause) =>
      clause.stepId && clause.stepId !== stepId ? undefined : getByPath(output, clause.field),
    );
  });
  return matched ?? edges.find((e) => e.isDefault) ?? null;
}

// ── Builder ───────────────────────────────────────────────────────────────────

type Draft = Omit<TimelineEvent, 'clock'>;

function blankTooltip(title: string, overline = ''): TooltipContent {
  return { overline, title, chip: null, rows: [], footer: null };
}

/**
 * Build the flat timeline. `now` is injected (the component ticks it every 60 s)
 * so the result is deterministic and every `at` in the future is pulled back to it.
 */
export function buildTimeline(src: TimelineSources, now: number): TimelineModel {
  const clamp = (t: number) => Math.min(t, now);
  const drafts: Draft[] = [];
  const { names } = src;

  const activities = [...src.activities].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const createdAt = clamp(ms(src.ticket.createdAt) ?? now);

  // ── Creation ──
  const createdAct = activities.find((a) => a.action === 'created');
  const creatorName =
    createdAct?.actorName ?? (!createdAct || createdAct.actorType === 'user' ? 'Toi' : 'Agent');
  const createdSub = createdAct?.source === 'api' ? 'Importé' : 'Ticket créé';
  drafts.push({
    id: 'created', kind: 'created', at: createdAt, lane: 'spine', parentId: null,
    glyph: { type: 'human' }, label: creatorName, sub: createdSub, state: 'ok', attempt: 1, note: null, gate: false,
    tooltip: {
      ...blankTooltip('Ticket créé', 'Création'),
      rows: [['Par', creatorName], ['Quand', whenLabel(createdAt, now)], ['Source', createdAct?.source ?? 'web']],
    },
    action: null,
    ariaLabel: `Ticket créé par ${creatorName}, ${hhmm(createdAt)}`,
  });

  // ── Status zones ──
  const zones: TimelineZone[] = [];
  const moves = activities
    .filter((a) => a.action === 'moved' && a.changes?.status)
    .map((a) => ({
      at: clamp(ms(a.createdAt) ?? createdAt),
      from: a.changes.status!.from as TicketStatus,
      to: a.changes.status!.to as TicketStatus,
      actorName: a.actorName ?? (a.actorType === 'user' ? 'Toi' : null),
    }));

  const pushZone = (status: TicketStatus, from: number, actorName: string | null, approximate: boolean) => {
    const prev = zones[zones.length - 1];
    if (prev) prev.to = from;
    const id = `status:${zones.length}`;
    zones.push({ status, from, to: now, actorName, approximate, eventId: id });
    const tooltip = blankTooltip(
      prev ? `${statusLabel(prev.status)} → ${statusLabel(status)}` : statusLabel(status),
      'Statut',
    );
    tooltip.rows = [
      ...(actorName ? [['Par', actorName] as [string, string]] : []),
      ['Quand', approximate ? `${whenLabel(from, now)} (date approximative)` : whenLabel(from, now)],
    ];
    drafts.push({
      id, kind: 'status', at: from, lane: 'status', parentId: null,
      glyph: { type: 'status', status }, label: statusLabel(status), sub: actorName ? `par ${actorName}` : null,
      state: 'ok', attempt: 1, note: null, gate: false, tooltip, action: null,
      ariaLabel: `Statut ${statusLabel(status)}${actorName ? ` par ${actorName}` : ''}, ${hhmm(from)}`,
      status, approximate,
    });
  };

  pushZone(moves[0]?.from ?? src.ticket.status, createdAt, null, false);
  let lastZoneAt = createdAt;
  for (const m of moves) {
    const current = zones[zones.length - 1]!;
    if (m.from && m.from !== current.status) {
      // An untracked move happened in between: trust this move's `from`.
      pushZone(m.from, Math.max(lastZoneAt, Math.round((lastZoneAt + m.at) / 2)), null, true);
    }
    pushZone(m.to, Math.max(m.at, lastZoneAt), m.actorName, false);
    lastZoneAt = Math.max(m.at, lastZoneAt);
  }
  if (zones[zones.length - 1]!.status !== src.ticket.status) {
    const guess = clamp(ms(src.ticket.statusChangedAt) ?? ms(src.ticket.updatedAt) ?? now);
    pushZone(src.ticket.status, Math.max(guess, lastZoneAt), null, true);
  }

  // ── Priority ──
  for (const a of activities) {
    if (a.action !== 'updated' || !a.changes?.priority) continue;
    const from = PRIORITY_FR[String(a.changes.priority.from)] ?? String(a.changes.priority.from);
    const to = PRIORITY_FR[String(a.changes.priority.to)] ?? String(a.changes.priority.to);
    const at = clamp(ms(a.createdAt) ?? createdAt);
    const by = a.actorName ?? (a.actorType === 'user' ? 'Toi' : 'Agent');
    drafts.push({
      id: `prio:${a.id}`, kind: 'priority', at, lane: 'top', parentId: null,
      glyph: { type: 'priority' }, label: `priorité : ${from} → ${to}`, sub: null, state: 'ok', attempt: 1,
      note: null, gate: false,
      tooltip: { ...blankTooltip(`${from} → ${to}`, 'Priorité'), rows: [['Par', by], ['Quand', whenLabel(at, now)]] },
      action: null,
      ariaLabel: `Priorité ${from} vers ${to}, ${hhmm(at)}`,
    });
  }

  // ── Workflow runs & steps ──
  const execById = new Map(src.executions.map((e) => [e.id, e]));
  const eventIdByExecution = new Map<string, string>();
  const stepEventIdByStepRun = new Map<string, string>();
  const stepEvents: { id: string; at: number; stepName: string; workflowName: string }[] = [];
  let pendingFork: PendingFork | null = null;

  for (const { run, stepRuns } of src.runs) {
    const wfName = run.templateSnapshot?.name ?? 'Workflow';
    const runStart = clamp(ms(run.startedAt) ?? ms(run.createdAt) ?? now);
    drafts.push({
      id: `wf:${run.id}`, kind: 'workflowStart', at: runStart, lane: 'top', parentId: null,
      glyph: { type: 'primitive', kind: 'workflow' }, label: wfName, sub: null,
      state: run.status === 'failed' ? 'ko' : run.status === 'cancelled' ? 'cancelled' : run.status === 'completed' ? 'ok' : 'running',
      attempt: 1, note: null, gate: false,
      tooltip: {
        ...blankTooltip(`${run.templateSnapshot?.emoji ? `${run.templateSnapshot.emoji} ` : ''}${wfName}`, 'Workflow'),
        rows: [['Déclenché par', run.triggeredBy || '—'], ['Quand', whenLabel(runStart, now)], ['Statut du run', run.status]],
      },
      action: { type: 'workflow' },
      ariaLabel: `Workflow ${wfName} démarré, ${hhmm(runStart)}`,
    });

    const steps = new Map((run.templateSnapshot?.steps ?? []).map((s) => [s.id, s]));
    const executedInRun: { stepId: string; at: number }[] = stepRuns
      .filter((sr) => sr.status !== 'queued' && sr.status !== 'skipped')
      .map((sr) => ({ stepId: sr.stepId, at: ms(sr.startedAt ?? sr.createdAt) ?? 0 }));

    for (const sr of stepRuns) {
      if (sr.status === 'queued' || sr.status === 'skipped') continue;
      const step: WorkflowStep | undefined = steps.get(sr.stepId);
      const executor: WorkflowExecutorType = step?.executorType ?? 'native';
      const at = clamp(ms(sr.startedAt ?? sr.createdAt) ?? runStart);
      const exec = sr.executionId ? execById.get(sr.executionId) : undefined;
      const id = `step:${sr.id}`;
      const name = step?.name ?? sr.stepId;

      let who: string;
      let membersRow: string | null = null;
      if (executor === 'agent') {
        who = personaLabel(names, exec?.personaId) ?? personaLabel(names, step?.executorRef) ?? `@${step?.executorRef || 'agent'}`;
      } else if (executor === 'skill') {
        who = `skill · ${names.skills[step?.executorRef ?? ''] ?? step?.executorRef ?? ''}`.trim();
      } else if (executor === 'panel') {
        const p = names.panels[step?.executorRef ?? ''];
        who = p?.name ?? 'panel';
        membersRow = p && p.members.length > 0 ? p.members.map((m) => `@${m}`).join(', ') : null;
      } else if (executor === 'human_gate') {
        who = 'human gate';
      } else {
        who = executor;
      }

      // Note: what was decided / produced, in order of preference (SPEC §5.1).
      const out = sr.output;
      const edgeId = chosenEdgeId(sr);
      const edge = edgeId ? run.templateSnapshot.edges.find((e) => e.id === edgeId) : undefined;
      const extra = out?.humanResponse ?? out?.routing?.notes;
      let noteText: string | null = null;
      if (executor === 'human_gate' && out?.outcome) {
        noteText = extra ? `${out.outcome} : ${extra}` : out.outcome;
      } else if (executor === 'route' && edge?.label) {
        noteText = out?.routing?.notes ? `${edge.label} : ${out.routing.notes}` : edge.label;
      } else if (out?.outcome) {
        noteText = out.outcome;
      } else if (edge?.label) {
        noteText = out?.routing?.notes ? `${edge.label} : ${out.routing.notes}` : edge.label;
      } else if (sr.result === 'ko' || sr.status === 'failed') {
        noteText = 'échec';
      }
      // A decision that sent the run back to a step it already ran is a refusal.
      const wentBack = !!edge && executedInRun.some((x) => x.stepId === edge.target && x.at <= at);
      const tone: NoteTone =
        sr.result === 'ko' || sr.status === 'failed' || wentBack ? 'ko' : sr.status === 'needs_review' ? 'warn' : 'ok';
      const note = noteText ? { text: noteText, tone } : null;
      const state = stepState(sr);

      const rows: [string, string][] = [['Qui', executor === 'human_gate' ? (out?.routing?.decidedBy ?? 'Toi') : who]];
      if (membersRow) rows.push(['Membres', membersRow]);
      rows.push(['Étape', name]);
      if (note) rows.push(['Note', note.text]);
      if (out?.routing?.decidedBy) rows.push(['Décidé par', out.routing.decidedBy]);
      rows.push(['Quand', whenLabel(at, now)]);
      const dur = durationLabel(sr.startedAt, sr.completedAt);
      if (dur) rows.push(['Durée', dur]);
      if (exec?.costUsd != null) rows.push(['Coût', `$${exec.costUsd.toFixed(2)}`]);
      rows.push(['Source', `StepRun (attempt ${sr.attempt})`]);

      drafts.push({
        id, kind: 'step', at, lane: 'spine', parentId: null,
        glyph: glyphForExecutor(executor), label: name, sub: who, state, attempt: sr.attempt, note,
        gate: executor === 'human_gate',
        tooltip: {
          overline: `${EXECUTOR_LABEL[executor]} · ${wfName} → ${run.status}`,
          title: name,
          chip: chipFor(state, STEP_RUN_STATUS_FR[sr.status] ?? sr.status),
          rows,
          footer: null,
        },
        action: sr.executionId
          ? { type: 'execution', executionId: sr.executionId, title: name }
          : executor === 'human_gate' ? { type: 'workflow' } : null,
        ariaLabel: `Étape ${name}${sr.attempt > 1 ? ` (tentative ${sr.attempt})` : ''}, ${who}, ${hhmm(at)}${note ? `, ${note.text}` : ''}`,
      });
      if (sr.executionId) eventIdByExecution.set(sr.executionId, id);
      stepEventIdByStepRun.set(sr.id, id);
      stepEvents.push({ id, at, stepName: name, workflowName: wfName });
    }

    // Pending decision → the one future we draw.
    if (!pendingFork && (run.status === 'running' || run.status === 'blocked' || run.status === 'needs_review')) {
      pendingFork = forkFor(run, stepRuns, steps);
    }
  }

  // ── Out-of-workflow executions (mentions, direct launches) ──
  const mentionById = new Map(src.mentions.map((m) => [m.id, m]));
  const commentById = new Map(src.comments.map((c) => [c.id, c]));
  const standalone = src.executions.filter((e) => !eventIdByExecution.has(e.id));
  const panelGroups = new Map<string, AgentExecution[]>();
  const transcripts: AgentExecution[] = [];

  for (const e of standalone) {
    const mention = mentionById.get(e.mentionId) ?? null;
    const kind = classifyExecution(e, mention);
    if (kind === 'cli') {
      transcripts.push(e);
      continue;
    }
    if (kind === 'panel') {
      const g = panelGroups.get(e.mentionId);
      if (g) g.push(e);
      else panelGroups.set(e.mentionId, [e]);
      continue;
    }
    const at = clamp(ms(e.startedAt) ?? now);
    const id = `run:${e.id}`;
    let label: string;
    if (kind === 'persona') {
      label = personaLabel(names, e.personaId) ?? (mention ? `@${mention.targetAgent}` : '@agent');
      if (e.effectiveMode) label += ` · ${e.effectiveMode}`;
    } else if (kind === 'skill') {
      const ref = mention?.targetAgent ?? e.mentionId.split(':')[1] ?? '';
      label = names.skills[ref] ?? (ref || 'Skill');
    } else {
      label = 'Workflow';
    }
    const trigger = mention ? commentById.get(mention.commentId) : undefined;
    const sub = trigger ? excerpt(trigger.body, 24) || null : null;
    const state = execState(e.status);
    const rows: [string, string][] = [['Qui', label.split(' · ')[0]!], ['Quand', whenLabel(at, now)]];
    const dur = durationLabel(e.startedAt, e.completedAt);
    if (dur) rows.push(['Durée', dur]);
    if (e.costUsd != null) rows.push(['Coût', `$${e.costUsd.toFixed(2)}`]);
    rows.push(['Source', 'Mention']);
    drafts.push({
      id, kind: 'run', at, lane: 'spine', parentId: null,
      glyph: { type: 'primitive', kind }, label, sub, state, attempt: 1, note: null, gate: false,
      tooltip: {
        overline: `${kind === 'persona' ? 'Persona' : kind === 'skill' ? 'Skill' : 'Workflow'} · mention`,
        title: label,
        chip: chipFor(state, e.status),
        rows,
        footer: null,
      },
      action: { type: 'execution', executionId: e.id, title: label },
      ariaLabel: `Exécution ${label}, ${hhmm(at)}`,
    });
    eventIdByExecution.set(e.id, id);
  }

  // Panels: every member runs its own execution under one mention → ONE node.
  for (const [mentionId, group] of panelGroups) {
    const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const first = sorted[0]!;
    const mention = mentionById.get(mentionId) ?? null;
    const panelRef = mention?.targetAgent ?? mentionId.split(':')[1] ?? '';
    const panel = names.panels[panelRef];
    const panelName = panel?.name ?? (panelRef || 'Panel');
    const at = clamp(ms(first.startedAt) ?? now);
    const state: NodeState = sorted.some((e) => e.status === 'running')
      ? 'running'
      : sorted.some((e) => e.status === 'failed') ? 'ko' : 'ok';
    const ran = sorted.map((e) => names.personas[e.personaId]).filter((n): n is string => !!n);
    // Panel order first, then anyone who ran without being a (current) member.
    const members = [...new Set([...(panel?.members ?? []), ...ran])];
    const id = `run:${mentionId}`;
    const trigger = mention ? commentById.get(mention.commentId) : undefined;
    const cost = sorted.reduce((s, e) => s + (e.costUsd ?? 0), 0);
    const rows: [string, string][] = [['Qui', panelName]];
    if (members.length > 0) rows.push(['Membres', members.map((m) => `@${m}`).join(', ')]);
    rows.push(['Quand', whenLabel(at, now)]);
    if (cost > 0) rows.push(['Coût', `$${cost.toFixed(2)}`]);
    rows.push(['Source', 'Mention']);
    drafts.push({
      id, kind: 'run', at, lane: 'spine', parentId: null,
      glyph: { type: 'primitive', kind: 'panel' }, label: `Panel · ${panelName}`,
      sub: trigger ? excerpt(trigger.body, 24) || null : null, state, attempt: 1, note: null, gate: false,
      tooltip: {
        overline: 'Panel · mention', title: panelName,
        chip: chipFor(state, state === 'running' ? 'running' : state === 'ko' ? 'failed' : 'completed'),
        rows, footer: null,
      },
      action: { type: 'execution', executionId: first.id, title: `Panel · ${panelName}` },
      ariaLabel: `Panel ${panelName}, ${hhmm(at)}`,
    });
    for (const e of sorted) eventIdByExecution.set(e.id, id);
  }

  // ── CLI sessions (top lane) ──
  const seenSessions = new Set<string>();
  const addSession = (sessionId: string, atIso: string, fallbackTitle: string | null) => {
    if (seenSessions.has(sessionId)) return;
    seenSessions.add(sessionId);
    const live = src.sessions[sessionId];
    const title = live?.title ?? fallbackTitle ?? sessionId.slice(0, 8);
    const type = live?.type ?? (/claude/i.test(title) ? 'claude' : 'shell');
    const status = live?.status ?? 'unknown';
    const at = clamp(ms(atIso) ?? createdAt);
    drafts.push({
      id: `cli:${sessionId}`, kind: 'cli', at, lane: 'top', parentId: null,
      glyph: { type: 'cli', session: type }, label: title, sub: null,
      state: status === 'running' ? 'running' : 'ok', attempt: 1, note: null, gate: false,
      tooltip: {
        overline: type === 'claude' ? 'Session Claude Code' : 'Session shell',
        title,
        chip: null,
        rows: [
          ['Ouverte', whenLabel(at, now)],
          ['Statut', status === 'unknown' ? 'inconnu' : status],
          ...(live?.branch ? [['Branche', live.branch] as [string, string]] : []),
        ],
        footer: live && status === 'running' ? 'clic : ouvrir dans le Shell' : 'Onglet Shell pour la rattacher à un volet',
      },
      action: live && status === 'running' ? { type: 'session', sessionId } : null,
      ariaLabel: `Session ${type === 'claude' ? 'Claude Code' : 'shell'} ${title}, ${hhmm(at)}`,
    });
  };
  for (const l of src.ticket.links) {
    if (l.type === 'session') addSession(l.ref, l.createdAt, l.label || null);
  }
  for (const a of activities) {
    if (a.action !== 'linked') continue;
    const direct = a.changes?.session?.to;
    const link = a.changes?.link?.to as { type?: string; ref?: string; label?: string } | null | undefined;
    if (typeof direct === 'string') addSession(direct, a.createdAt, null);
    else if (link?.type === 'session' && link.ref) addSession(link.ref, a.createdAt, link.label ?? null);
  }
  for (const e of transcripts) {
    const at = clamp(ms(e.startedAt) ?? now);
    drafts.push({
      id: `cli-t:${e.id}`, kind: 'cli', at, lane: 'top', parentId: null,
      glyph: { type: 'cli', session: 'claude' }, label: 'claude', sub: null,
      state: execState(e.status), attempt: 1, note: null, gate: false,
      tooltip: {
        overline: 'Transcript Claude Code', title: 'Session CLI ingérée', chip: null,
        rows: [
          ['Ouverte', whenLabel(at, now)],
          ...(e.costUsd != null ? [['Coût', `$${e.costUsd.toFixed(2)}`] as [string, string]] : []),
        ],
        footer: 'clic : voir le transcript',
      },
      action: { type: 'execution', executionId: e.id, title: 'Transcript Claude Code' },
      ariaLabel: `Transcript Claude Code, ${hhmm(at)}`,
    });
  }

  // ── Parent resolution helpers (visual attachment only) ──
  const spineSorted = () =>
    drafts.filter((d) => d.lane === 'spine').sort((a, b) => a.at - b.at || RANK[a.kind] - RANK[b.kind]);
  const nearestStepNamed = (stepName: string, at: number): string | null => {
    let best: { id: string; at: number } | null = null;
    for (const s of stepEvents) {
      if (s.stepName !== stepName || s.at > at) continue;
      if (!best || s.at > best.at) best = s;
    }
    return best?.id ?? null;
  };
  const fromWorkflowAuthor = (author: string, at: number): string | null => {
    const m = GATE_DECISION_AUTHOR.exec(author);
    return m ? nearestStepNamed(m[2]!.trim(), at) : null;
  };

  // ── Deliverables (bottom lane) ──
  for (const d of src.deliverables) {
    const at = clamp(ms(d.createdAt) ?? now);
    let parentId: string | null = d.stepRunId ? stepEventIdByStepRun.get(d.stepRunId) ?? null : null;
    if (!parentId && d.mentionId) {
      const exec = src.executions.find((e) => e.mentionId === d.mentionId);
      parentId = exec ? eventIdByExecution.get(exec.id) ?? null : null;
    }
    if (!parentId) {
      const exec = src.executions.find((e) => e.deliverableId === d.id);
      parentId = exec ? eventIdByExecution.get(exec.id) ?? null : null;
    }
    if (!parentId) parentId = fromWorkflowAuthor(d.agentName, at);
    const unread = !src.seenDeliverableIds.has(d.id);
    drafts.push({
      id: `deliv:${d.id}`, kind: 'deliverable', at, lane: 'bottom', parentId,
      glyph: { type: 'deliverable', deliverableType: d.type, unread }, label: d.title, sub: null,
      state: 'ok', attempt: 1, note: null, gate: false,
      tooltip: {
        overline: `Livrable · ${d.type}`, title: d.title, chip: null,
        rows: [
          ['Auteur', d.agentName],
          ['Statut', d.status],
          ['Lu', unread ? 'non' : 'oui'],
          ['Quand', whenLabel(at, now)],
          ...(d.version > 1 ? [['Version', String(d.version)] as [string, string]] : []),
        ],
        footer: 'clic : ouvrir dans la liseuse',
      },
      action: { type: 'deliverable', deliverableId: d.id },
      ariaLabel: `Livrable ${d.type} : ${d.title}, ${hhmm(at)}`,
    });
  }

  // ── Comments (bottom lane) ──
  for (const c of src.comments) {
    const at = clamp(ms(c.createdAt) ?? now);
    const exec = src.executions.find((e) => e.commentId === c.id);
    const parentId = (exec ? eventIdByExecution.get(exec.id) ?? null : null) ?? fromWorkflowAuthor(c.authorName, at);
    const human = c.authorType === 'user';
    drafts.push({
      id: `comment:${c.id}`, kind: 'comment', at, lane: 'bottom', parentId,
      glyph: { type: 'comment', human }, label: c.authorName, sub: null, state: 'ok', attempt: 1, note: null, gate: false,
      tooltip: {
        overline: human ? 'Commentaire' : 'Commentaire agent', title: c.authorName, chip: null,
        rows: [['Extrait', plainText(c.body, 180)], ['Quand', whenLabel(at, now)]],
        footer: 'clic : voir dans la conversation',
      },
      action: { type: 'comment', commentId: c.id },
      ariaLabel: `Commentaire de ${c.authorName}, ${hhmm(at)}`,
    });
  }

  // ── Pull requests (bottom lane) ──
  const undatedPrs: WorkPrLink[] = [];
  for (const pr of src.prs) {
    const dates = src.prDates[pr.ref];
    const linkedAct = activities.find(
      (a) => a.action === 'linked' && (a.changes?.link?.to as { ref?: string } | null | undefined)?.ref === pr.ref,
    );
    const link = src.ticket.links.find((l) => l.type === 'github_pr' && l.ref === pr.ref);
    const openedIso = dates?.createdAt ?? null;
    const linkedIso = linkedAct?.createdAt ?? link?.createdAt ?? null;
    const atRaw = ms(openedIso) ?? ms(linkedIso);
    if (atRaw == null) {
      undatedPrs.push(pr);
      continue;
    }
    const at = clamp(atRaw);
    const spine = spineSorted();
    const parent = [...spine].reverse().find(
      (s) => s.at <= at && (s.kind === 'run' || (s.kind === 'step' && (s.glyph.type === 'primitive' || (s.glyph.type === 'executor' && s.glyph.executor === 'native')))),
    );
    const num = pr.ref.split('#')[1] ?? pr.label;
    drafts.push({
      id: `pr:${pr.ref}`, kind: 'pr', at, lane: 'bottom', parentId: parent?.id ?? null,
      // With a known merge date the merge gets its own (purple) chip; the opening one reads open.
      glyph: { type: 'pr', state: dates?.mergedAt && pr.state === 'merged' ? 'open' : pr.state, label: `#${num}` },
      label: `PR #${num}`, sub: null, state: 'ok', attempt: 1, note: null, gate: false,
      tooltip: {
        overline: 'Pull request', title: openedIso ? `PR #${num} ouverte` : `PR #${num} liée`, chip: null,
        rows: [
          ['État', pr.state ?? 'inconnu'],
          [openedIso ? 'Quand' : 'Liée', whenLabel(at, now)],
          ...(dates?.branch ? [['Branche', dates.branch] as [string, string]] : []),
          ...(pr.title ? [['Titre', pr.title] as [string, string]] : []),
        ],
        footer: 'clic : ouvrir sur GitHub',
      },
      action: pr.url ? { type: 'url', url: pr.url } : null,
      ariaLabel: `PR #${num} ${openedIso ? 'ouverte' : 'liée'}, ${hhmm(at)}`,
    });
    const mergedAt = ms(dates?.mergedAt);
    if (mergedAt != null) {
      const mAt = clamp(mergedAt);
      drafts.push({
        id: `pr-merged:${pr.ref}`, kind: 'pr', at: mAt, lane: 'bottom', parentId: null,
        glyph: { type: 'pr', state: 'merged', label: `#${num}` }, label: `PR #${num} mergée`, sub: null,
        state: 'ok', attempt: 1, note: null, gate: false,
        tooltip: { overline: 'Pull request', title: `PR #${num} mergée`, chip: null, rows: [['Quand', whenLabel(mAt, now)]], footer: 'clic : ouvrir sur GitHub' },
        action: pr.url ? { type: 'url', url: pr.url } : null,
        ariaLabel: `PR #${num} mergée, ${hhmm(mAt)}`,
      });
    }
  }

  // ── Sort, clocks, active span ──
  const byId = new Map(drafts.map((d) => [d.id, d]));
  // A child can't be drawn before its parent.
  for (const d of drafts) {
    if (!d.parentId) continue;
    const p = byId.get(d.parentId);
    if (!p) d.parentId = null;
    else if (d.at < p.at) d.at = p.at;
  }
  drafts.sort((a, b) => a.at - b.at || RANK[a.kind] - RANK[b.kind]);

  let prevSpineAt: number | null = null;
  const events: TimelineEvent[] = drafts.map((d) => {
    let clock = hhmm(d.at);
    if (d.lane === 'spine') {
      if (prevSpineAt != null && !sameLocalDay(prevSpineAt, d.at)) clock = ddmmhhmm(d.at);
      prevSpineAt = d.at;
    }
    return { ...d, clock };
  });

  const agentic = events.filter((e) => e.kind === 'step' || e.kind === 'run');
  let activeSpan: TimelineModel['activeSpan'] = null;
  if (agentic.length > 0) {
    const live = agentic.some((e) => e.state === 'running' || e.state === 'pending');
    activeSpan = {
      from: agentic[0]!.at,
      to: live ? now : agentic[agentic.length - 1]!.at,
      workflow: src.runs.length > 0,
    };
  }

  return { events, zones, pendingFork, undatedPrs, activeSpan, now };
}

/** The pending decision of an active run, if any (logic of gateCards.ts). */
function forkFor(run: WorkflowRun, stepRuns: StepRun[], steps: Map<string, WorkflowStep>): PendingFork | null {
  const latest = new Map<string, StepRun>();
  for (const sr of stepRuns) {
    const cur = latest.get(sr.stepId);
    if (!cur || sr.attempt > cur.attempt) latest.set(sr.stepId, sr);
  }
  for (const sr of latest.values()) {
    const step = steps.get(sr.stepId);
    if (!step) continue;
    if (sr.status === 'needs_review' && step.executorType === 'human_gate') {
      const outcomes = (sr.output?.schemaFields?.outcomes as string[] | undefined) ?? step.humanGateOutcomes ?? [];
      if (outcomes.length === 0) return null;
      return {
        anchorId: `step:${sr.id}`,
        kind: 'gate',
        options: outcomes.map((outcome) => {
          const edge = edgeForOutcome(run, step.id, outcome);
          const target = edge ? steps.get(edge.target) : undefined;
          return target
            ? { label: target.name, hint: outcome, executor: target.executorType, done: false }
            : { label: 'Done', hint: outcome, executor: null, done: true };
        }),
      };
    }
    if (sr.status === 'awaiting_routing') {
      const ids = sr.output?.routing?.candidateEdgeIds ?? [];
      const options = ids
        .map((id) => run.templateSnapshot.edges.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((edge) => {
          const target = steps.get(edge.target);
          return target
            ? { label: target.name, hint: edge.label ?? null, executor: target.executorType, done: false }
            : { label: 'Done', hint: edge.label ?? null, executor: null, done: true };
        });
      if (options.length === 0) return null;
      return { anchorId: `step:${sr.id}`, kind: 'route', options };
    }
  }
  return null;
}
