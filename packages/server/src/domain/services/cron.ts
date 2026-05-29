/**
 * Minimal, dependency-free 5-field cron evaluator.
 *
 *   ┌ minute (0-59)
 *   │ ┌ hour (0-23)
 *   │ │ ┌ day-of-month (1-31)
 *   │ │ │ ┌ month (1-12)
 *   │ │ │ │ ┌ day-of-week (0-6, Sunday = 0)
 *   * * * * *
 *
 * Supports `*`, `a`, `a-b`, `* / n` (step), `a-b/n`, and comma lists.
 * Standard semantics: when BOTH day-of-month and day-of-week are restricted
 * (neither is `*`), a timestamp matches if EITHER field matches; otherwise
 * both must match.
 *
 * `nextCronTime` returns the next matching minute strictly after `from`,
 * evaluated against wall-clock time in `timezone` (IANA, default 'UTC').
 * Returns null if nothing matches within the lookahead window (≈366 days),
 * which indicates an unsatisfiable expression.
 */

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid step in cron field "${field}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*' || rangePart === undefined || rangePart === '') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const bounds = rangePart.split('-').map(Number);
      lo = bounds[0] ?? NaN;
      hi = bounds[1] ?? NaN;
    } else {
      lo = Number(rangePart);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`invalid range "${rangePart}" in cron field "${field}" (expected ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${parts.length}: "${expr}"`);
  }
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  return {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12),
    // Accept 0-7 for day-of-week and normalize 7 -> 0 (Sunday).
    dow: new Set([...parseField(dow, 0, 7)].map((d) => (d === 7 ? 0 : d))),
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

/** Validate a cron expression, throwing on malformed input. */
export function assertValidCron(expr: string): void {
  parseCron(expr);
}

interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function zonedParts(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  return {
    minute: Number(parts.minute),
    hour,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAY_INDEX[parts.weekday ?? 'Sun'] ?? 0,
  };
}

function matches(fields: CronFields, p: ZonedParts): boolean {
  if (!fields.minute.has(p.minute)) return false;
  if (!fields.hour.has(p.hour)) return false;
  if (!fields.month.has(p.month)) return false;

  const domMatch = fields.dom.has(p.day);
  const dowMatch = fields.dow.has(p.weekday);
  if (fields.domRestricted && fields.dowRestricted) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

const MINUTE_MS = 60_000;
const LOOKAHEAD_MINUTES = 366 * 24 * 60;

export function nextCronTime(expr: string, from: Date, timezone = 'UTC'): Date | null {
  const fields = parseCron(expr);
  // Start at the next whole minute strictly after `from`.
  let t = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let i = 0; i < LOOKAHEAD_MINUTES; i++) {
    const candidate = new Date(t);
    if (matches(fields, zonedParts(candidate, timezone))) return candidate;
    t += MINUTE_MS;
  }
  return null;
}
