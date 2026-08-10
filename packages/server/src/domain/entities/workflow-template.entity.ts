import type {
  WorkflowTemplate, WorkflowStep, WorkflowEdge,
} from '@fleex/shared';
import { validateNativeSteps, validateEdgeConditions } from '@fleex/shared';

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

export class WorkflowTemplateEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public slug: string,
    public emoji: string,
    public description: string,
    public steps: WorkflowStep[],
    public edges: WorkflowEdge[],
    public entryStepId: string,
    public enabled: boolean,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    slug: string;
    emoji?: string;
    description?: string;
    steps: WorkflowStep[];
    edges: WorkflowEdge[];
    entryStepId: string;
    enabled?: boolean;
  }): WorkflowTemplateEntity {
    WorkflowTemplateEntity.validate({
      slug: params.slug, steps: params.steps, edges: params.edges, entryStepId: params.entryStepId,
    });
    const now = new Date();
    return new WorkflowTemplateEntity(
      params.id,
      params.name,
      params.slug,
      params.emoji ?? '',
      params.description ?? '',
      params.steps,
      params.edges,
      params.entryStepId,
      params.enabled ?? true,
      now,
      now,
    );
  }

  static validate(input: {
    slug: string; steps: WorkflowStep[]; edges: WorkflowEdge[]; entryStepId: string;
  }): void {
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new Error(`Invalid slug: must match ${SLUG_PATTERN}`);
    }
    if (input.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
    const stepIds = new Set(input.steps.map((s) => s.id));
    if (!stepIds.has(input.entryStepId)) {
      throw new Error(`entryStepId "${input.entryStepId}" not found in steps[]`);
    }
    for (const edge of input.edges) {
      if (!stepIds.has(edge.source)) {
        throw new Error(`edge ${edge.id} source "${edge.source}" not found in steps[]`);
      }
      if (!stepIds.has(edge.target)) {
        throw new Error(`edge ${edge.id} target "${edge.target}" not found in steps[]`);
      }
    }
    for (const step of input.steps) {
      if (step.executorType === 'human_gate') {
        if (!step.humanGateOutcomes || step.humanGateOutcomes.length < 2) {
          throw new Error(`step ${step.id}: human_gate must have at least two outcomes`);
        }
      }
    }

    // A trigger step is "how this run started" — placing it anywhere but the
    // entry (or having two) would make that statement meaningless, so both are
    // refused at save time rather than surprising at runtime.
    const triggerSteps = input.steps.filter((s) => s.executorType === 'trigger');
    if (triggerSteps.length > 1) {
      throw new Error('a workflow can have at most one trigger step');
    }
    const trigger = triggerSteps[0];
    if (trigger) {
      if (trigger.id !== input.entryStepId) {
        throw new Error(`step ${trigger.id}: a trigger step must be the workflow's entry step`);
      }
      if (input.edges.some((e) => e.target === trigger.id)) {
        throw new Error(`step ${trigger.id}: a trigger step cannot have incoming edges`);
      }
    }

    // Native steps: actions, parameters and `{{ … }}` references are checked at
    // save time so a misconfigured workflow can never reach a run. Warnings
    // (e.g. a reference to a step on a branch that may not run) are surfaced by
    // the editor only — they don't block saving.
    const { errors } = validateNativeSteps(input.steps, input.edges, input.entryStepId);
    if (errors.length > 0) throw new Error(errors.join('\n'));

    // Edge conditions get the same treatment: a clause pointing at a step that
    // never runs before the edge would silently route every run to the default
    // branch, which is exactly the kind of failure that is invisible at runtime.
    const edgeIssues = validateEdgeConditions(input.steps, input.edges, input.entryStepId);
    if (edgeIssues.errors.length > 0) throw new Error(edgeIssues.errors.join('\n'));
  }

  update(changes: {
    name?: string;
    slug?: string;
    emoji?: string;
    description?: string;
    steps?: WorkflowStep[];
    edges?: WorkflowEdge[];
    entryStepId?: string;
    enabled?: boolean;
  }): void {
    const next = {
      slug: changes.slug ?? this.slug,
      steps: changes.steps ?? this.steps,
      edges: changes.edges ?? this.edges,
      entryStepId: changes.entryStepId ?? this.entryStepId,
    };
    WorkflowTemplateEntity.validate(next);
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.slug !== undefined) this.slug = changes.slug;
    if (changes.emoji !== undefined) this.emoji = changes.emoji;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.steps !== undefined) this.steps = changes.steps;
    if (changes.edges !== undefined) this.edges = changes.edges;
    if (changes.entryStepId !== undefined) this.entryStepId = changes.entryStepId;
    if (changes.enabled !== undefined) this.enabled = changes.enabled;
    this.updatedAt = new Date();
  }

  toDTO(): WorkflowTemplate {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      emoji: this.emoji,
      description: this.description,
      steps: this.steps,
      edges: this.edges,
      entryStepId: this.entryStepId,
      enabled: this.enabled,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
