import type {
  Trigger, TriggerKind, TriggerConfig, TriggerTargetType, TriggerMode, TriggerRunStatus,
} from '@fleex/shared';
import { assertValidCron, nextCronTime } from '../services/cron.js';

const TARGET_TYPES: TriggerTargetType[] = ['agent', 'skill', 'panel', 'workflow'];
const MODES: TriggerMode[] = ['talk', 'plan', 'edit'];

export class TriggerEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public readonly slug: string,
    public emoji: string,
    public description: string,
    public readonly kind: TriggerKind,
    public config: TriggerConfig,
    public descriptionMd: string,
    public targetType: TriggerTargetType,
    public targetRef: string,
    public mode: TriggerMode,
    public enabled: boolean,
    public nextRunAt: Date | null,
    public lastRunAt: Date | null,
    public lastStatus: TriggerRunStatus | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    slug: string;
    emoji?: string;
    description?: string;
    kind?: TriggerKind;
    config: TriggerConfig;
    descriptionMd?: string;
    targetType: TriggerTargetType;
    targetRef: string;
    mode?: TriggerMode;
    enabled?: boolean;
  }): TriggerEntity {
    const now = new Date();
    const entity = new TriggerEntity(
      params.id,
      params.name,
      params.slug,
      params.emoji ?? '',
      params.description ?? '',
      params.kind ?? 'cron',
      params.config,
      params.descriptionMd ?? '',
      params.targetType,
      params.targetRef,
      params.mode ?? 'plan',
      params.enabled ?? true,
      null,
      null,
      null,
      now,
      now,
    );
    entity.validate();
    // Seed the first scheduled time so the scheduler can pick it up.
    entity.nextRunAt = entity.enabled ? entity.computeNextRun(now) : null;
    return entity;
  }

  /** Throws if the entity is structurally invalid. */
  validate(): void {
    if (!this.name.trim()) throw new Error('trigger name is required');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(this.slug)) {
      throw new Error(`invalid trigger slug "${this.slug}" (lowercase alphanumeric + dashes)`);
    }
    if (!TARGET_TYPES.includes(this.targetType)) {
      throw new Error(`invalid trigger targetType "${this.targetType}"`);
    }
    if (!this.targetRef.trim()) throw new Error('trigger targetRef is required');
    if (!MODES.includes(this.mode)) throw new Error(`invalid trigger mode "${this.mode}"`);

    if (this.kind === 'cron') {
      const cfg = this.config;
      if (cfg.scheduleKind === 'cron') {
        if (!cfg.scheduleExpr) throw new Error('cron trigger requires config.scheduleExpr');
        assertValidCron(cfg.scheduleExpr);
      } else if (cfg.scheduleKind === 'interval') {
        if (!cfg.intervalMs || cfg.intervalMs < 1000) {
          throw new Error('interval trigger requires config.intervalMs >= 1000');
        }
      } else {
        throw new Error(`invalid scheduleKind "${(cfg as { scheduleKind: string }).scheduleKind}"`);
      }
    }
  }

  /** Compute the next fire time strictly after `from`. */
  computeNextRun(from: Date): Date | null {
    const cfg = this.config;
    if (cfg.scheduleKind === 'interval') {
      return new Date(from.getTime() + (cfg.intervalMs ?? 0));
    }
    // cron
    return nextCronTime(cfg.scheduleExpr!, from, cfg.timezone ?? 'UTC');
  }

  /** True when the trigger is due to fire at `now`. */
  isDue(now: Date): boolean {
    return this.enabled && this.nextRunAt !== null && this.nextRunAt.getTime() <= now.getTime();
  }

  toDTO(): Trigger {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      emoji: this.emoji,
      description: this.description,
      kind: this.kind,
      config: this.config,
      descriptionMd: this.descriptionMd,
      targetType: this.targetType,
      targetRef: this.targetRef,
      mode: this.mode,
      enabled: this.enabled,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastStatus: this.lastStatus,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
