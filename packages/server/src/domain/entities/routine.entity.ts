import type {
  Routine, RunSubject, RoutineTrigger, RoutineOverlapPolicy, RoutineTarget,
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
    public target: RoutineTarget,
    public subject: RunSubject,
    public trigger: RoutineTrigger,
    public overlapPolicy: RoutineOverlapPolicy,
    public lastRunAt: Date | null,
    public lastRunId: string | null,
    public nextRunAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    /**
     * Which instance last won the race to fire a scheduled occurrence, and
     * when. Written only by {@link RoutineStorePort.claimDue}; defaulted here
     * so every existing positional construction keeps compiling.
     */
    public lastClaimedBy: string | null = null,
    public lastClaimedAt: Date | null = null,
  ) {}

  static create(params: {
    id: string;
    name: string;
    slug?: string;
    emoji?: string;
    description?: string | null;
    target: RoutineTarget;
    subject?: Partial<RunSubject>;
    trigger?: RoutineTrigger;
    overlapPolicy?: RoutineOverlapPolicy;
    enabled?: boolean;
  }): RoutineEntity {
    const name = params.name.trim();
    if (name.length === 0) throw new Error('Routine name is required');
    if (!params.target?.ref) throw new Error('Routine target is required');

    const now = new Date();
    return new RoutineEntity(
      params.id,
      params.slug ?? (slugify(name) || params.id),
      name,
      params.emoji ?? '⏰',
      params.description ?? null,
      params.enabled ?? true,
      params.target,
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
    target?: RoutineTarget;
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
    if (changes.target !== undefined) {
      if (!changes.target.ref) throw new Error('Routine target is required');
      this.target = changes.target;
    }
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
      target: this.target,
      subject: this.subject,
      trigger: this.trigger,
      overlapPolicy: this.overlapPolicy,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunId: this.lastRunId,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      lastClaimedBy: this.lastClaimedBy,
      lastClaimedAt: this.lastClaimedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
