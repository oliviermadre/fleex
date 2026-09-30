/**
 * Ticket #591 from the design screenshots, as raw sources: Backlog → Todo →
 * Doing, an @PM talk run, a "Feature → PR" workflow with a refused-then-validated
 * spec gate, a red-then-green CI, a panel review and a Merge gate still waiting,
 * PR #281, deliverables, comments and CLI sessions. Shared by the model, layout
 * and component tests. Dates are LOCAL (the timeline formats local clocks).
 */
import type {
  AgentExecution,
  StepRun,
  TicketActivity,
  TicketComment,
  TicketDeliverable,
  TicketLink,
  TicketMention,
  WorkflowEdge,
  WorkflowRun,
  WorkflowStep,
} from '@fleex/shared';
import type { TimelineSources } from './buildTimeline';

/** 29 Sept 2026 at hh:mm, local time. */
export const at = (h: number, m: number, day = 29) => new Date(2026, 8, day, h, m).toISOString();
export const NOW = new Date(2026, 8, 29, 10, 40).getTime();
export const TICKET_ID = 't-591';

export function activity(p: Partial<TicketActivity> & Pick<TicketActivity, 'id' | 'action' | 'createdAt'>): TicketActivity {
  return { ticketId: TICKET_ID, changes: {}, actorType: 'user', actorName: null, source: 'web', ...p };
}

export function comment(p: Partial<TicketComment> & Pick<TicketComment, 'id' | 'body' | 'createdAt'>): TicketComment {
  return {
    ticketId: TICKET_ID, authorType: 'user', authorName: 'nas', visibility: 'public', privateRecipients: [],
    mentions: [], parentId: null, updatedAt: p.createdAt, ...p,
  };
}

export function execution(p: Partial<AgentExecution> & Pick<AgentExecution, 'id' | 'startedAt'>): AgentExecution {
  return {
    personaId: 'p-pm', ticketId: TICKET_ID, mentionId: `m-${p.id}`, eventCount: 1, status: 'completed',
    completedAt: null, lastEventAt: null, source: 'sdk', ...p,
  };
}

export function deliverable(p: Partial<TicketDeliverable> & Pick<TicketDeliverable, 'id' | 'createdAt'>): TicketDeliverable {
  return {
    ticketId: TICKET_ID, agentName: 'PM', type: 'spec', title: `Livrable ${p.id}`, content: '# x', version: 1,
    status: 'final', mentionId: null, updatedAt: p.createdAt, ...p,
  };
}

export function mention(p: Partial<TicketMention> & Pick<TicketMention, 'id' | 'commentId'>): TicketMention {
  return {
    ticketId: TICKET_ID, targetAgent: 'pm', sourceAgent: 'nas', targetType: 'agent', executionMode: 'talk',
    status: 'resolved', resolvedAt: null, resolvedCommentId: null, resolvedDeliverableId: null, createdAt: at(5, 0), ...p,
  };
}

export function stepRun(p: Partial<StepRun> & Pick<StepRun, 'id' | 'stepId' | 'startedAt'>): StepRun {
  return {
    workflowRunId: 'run-1', attempt: 1, status: 'completed', result: 'ok', output: null, nextEdgeId: null,
    executionId: null, completedAt: null, createdAt: p.startedAt ?? at(5, 0), ...p,
  };
}

const step = (id: string, name: string, executorType: WorkflowStep['executorType'], executorRef = '', extra: Partial<WorkflowStep> = {}): WorkflowStep =>
  ({ id, name, executorType, executorRef, position: { x: 0, y: 0 }, ...extra });

const outcomeEdge = (id: string, source: string, target: string, value: string, label?: string): WorkflowEdge => ({
  id, source, target, isDefault: false, label,
  conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value }] },
});

export const STEPS: WorkflowStep[] = [
  step('triage', 'Triage', 'route'),
  step('spec', 'Spec', 'agent', 'pm'),
  step('gate-spec', 'Valider la spec', 'human_gate', '', { humanGateOutcomes: ['validé', 'refusé'] }),
  step('impl', 'Implémentation', 'agent', 'dev'),
  step('ci', 'Tests CI', 'native'),
  step('review', 'Panel review', 'panel', 'review-committee'),
  step('merge', 'Merge', 'human_gate', '', { humanGateOutcomes: ['Merger', 'Demander des changements'] }),
];

