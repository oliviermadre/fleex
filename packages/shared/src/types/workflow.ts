import type { DeliverableType, DeliverableStatus } from './ticket.js';

export type WorkflowExecutorType = 'agent' | 'skill' | 'panel' | 'human_gate' | 'native';

export type EdgeOperator = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'contains';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: string[];
  description?: string;
  items?: JsonSchemaProperty;
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
  position: { x: number; y: number };
}

export interface WorkflowEdgeCondition {
  field: string;
  operator: EdgeOperator;
  value: string | string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  isDefault: boolean;
  condition?: WorkflowEdgeCondition;
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
  ticketId: string;
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

export type StepRunStatus =
  | 'queued' | 'running' | 'completed'
  | 'failed' | 'needs_review' | 'cancelled' | 'skipped';

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
  result: StepRunResult;
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
  ticketId: string;
  templateId: string;
  triggeredBy: string;
  triggeredFrom: string;
}

export interface ResolveHumanGateInput {
  outcome: string;
  notes?: string;
}
