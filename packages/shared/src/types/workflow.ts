import type { DeliverableType, DeliverableStatus } from './ticket.js';
import type { RunSubject } from './routine.js';

export type WorkflowExecutorType = 'agent' | 'skill' | 'panel' | 'human_gate' | 'native' | 'route';

export type EdgeOperator =
  | 'eq' | 'neq'
  | 'in' | 'not_in'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'matches'                       // regex
  | 'is_empty' | 'is_not_empty'     // unary
  | 'is_true' | 'is_false';         // unary

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: string[];
  description?: string;
  items?: JsonSchemaProperty;
  /**
   * Fields of an object — including the object an `array` iterates over. Without
   * it `{ type: 'array', items: { type: 'object' } }` is a list of opaque blobs,
   * and a `forEach` step has nothing to offer the author for `{{ item.* }}`.
   */
  properties?: Record<string, JsonSchemaProperty>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * One deterministic operation inside a `native` step. `operationId` keys into
 * the shared operation registry (see `native-operations/descriptors.ts`);
 * `params` holds either literal values or `{{ … }}` references resolved at
 * runtime against the run's upstream step outputs.
 */
export interface NativeAction {
  /** Local to the step — keeps ordering stable and lets errors name the action. */
  id: string;
  operationId: string;
  params: Record<string, unknown>;
}

export interface WorkflowStep {
  id: string;
  name: string;
  executorType: WorkflowExecutorType;
  executorRef: string;
  mode?: 'talk' | 'plan' | 'edit';
  prompt?: string;
  outputSchema?: JsonSchema;
  humanGateOutcomes?: string[];
  /**
   * Required (non-empty) iff `executorType === 'native'`. Optional on the type
   * so pre-existing templates keep deserialising — mirrors `humanGateOutcomes`.
   */
  nativeActions?: NativeAction[];
  /**
   * Native steps only. A `{{ … }}` reference to an array in an upstream step's
   * output; the step's actions run once per element, with `{{ item.* }}` bound.
   * Optional on the type — like `nativeActions` — so pre-existing templates
   * keep deserialising.
   */
  forEach?: string;
  position: { x: number; y: number };
}

export interface WorkflowEdgeCondition {
  field: string;
  operator: EdgeOperator;
  value: string | string[];
}

/**
 * One comparison inside an edge's condition group.
 *
 * `stepId` is what lifts routing beyond "the step I just came from": a clause
 * may read the output of *any* ancestor of `edge.source`, so a workflow that
 * computes status, then priority, then type can branch on the three of them at
 * once instead of duplicating chains of steps.
 */
export interface EdgeConditionClause {
  /** Step whose output is read. Absent = the edge's source step (legacy behaviour). */
  stepId?: string;
  /** Path inside the merged output: `priority`, `deliverable.status`, `outcome`… */
  field: string;
  operator: EdgeOperator;
  /** Absent for unary operators. Array only for `in` / `not_in`. */
  value?: string | string[];
  /** Case-insensitive comparison (string operators only). Defaults to false. */
  caseInsensitive?: boolean;
}

/**
 * A flat AND/OR group. Nesting is deliberately out of scope — a `route` step
 * lets an author split a nested expression into two hops instead.
 */
export interface WorkflowEdgeConditionGroup {
  /** `all` = AND, `any` = OR. */
  match: 'all' | 'any';
  clauses: EdgeConditionClause[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  isDefault: boolean;
  /** @deprecated legacy single condition — still read, never written by the editor. */
  condition?: WorkflowEdgeCondition;
  conditionGroup?: WorkflowEdgeConditionGroup;
  label?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunStatus =
  | 'running' | 'blocked' | 'needs_review'
  | 'completed' | 'failed' | 'cancelled';

export interface WorkflowTemplateSnapshot {
  name: string;
  emoji: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
}

export interface WorkflowRun {
  id: string;
  /**
   * Null iff the run belongs to a routine. Exactly one of `ticketId` /
   * `routineId` is set — enforced in the DB — so a run is always reachable
   * either from its ticket or from its routine, and never orphaned.
   */
  ticketId: string | null;
  /** Set iff the run has no ticket. See `Routine`. Absent on pre-routines rows. */
  routineId?: string | null;
  /**
   * The run whose `workflow.trigger` action spawned this one. Null for a run a
   * human (or a routine) started. Only there to bound recursion: a workflow
   * that triggers itself would otherwise fan out forever.
   */
  parentRunId?: string | null;
  /**
   * The routine's subject, frozen when the run started — same rationale as
   * `templateSnapshot`: editing a routine must not rewrite its history.
   */
  subjectSnapshot?: RunSubject | null;
  /** Workspace directory the run's agent steps ran in, when one was created. */
  workspacePath?: string | null;
  templateId: string;
  templateSnapshot: WorkflowTemplateSnapshot;
  status: WorkflowRunStatus;
  currentStepId: string | null;
  triggeredBy: string;
  triggeredFrom: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `awaiting_routing` is deliberately NOT a flavour of `needs_review`: the step
 * itself succeeded, only the *edge to take* is undecided. Keeping it distinct
 * makes the three "waiting on a human" selectors (gate / needs_review /
 * ambiguous routing) disjoint by construction, and keeps `result` meaningful
 * for the conditions that run after the human picked a route.
 */
export type StepRunStatus =
  | 'queued' | 'running' | 'completed'
  | 'failed' | 'needs_review' | 'awaiting_routing' | 'cancelled' | 'skipped';

export type StepRunResult = 'ok' | 'needs_review' | 'ko';

export interface StepOutput {
  deliverable?: {
    title: string;
    markdown: string;
    type: DeliverableType;
    status: DeliverableStatus;
  } | null;
  comment?: string | null;
  mentionStatus?: 'resolved' | 'waiting_for_info';
  schemaFields: Record<string, unknown>;
  outcome?: string;
  /**
   * Free-text answer a human gave to a `waiting_for_info` question, recorded on
   * the step run that asked it. On a ticket run the answer is *also* posted as a
   * ticket comment, but a routine run has no ticket timeline — without this
   * field the answer would exist nowhere and the retried step would re-run with
   * the exact same prompt.
   */
  humanResponse?: string;
  result: StepRunResult;
  /**
   * Set when several outgoing edges matched at once and a human had to arbitrate.
   * `candidateEdgeIds` is persisted (never recomputed) so the choice offered to
   * the human stays the one the engine actually saw, even if the template is
   * edited in between.
   */
  routing?: {
    candidateEdgeIds: string[];
    chosenEdgeId?: string;
    decidedBy?: string;
    notes?: string;
  };
}

export interface StepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  result: StepRunResult | null;
  output: StepOutput | null;
  nextEdgeId: string | null;
  executionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateWorkflowRunInput {
  /** Omit when starting a routine run. */
  ticketId?: string;
  /** Omit when starting a ticket run. Exactly one of the two must be present. */
  routineId?: string;
  templateId: string;
  triggeredBy: string;
  triggeredFrom: string;
}

export interface ResolveHumanGateInput {
  outcome: string;
  notes?: string;
}

export interface ResolveAmbiguousRouteInput {
  edgeId: string;
  notes?: string;
}
