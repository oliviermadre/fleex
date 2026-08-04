import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { RoutineStorePort } from '../../application/ports/routine-store.port.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { RunRoutineUseCase } from '../../application/use-cases/run-routine.js';
import type { EventBus } from '../../application/event-bus.js';
import type { RoutineEntity } from '../entities/routine.entity.js';
import { computeNextRunAt, nextCronRunAfter } from './routine-schedule.js';

/** How often the tick runs. A minute is the resolution a 5-field cron promises. */
export const ROUTINE_TICK_INTERVAL_MS = 60_000;

export const SCHEDULER_TRIGGERED_BY = 'routine-scheduler';

/**
 * Fires scheduled routines.
 *
 * Same shape as {@link RepositoryRefreshScheduler}: a single interval, a
 * re-entrancy guard so a slow tick never overlaps itself, setter-injected deps
 * (the routine use cases are built late in the container, after this service),
 * and a `.catch` inside the interval callback — an unhandled rejection there
 * would kill the ticker and silently stop every routine in the instance.
 *
 * Two rules carry the design:
 *
 *  1. **No missed-tick replay.** After an outage, a due routine fires *once*
 *     and its next slot is recomputed from `now`, not walked forward from the
 *     slot it missed. Replaying would turn a two-hour downtime into 24
 *     simultaneous agent runs — a self-inflicted thundering herd on every
 *     restart.
 *  2. **Launching goes through {@link RunRoutineUseCase}.** The concurrency
 *     guard (`RoutineRunAlreadyActiveError`) and the `subjectSnapshot` freezing
 *     live there, and a scheduled launch must be indistinguishable from the
 *     manual Launch button apart from `triggeredBy`.
 */
