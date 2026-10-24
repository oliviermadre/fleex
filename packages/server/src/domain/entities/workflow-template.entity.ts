import type {
  WorkflowTemplate, WorkflowStep, WorkflowEdge,
} from '@fleex/shared';
import { validateWorkflow } from '@fleex/shared';

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
    WorkflowTemplateEntity.validate(params);
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

  /**
   * Save-time validation, delegated to the shared invariant registry
   * (`validateWorkflow`, profile `save` — what the web editor has always been
   * allowed to save). Every error is thrown at once, one per line, instead of
   * the first one only.
   */
  static validate(input: {
    slug: string; name: string; emoji?: string; description?: string;
    steps: WorkflowStep[]; edges: WorkflowEdge[]; entryStepId: string;
  }): void {
    const { errors } = validateWorkflow(
      {
        slug: input.slug,
        name: input.name,
        emoji: input.emoji ?? '',
        description: input.description ?? '',
        entryStepId: input.entryStepId,
        steps: input.steps,
        edges: input.edges,
      },
      { caps: null },
      'save',
    );
    if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('\n'));
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
      name: changes.name ?? this.name,
      emoji: changes.emoji ?? this.emoji,
      description: changes.description ?? this.description,
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
