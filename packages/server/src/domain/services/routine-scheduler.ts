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
 * What this instance intends to do with one due occurrence, decided before any
 * write so the decision and the claim can be a single compare-and-swap.
 */
type Occurrence =
  | { kind: 'launch'; nextRunAt: Date | null; disable: boolean }
  | { kind: 'skip'; activeRunId: string; nextRunAt: Date | null; disable: boolean }
  | { kind: 'hold' };

/**
 * Fires scheduled routines.
 *
 * Same shape as {@link RepositoryRefreshScheduler}: a single interval, a
 * re-entrancy guard so a slow tick never overlaps itself, setter-injected deps
 * (the routine use cases are built late in the container, after this service),
 * and a `.catch` inside the interval callback — an unhandled rejection there
 * would kill the ticker and silently stop every routine in the instance.
 *
 * Three rules carry the design:
 *
 *  1. **No missed-tick replay.** After an outage, a due routine fires *once*
 *     and its next slot is recomputed from `now`, not walked forward from the
 *     slot it missed. Replaying would turn a two-hour downtime into 24
 *     simultaneous agent runs — a self-inflicted thundering herd on every
 *     restart.
 *  2. **Claim before launching.** Several instances routinely share one
 *     storage — two machines on the same Supabase, or `~/.fleex/repo` plus a
 *     QA worktree on the same `fleex.db` — and they all see the same due row.
 *     Advancing `next_run_at` is therefore done *first*, as a CAS against the
 *     value this tick observed ({@link RoutineStorePort.claimDue}), and only
 *     the instance whose UPDATE matched a row is allowed to act. Reading the
 *     schedule, launching, and then advancing — the obvious order — leaves a
 *     window in which every instance believes the occurrence is still free.
 *  3. **Launching goes through {@link RunRoutineUseCase}.** The concurrency
 *     guard (`RoutineRunAlreadyActiveError`) and the `subjectSnapshot` freezing
 *     live there, and a scheduled launch must be indistinguishable from the
 *     manual Launch button apart from `triggeredBy`.
 *
 * Rule 2 also settles who owns which columns: the scheduler only ever writes
 * `next_run_at` (plus `enabled` for a spent one-shot) through narrow updates,
 * never through `save()`. A full-row upsert from a scheduler holding a row it
 * read seconds ago would erase the `last_run_id` a sibling instance had just
 * recorded.
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
    /** Identifies this process on the claims it wins. See `Routine.lastClaimedBy`. */
    private readonly instanceId: string = 'unknown',
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
    this.logger.info('Routine scheduler started', { intervalMs, instanceId: this.instanceId });
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
   *
   * When two instances share a storage, a late booter recomputing from *its*
   * own `now` can push a slot the earlier instance was still waiting on. That
   * is the accepted cost of recomputing from the clock rather than replaying,
   * and it stays bounded to one slot: edits already re-arm at edit time
   * (`UpdateRoutineUseCase`), so this pass only matters for a schedule changed
   * while every instance was down.
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
      await store.rearm(routine.id, next);
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
        // The witness for the CAS. `getDue` cannot return a null one, but the
        // claim is meaningless without it, so it is checked rather than forced.
        const observed = routine.nextRunAt;
        if (!observed) continue;

        const active = await runStore.getActiveByRoutine(routine.id);
        const occurrence = this.planOccurrence(routine, active?.id ?? null, now);

        // `hold` is the queue policy waiting for the routine to free up. It
        // writes nothing and announces nothing, so there is no side effect to
        // serialise and nothing to claim — whichever instance ticks once the
        // run ends will go through the claim then.
        if (occurrence.kind === 'hold') continue;

        const won = await store.claimDue({
          id: routine.id,
          observedNextRunAt: observed,
          nextRunAt: occurrence.nextRunAt,
          ...(occurrence.disable ? { disable: true } : {}),
          claimedBy: this.instanceId,
          claimedAt: now,
        });
        if (!won) {
          // Another instance took this occurrence between our read and our
          // write. Not an error — it is the mechanism working.
          this.logger.debug('Routine occurrence claimed by another instance', {
            routineId: routine.id, slug: routine.slug, dueAt: observed.toISOString(),
          });
          continue;
        }

        if (occurrence.kind === 'skip') this.announceSkip(routine, occurrence.activeRunId);
        else await this.launch(routine);
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Decides what to do with a due occurrence, and where its schedule lands —
   * without writing anything, so the caller can turn the whole decision into
   * one atomic claim.
   *
   * `skip` drops the occurrence and moves on to the next slot — the honest
   * reading of "this routine may not overlap itself". `queue` holds it: the
   * schedule is left in the past so the next tick that finds the routine free
   * runs it. That is a queue of depth one, which is all the schema can express,
   * and enough for "run it as soon as the routine is free". A queued occurrence
   * deliberately does not survive a restart — the boot recompute re-arms
   * forward, same anti-herd rule as above.
   *
   * A one-shot is both disarmed and disabled, whichever branch it takes.
   * Clearing `next_run_at` alone would be enough for this process, but the row
   * outlives it — leaving `enabled = true` would let a future boot recompute
   * arm the same one-shot again. And skipping a one-shot drops it for good:
   * retrying every minute until the active run ends would silently turn a
   * single intent into a poller.
   */
  private planOccurrence(routine: RoutineEntity, activeRunId: string | null, now: Date): Occurrence {
    if (activeRunId && routine.overlapPolicy !== 'skip') return { kind: 'hold' };

    const oneShot = routine.trigger.kind === 'once';
    const landing = {
      nextRunAt: oneShot ? null : nextCronRunAfter(routine.trigger, now),
      disable: oneShot,
    };
    return activeRunId
      ? { kind: 'skip', activeRunId, ...landing }
      : { kind: 'launch', ...landing };
  }

  private announceSkip(routine: RoutineEntity, activeRunId: string): void {
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

  /**
   * Runs the occurrence this instance has already claimed.
   *
   * Nothing here touches the schedule: the claim advanced it, which is also why
   * a failed launch cannot turn into a 60-second retry loop — the routine whose
   * template was deleted has already moved on to its next slot.
   */
  private async launch(routine: RoutineEntity): Promise<void> {
    try {
      const run = await this.runRoutine!.execute({
        routineId: routine.id,
        triggeredBy: SCHEDULER_TRIGGERED_BY,
        triggeredFrom: 'schedule',
      });
      // `routine.run_started` is emitted by RunRoutineUseCase, not here: it is
      // the door every launch goes through, so manual launches get it too.
      this.logger.info('Routine launched on schedule', {
        routineId: routine.id, slug: routine.slug,
        workflowRunId: run.id, triggerKind: routine.trigger.kind,
      });
    } catch (err) {
      this.logger.error('Scheduled routine launch failed', {
        routineId: routine.id, slug: routine.slug, error: String(err),
      });
    }
  }
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