export const EDGES: WorkflowEdge[] = [
  { id: 'e1', source: 'triage', target: 'spec', isDefault: true },
  { id: 'e2', source: 'spec', target: 'gate-spec', isDefault: true },
  outcomeEdge('e3', 'gate-spec', 'spec', 'refusé'),
  outcomeEdge('e4', 'gate-spec', 'impl', 'validé'),
  { id: 'e5', source: 'impl', target: 'ci', isDefault: true },
  outcomeEdge('e6', 'ci', 'impl', 'rouge', 'rouge'),
  { id: 'e7', source: 'ci', target: 'review', isDefault: true, label: 'vert' },
  { id: 'e8', source: 'review', target: 'merge', isDefault: true },
  outcomeEdge('e9', 'merge', 'impl', 'Demander des changements'),
];

export const RUN: WorkflowRun = {
  id: 'run-1', ticketId: TICKET_ID, templateId: 'tpl-1',
  templateSnapshot: { name: 'Feature → PR', emoji: '🚀', steps: STEPS, edges: EDGES, entryStepId: 'triage' },
  status: 'needs_review', currentStepId: 'merge', triggeredBy: 'nas', triggeredFrom: 'web',
  startedAt: at(5, 25), completedAt: null, createdAt: at(5, 25), updatedAt: at(9, 17),
};

export const STEP_RUNS: StepRun[] = [
  stepRun({ id: 'sr-triage', stepId: 'triage', startedAt: at(5, 27), nextEdgeId: 'e1' }),
  stepRun({ id: 'sr-spec-1', stepId: 'spec', startedAt: at(5, 50), executionId: 'x-spec-1', nextEdgeId: 'e2' }),
  stepRun({
    id: 'sr-gate-1', stepId: 'gate-spec', startedAt: at(6, 13), nextEdgeId: 'e3',
    output: { schemaFields: {}, result: 'ok', outcome: 'refusé', humanResponse: 'risques non couverts' },
  }),
  stepRun({ id: 'sr-spec-2', stepId: 'spec', attempt: 2, startedAt: at(6, 36), executionId: 'x-spec-2', nextEdgeId: 'e2' }),
  stepRun({
    id: 'sr-gate-2', stepId: 'gate-spec', attempt: 2, startedAt: at(6, 59), nextEdgeId: 'e4',
    output: { schemaFields: {}, result: 'ok', outcome: 'validé' },
  }),
  stepRun({ id: 'sr-impl-1', stepId: 'impl', startedAt: at(7, 22), executionId: 'x-impl-1', nextEdgeId: 'e5' }),
  stepRun({
    id: 'sr-ci-1', stepId: 'ci', startedAt: at(7, 45), result: 'ko', nextEdgeId: 'e6',
    output: { schemaFields: {}, result: 'ko', outcome: 'rouge : 3 échecs' },
  }),
  stepRun({ id: 'sr-impl-2', stepId: 'impl', attempt: 2, startedAt: at(8, 8), executionId: 'x-impl-2', nextEdgeId: 'e5' }),
  stepRun({ id: 'sr-ci-2', stepId: 'ci', attempt: 2, startedAt: at(8, 31), nextEdgeId: 'e7', output: { schemaFields: {}, result: 'ok' } }),
  stepRun({ id: 'sr-review', stepId: 'review', startedAt: at(8, 54), nextEdgeId: 'e8', output: { schemaFields: {}, result: 'ok', outcome: 'ok' } }),
  stepRun({ id: 'sr-merge', stepId: 'merge', startedAt: at(9, 17), status: 'needs_review', result: null }),
  // Never executed — a branch not (yet) taken must not be drawn.
  stepRun({ id: 'sr-skipped', stepId: 'review', attempt: 2, startedAt: null, status: 'skipped', result: null }),
];

const LINKS: TicketLink[] = [
  { id: 'l-pr', type: 'github_pr', ref: 'oliviermadre/fleex#281', label: 'fleex#281', url: 'https://github.com/oliviermadre/fleex/pull/281', createdAt: at(7, 46) },
  { id: 'l-s1', type: 'session', ref: 's-1', label: 'claude · Triage', url: null, createdAt: at(5, 30) },
  { id: 'l-s2', type: 'session', ref: 's-2', label: 'claude · Spec', url: null, createdAt: at(6, 37) },
  { id: 'l-s3', type: 'session', ref: 's-3', label: 'shell', url: null, createdAt: at(7, 30) },
  { id: 'l-s4', type: 'session', ref: 's-4', label: 'claude · Impl', url: null, createdAt: at(8, 10) },
];

