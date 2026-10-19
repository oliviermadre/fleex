import path from 'node:path';

/**
 * Placeholder accepted in a workspace's `FLEEX_SQLITE_PATH`, replaced at
 * `fleex start` by the instance slug (`workspace@branch`). One workspace then
 * yields one database file per instance — e.g. a `qa` workspace where the
 * branch under test and its `main` baseline (or two agents QA-ing in parallel)
 * never share a SQLite file, which would corrupt it (WAL) and apply one
 * branch's migrations to the other's data.
 */
export const INSTANCE_PLACEHOLDER = '{instance}';

/** True when the path is a per-instance template (contains `{instance}`). */
export function isPerInstanceSqlitePath(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.includes(INSTANCE_PLACEHOLDER);
}

/**
 * Resolve a `FLEEX_SQLITE_PATH` for a given instance: substitute `{instance}`
 * and expand a leading `~` (the server opens the path verbatim, it never
 * expands `~` itself). Pure — the caller creates the parent directory.
 */
export function expandSqlitePath(raw: string, instanceSlug: string, homedir: string): string {
  const substituted = raw.split(INSTANCE_PLACEHOLDER).join(instanceSlug);
  if (substituted === '~') return homedir;
  if (substituted.startsWith('~/')) return path.join(homedir, substituted.slice(2));
  return substituted;
}
