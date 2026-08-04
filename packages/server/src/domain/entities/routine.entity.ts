import type {
  Routine, RunSubject, RoutineTrigger, RoutineOverlapPolicy,
} from '@fleex/shared';
import { normalizeRunSubject, slugify } from '@fleex/shared';

export class RoutineEntity {
  constructor(
    public readonly id: string,
    public slug: string,
    public name: string,
    public emoji: string,
    public description: string | null,
    public enabled: boolean,
    public templateId: string,
    public subject: RunSubject,
    public trigger: RoutineTrigger,
    public overlapPolicy: RoutineOverlapPolicy,
    public lastRunAt: Date | null,
    public lastRunId: string | null,
    public nextRunAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    slug?: string;
    emoji?: string;
    description?: string | null;
    templateId: string;
    subject?: Partial<RunSubject>;
    trigger?: RoutineTrigger;
    overlapPolicy?: RoutineOverlapPolicy;
    enabled?: boolean;
  }): RoutineEntity {
    const name = params.name.trim();
    if (name.length === 0) throw new Error('Routine name is required');
    if (!params.templateId) throw new Error('Routine templateId is required');

    const now = new Date();
    return new RoutineEntity(
      params.id,
      params.slug ?? (slugify(name) || params.id),
      name,
      params.emoji ?? '⏰',
      params.description ?? null,
      params.enabled ?? true,
      params.templateId,
      normalizeRunSubject(params.subject),
      params.trigger ?? { kind: 'manual' },
      params.overlapPolicy ?? 'skip',
      null,
      null,
      null,
      now,
      now,
    );
  }

  update(changes: {
    name?: string;
    emoji?: string;
    description?: string | null;
    templateId?: string;
    subject?: Partial<RunSubject>;
    trigger?: RoutineTrigger;
    overlapPolicy?: RoutineOverlapPolicy;
    enabled?: boolean;
  }): void {
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (name.length === 0) throw new Error('Routine name is required');
      this.name = name;
    }
    if (changes.emoji !== undefined) this.emoji = changes.emoji;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.templateId !== undefined) this.templateId = changes.templateId;
    // The subject is replaced wholesale, never merged: a partial merge would
    // make "remove the last repo" impossible to express.
    if (changes.subject !== undefined) this.subject = normalizeRunSubject(changes.subject);
    if (changes.trigger !== undefined) this.trigger = changes.trigger;
    if (changes.overlapPolicy !== undefined) this.overlapPolicy = changes.overlapPolicy;
    if (changes.enabled !== undefined) this.enabled = changes.enabled;
    this.updatedAt = new Date();
  }

  /** Arms (or disarms, with null) the next scheduled fire time. */
  schedule(nextRunAt: Date | null): void {
    this.nextRunAt = nextRunAt;
    this.updatedAt = new Date();
  }

  /**
   * A `once` routine has spent its single occurrence: disarm *and* disable it.
   * Clearing `next_run_at` alone would be enough for this process, but the row
   * outlives it — leaving `enabled = true` would let a future boot recompute
   * arm the same one-shot again.
   */
  consumeOneShot(): void {
    this.nextRunAt = null;
    this.enabled = false;
    this.updatedAt = new Date();
  }

  recordRun(runId: string, at: Date = new Date()): void {
    this.lastRunId = runId;
    this.lastRunAt = at;
    this.updatedAt = new Date();
  }

  /** Slug fragment used to name the routine's workspace and branch. */
  workspaceSlug(): string {
    return this.slug.replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'routine';
  }

  toDTO(): Routine {
    return {
      id: this.id,
      slug: this.slug,
      name: this.name,
      emoji: this.emoji,
      description: this.description,
      enabled: this.enabled,
      templateId: this.templateId,
      subject: this.subject,
      trigger: this.trigger,
      overlapPolicy: this.overlapPolicy,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunId: this.lastRunId,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
