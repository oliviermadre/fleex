import { hostname } from 'node:os';

export interface InstanceIdentity {
  /**
   * Stable routing key for this Fleex instance. Stamped on every execution row it
   * owns, and on every audit-trail entry it writes.
   *
   * Must be stable across restarts: the startup sweep reclaims orphaned runs by
   * matching on it, so an ephemeral value would leave rows stuck as `running`.
   */
  readonly id: string;
  /** Human-facing name, shown as "runs on ⟨label⟩" when a run isn't local. */
  readonly label: string;
}

let cached: InstanceIdentity | null = null;

/**
 * Resolve this process's instance identity, once.
 *
 * Single definition on purpose: the audit trail and the execution-ownership
 * columns used to derive `hostname:port` independently, and the hub's fan-out
 * filter used a per-process random UUID. Only the hub filter wants an ephemeral
 * value (it just needs "not me"); everything that outlives the process needs
 * this one.
 */
export function resolveInstanceIdentity(): InstanceIdentity {
  if (cached) return cached;
  const label = process.env['FLEEX_INSTANCE_LABEL']?.trim() || hostname();
  const id = process.env['FLEEX_INSTANCE_ID']?.trim() || `${hostname()}:${process.env['PORT'] ?? '3000'}`;
  cached = { id, label };
  return cached;
}

/** Test seam — drops the memoized value so env changes take effect. */
export function resetInstanceIdentityForTests(): void {
  cached = null;
}