export function fixture591(): TimelineSources {
  return {
    ticket: {
      id: TICKET_ID, status: 'doing', createdAt: at(4, 41), statusChangedAt: at(7, 5), updatedAt: at(9, 17), links: LINKS,
    },
    // Newest first, like the API.
    activities: [
      activity({ id: 'a-move-2', action: 'moved', createdAt: at(7, 5), actorType: 'agent', actorName: '@Dev', changes: { status: { from: 'todo', to: 'doing' } } }),
      activity({ id: 'a-prio', action: 'updated', createdAt: at(5, 15), changes: { priority: { from: 'medium', to: 'high' } } }),
      activity({ id: 'a-move-1', action: 'moved', createdAt: at(4, 50), actorType: 'agent', actorName: '@PM', changes: { status: { from: 'backlog', to: 'todo' } } }),
      activity({ id: 'a-created', action: 'created', createdAt: at(4, 41) }),
    ],
    comments: [
      comment({ id: 'c-ask', body: '@agent:pm clarifie le besoin stp', createdAt: at(5, 3) }),
      comment({
        id: 'c-gate', authorType: 'agent', authorName: 'workflow:Feature → PR → Valider la spec',
        body: '**User decision :** validé', createdAt: at(7, 0),
      }),
      comment({ id: 'c-last', body: 'On merge après la review', createdAt: at(9, 20) }),
    ],
    deliverables: [
      deliverable({ id: 'd-brief', mentionId: 'm-pm', createdAt: at(5, 10), type: 'plan' }),
      deliverable({ id: 'd-spec', stepRunId: 'sr-spec-2', createdAt: at(6, 50), type: 'spec' }),
      deliverable({ id: 'd-code', stepRunId: 'sr-impl-2', createdAt: at(8, 25), type: 'code' }),
      deliverable({ id: 'd-review', stepRunId: 'sr-review', createdAt: at(9, 10), type: 'report' }),
    ],
    seenDeliverableIds: new Set(['d-brief', 'd-spec']),
    executions: [
      execution({ id: 'x-pm', mentionId: 'm-pm', startedAt: at(5, 4), effectiveMode: 'talk', costUsd: 0.42 }),
      execution({ id: 'x-spec-1', startedAt: at(5, 50) }),
      execution({ id: 'x-spec-2', startedAt: at(6, 36) }),
      execution({ id: 'x-impl-1', personaId: 'p-dev', startedAt: at(7, 22) }),
      execution({ id: 'x-impl-2', personaId: 'p-dev', startedAt: at(8, 8) }),
    ],
    mentions: [mention({ id: 'm-pm', commentId: 'c-ask' })],
    runs: [{ run: RUN, stepRuns: STEP_RUNS }],
    prs: [{
      ref: 'oliviermadre/fleex#281', label: 'fleex#281', url: 'https://github.com/oliviermadre/fleex/pull/281',
      state: 'open', title: 'Import Slack', additions: 10, deletions: 2,
    }],
    prDates: { 'oliviermadre/fleex#281': { createdAt: at(7, 46), mergedAt: null, branch: 'agent/591-import-slack' } },
    sessions: {
      's-2': { type: 'claude', status: 'dead', title: 'claude · Spec', branch: 'agent/591-import-slack' },
      's-4': { type: 'claude', status: 'running', title: 'claude · Impl', branch: 'agent/591-import-slack' },
    },
    names: {
      personas: { 'p-pm': 'PM', pm: 'PM', 'p-dev': 'Dev', dev: 'Dev' },
      panels: { 'review-committee': { name: 'Panel review', members: ['Archi', 'Sécu', 'UX'] } },
      skills: {},
    },
  };
}

/** A ticket with no history at all. */
export function emptySources(): TimelineSources {
  return {
    ticket: { id: TICKET_ID, status: 'todo', createdAt: at(9, 0), statusChangedAt: at(9, 0), updatedAt: at(9, 0), links: [] },
    activities: [], comments: [], deliverables: [], seenDeliverableIds: new Set(), executions: [], mentions: [],
    runs: [], prs: [], prDates: {}, sessions: {}, names: { personas: {}, panels: {}, skills: {} },
  };
}
