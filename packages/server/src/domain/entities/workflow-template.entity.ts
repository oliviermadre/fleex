import type { WorkflowTemplate, WorkflowStep, WorkflowEdge } from '@fleex/shared';

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
      slug: params.slug,
      steps: params.steps,
      edges: params.edges,
      entryStepId: params.entryStepId,
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
    slug: string;
    steps: WorkflowStep[];
    edges: WorkflowEdge[];
    entryStepId: string;
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
