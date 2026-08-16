/**
 * Reading a `JSONB` column back through `pg`.
 *
 * The driver already parses `JSONB` into a JS value, unlike SQLite where the
 * same column is `TEXT` and comes back as a string. Adapters shared between the
 * two dialects therefore cannot call `JSON.parse` unconditionally — doing so
 * throws on Postgres the moment the column holds an object.
 *
 * Tolerating both shapes rather than trusting the driver is deliberate: a
 * column written as `TEXT` by an older migration, or a value round-tripped
 * through a `::text` cast, still reads back correctly.
 */
export function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

/**
 * Reading a `TIMESTAMPTZ` back as an ISO-8601 string.
 *
 * `pg` returns a `Date`; PostgREST (Supabase) and SQLite both return a string.
 * Fields typed as `string` in the domain — `RoutineTrigger.runAt`, for instance
 * — need the string form, and `String(date)` would yield the local-timezone
 * human format instead of an instant.
 */
export function readIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