export class RoutineSchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private routineStore: RoutineStorePort | null = null;
  private runStore: WorkflowRunStorePort | null = null;
  private runRoutine: RunRoutineUseCase | null = null;
  /** Resolved once the boot recompute is done; every tick awaits it. */
  private booting: Promise<void> | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
  ) {}

  setDeps(deps: {
    routineStore: RoutineStorePort;
    runStore: WorkflowRunStorePort;
    runRoutine: RunRoutineUseCase;
  }): void {
    this.routineStore = deps.routineStore;
    this.runStore = deps.runStore;
    this.runRoutine = deps.runRoutine;
  }

  /**
   * Bridges the workflow lifecycle back to the routine one: a routine run that
   * finishes emits `routine.run_completed` so the /routines screen updates
   * without polling. Called once from the container — the workflow events carry
   * `routineId`, which no ticket-keyed broadcast would ever surface.
   */
  registerBusHandlers(bus: EventBus): void {
    const relay = (status: 'completed' | 'failed' | 'cancelled') => (e: { type: string }) => {
      const evt = e as { routineId?: string | null; workflowRunId?: string };
      if (!evt.routineId || !evt.workflowRunId) return;
      this.eventBus.emit({
        type: 'routine.run_completed',
        routineId: evt.routineId,
        workflowRunId: evt.workflowRunId,
        status,
        occurredAt: new Date(),
      });
    };
    bus.on('workflow.run_completed', relay('completed'));
    bus.on('workflow.run_failed', relay('failed'));
    bus.on('workflow.run_cancelled', relay('cancelled'));
  }

  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;

    // Boot recompute before the first tick: a routine whose cron was edited
    // while the process was down carries a `next_run_at` from the old
    // expression. Ticks await this, so they can never race it.
    this.booting = this.recomputeAll().catch((err) => {
      this.logger.error('Routine boot recompute failed', { error: String(err) });
    });

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error('Routine scheduler tick failed', { error: String(err) });
      });
    }, intervalMs);
    this.logger.info('Routine scheduler started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Re-derives `next_run_at` for every enabled routine from `now`.
   *
   * This is where "no replay" is enforced at boot: a cron routine that slept
   * through 24 slots is re-armed on the next future slot, not on the oldest
   * missed one. A `once` keeps its (possibly past) instant — a one-shot is a
   * single intent, not a herd, so it still fires exactly once.
   */
  async recomputeAll(now: Date = new Date()): Promise<void> {
    const store = this.routineStore;
    if (!store) return;

    const routines = await store.getEnabled();
    for (const routine of routines) {
      let next: Date | null;
      try {
        next = computeNextRunAt(routine.trigger, now);
      } catch (err) {
        // A row written before a validation rule tightened. Disarm rather than
        // crash the boot — the routine shows as unscheduled instead of taking
        // the whole scheduler down.
        this.logger.warn('Routine has an unusable trigger — leaving it unscheduled', {
          routineId: routine.id, slug: routine.slug, error: String(err),
        });
        next = null;
      }
      if (sameInstant(routine.nextRunAt, next)) continue;
      routine.schedule(next);
      await store.save(routine);
    }
  }

  /** One scheduling pass. Public so tests can drive it without timers. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      if (this.booting) await this.booting;
      const store = this.routineStore;
      const runStore = this.runStore;
      const runRoutine = this.runRoutine;
      if (!store || !runStore || !runRoutine) return;

      for (const routine of await store.getDue(now)) {
        const active = await runStore.getActiveByRoutine(routine.id);
        if (active) {
          await this.handleOverlap(routine, active.id, now);
          continue;
        }
        await this.launch(routine, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * A slot came due while the previous run is still in flight.
   *
   * `skip` drops the occurrence and moves on to the next slot — the honest
   * reading of "this routine may not overlap itself". `queue` leaves
   * `next_run_at` in the past so the very next tick retries: a queue of depth
   * one, which is all the schema can express, and enough for "run it as soon as
   * the routine is free". A queued occurrence deliberately does not survive a
   * restart — the boot recompute re-arms forward, same anti-herd rule as above.
   */
  private async handleOverlap(routine: RoutineEntity, activeRunId: string, now: Date): Promise<void> {
    if (routine.overlapPolicy !== 'skip') return;

    if (routine.trigger.kind === 'once') {
      // Skipping a one-shot means dropping it for good: retrying every minute
      // until the active run ends would silently turn it into a poller.
      routine.consumeOneShot();
    } else {
      routine.schedule(nextCronRunAfter(routine.trigger, now));
    }
    await this.routineStore!.save(routine);

    this.eventBus.emit({
      type: 'routine.run_skipped',
      routineId: routine.id,
      routineSlug: routine.slug,
      activeRunId,
      reason: 'overlap',
      occurredAt: new Date(),
    });
    this.logger.info('Routine tick skipped — a run is still active', {
      routineId: routine.id, slug: routine.slug, activeRunId,
    });
  }

  private async launch(routine: RoutineEntity, now: Date): Promise<void> {
    const store = this.routineStore!;
    const triggerKind = routine.trigger.kind;

    let workflowRunId: string | null = null;
    try {
      const run = await this.runRoutine!.execute({
        routineId: routine.id,
        triggeredBy: SCHEDULER_TRIGGERED_BY,
        triggeredFrom: 'schedule',
      });
      workflowRunId = run.id;
    } catch (err) {
      // A failed launch must still advance the schedule, otherwise a routine
      // whose template was deleted retries every 60 s forever.
      this.logger.error('Scheduled routine launch failed', {
        routineId: routine.id, slug: routine.slug, error: String(err),
      });
    }

    // Reload: RunRoutineUseCase saved its own instance (lastRunId / lastRunAt).
    // Saving the stale one we are holding would erase that.
    const fresh = (await store.getById(routine.id)) ?? routine;
    if (triggerKind === 'once') {
      fresh.consumeOneShot();
    } else {
      fresh.schedule(nextCronRunAfter(fresh.trigger, now));
    }
    await store.save(fresh);

    if (!workflowRunId) return;
    this.eventBus.emit({
      type: 'routine.run_started',
      routineId: routine.id,
      routineSlug: routine.slug,
      workflowRunId,
      triggerKind,
      occurredAt: new Date(),
    });
    this.logger.info('Routine launched on schedule', {
      routineId: routine.id, slug: routine.slug, workflowRunId, triggerKind,
    });
  }
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
