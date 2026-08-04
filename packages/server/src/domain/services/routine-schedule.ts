import { CronExpressionParser } from 'cron-parser';
import type { RoutineTrigger } from '@fleex/shared';
import { InvalidRoutineTriggerError } from '../errors.js';

/**
 * Turns a routine trigger into fire times.
 *
 * Cron evaluation is delegated to `cron-parser` rather than hand-rolled: the
 * hard part is not the five fields, it is "09:00 Europe/Paris" across a DST
 * boundary — the day the clocks move, a naive UTC-offset evaluator fires an
 * hour early for six months. `cron-parser` resolves the expression in the IANA
 * zone (via luxon), which is exactly the property a daily routine needs.
 *
 * The whole module is pure: it never reads the clock on its own, callers pass
 * `from`. That is what lets the scheduler tests pin a fake "two hours after the
 * process died" without touching timers.
 */

/**
 * Seconds-resolution cron (6 fields) is refused rather than silently rounded:
 * the scheduler ticks every 60 s, so `*​/10 * * * * *` would fire once a minute
 * and the author would blame the engine, not the expression.
 */
const CRON_FIELD_COUNT = 5;

/** True when the string is an IANA zone this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a trigger, throwing {@link InvalidRoutineTriggerError} (HTTP 422)
 * on anything the scheduler could not act on. `manual` is always valid — it is
 * the "no schedule at all" case, not a degenerate schedule.
 */
export function assertTriggerValid(trigger: RoutineTrigger): void {
  if (trigger.kind === 'manual') return;

  if (!isValidTimezone(trigger.timezone)) {
    throw new InvalidRoutineTriggerError(`"${trigger.timezone}" is not a known IANA timezone`);
  }

  if (trigger.kind === 'once') {
    const at = new Date(trigger.runAt);
    if (Number.isNaN(at.getTime())) {
      throw new InvalidRoutineTriggerError(`runAt "${trigger.runAt}" is not a valid ISO date-time`);
    }
    return;
  }

  const expression = trigger.cron.trim();
  const fields = expression.split(/\s+/).filter(Boolean);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new InvalidRoutineTriggerError(
      `cron "${expression}" must have ${CRON_FIELD_COUNT} fields (minute hour day month weekday) — the scheduler ticks once a minute`,
    );
  }
  try {
    CronExpressionParser.parse(expression, { tz: trigger.timezone });
  } catch (err) {
    throw new InvalidRoutineTriggerError(
      `cron "${expression}" is not a valid expression: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The next `count` fire times strictly after `from`. Empty for `manual`, and at
 * most one entry for `once` (and none once its moment has passed). Powers both
 * the editor preview and the scheduler's own bookkeeping.
 *
 * Throws the same validation error as {@link assertTriggerValid}, so a caller
 * never gets a silently empty list out of a typo.
 */
export function nextRunTimes(trigger: RoutineTrigger, from: Date, count: number): Date[] {
  assertTriggerValid(trigger);
  if (trigger.kind === 'manual' || count <= 0) return [];

  if (trigger.kind === 'once') {
    const at = new Date(trigger.runAt);
    return at.getTime() > from.getTime() ? [at] : [];
  }

  const it = CronExpressionParser.parse(trigger.cron.trim(), {
    currentDate: from,
    tz: trigger.timezone,
  });
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(it.next().toDate());
  return out;
}

/**
 * The instant a routine should next fire, or null when it should not fire at
 * all (`manual`, or a `once` that already fired and was disabled).
 *
 * A `once` whose moment is already past keeps that past instant rather than
 * returning null: a one-shot the process slept through is a single missed
 * intent, so it fires exactly once at the next tick. That is deliberately NOT
 * the cron rule — see {@link nextCronRunAfter}.
 */
export function computeNextRunAt(trigger: RoutineTrigger, from: Date): Date | null {
  assertTriggerValid(trigger);
  if (trigger.kind === 'manual') return null;
  if (trigger.kind === 'once') return new Date(trigger.runAt);
  return nextRunTimes(trigger, from, 1)[0] ?? null;
}

/**
 * The next cron occurrence strictly after `from` — the anti-replay primitive.
 *
 * After a two-hour outage a `*​/5 * * * *` routine has 24 missed slots. Walking
 * them would spawn 24 agent runs at boot; we jump straight to the next slot
 * after *now* instead, so a restart costs exactly one run.
 */
export function nextCronRunAfter(trigger: RoutineTrigger, from: Date): Date | null {
  if (trigger.kind !== 'cron') return null;
  return nextRunTimes(trigger, from, 1)[0] ?? null;
}
