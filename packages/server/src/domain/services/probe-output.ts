import type { ActionStatus, ProbeParseSource } from '@fleex/shared';

export const PROBE_TOOLTIP_MAX_CHARS = 2000;
export const PROBE_TOOLTIP_MAX_LINES = 20;
export const PROBE_BADGE_MAX_CHARS = 6;

const STATUSES = new Set<ActionStatus>(['ok', 'warn', 'ko', 'unknown']);

export interface ProbeOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  /** Spawn / gateway failure — the probe never produced an exit code. */
  error?: string;
}

export interface ParsedProbe {
  status: ActionStatus;
  tooltip?: string;
  badge?: string;
  source: ProbeParseSource;
}

/**
 * Turn a probe's raw output into a status, in a fixed order of precedence:
 *
 * 1. stdout is a JSON object with a valid `status` → it is authoritative, so a
 *    probe can say "warn" or attach a tooltip/badge regardless of its exit code;
 * 2. otherwise the exit code decides (0 → ok, anything else → ko) and the text
 *    output becomes the tooltip;
 * 3. a timeout or spawn failure is `unknown`, never `ko`: it proves nothing about
 *    the tool being checked, and a red dot would send the user to fix something
 *    that may well be fine.
 */
export function parseProbeOutput(outcome: ProbeOutcome): ParsedProbe {
  if (outcome.error) {
    return { status: 'unknown', tooltip: `Probe failed: ${outcome.error}`, source: 'error' };
  }
  if (outcome.timedOut) {
    return { status: 'unknown', tooltip: 'Probe failed: timeout', source: 'error' };
  }

  const json = parseJsonObject(outcome.stdout);
  if (json && typeof json['status'] === 'string' && STATUSES.has(json['status'] as ActionStatus)) {
    const tooltip = typeof json['tooltip'] === 'string' ? clampTooltip(json['tooltip']) : undefined;
    const badge = typeof json['badge'] === 'string' || typeof json['badge'] === 'number'
      ? clampBadge(String(json['badge']))
      : undefined;
    return {
      status: json['status'] as ActionStatus,
      ...(tooltip ? { tooltip } : {}),
      ...(badge ? { badge } : {}),
      source: 'json',
    };
  }

  const text = outcome.stdout.trim() || outcome.stderr.trim();
  const tooltip = text ? clampTooltip(text) : undefined;
  return {
    status: outcome.exitCode === 0 ? 'ok' : 'ko',
    ...(tooltip ? { tooltip } : {}),
    source: 'exit-code',
  };
}

function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  // zsh's `echo` expands `\n` into a real newline, so `echo '{"tooltip":"a\nb"}'`
  // — the natural way to write a probe — prints a raw line break inside a JSON
  // string, which JSON.parse rejects. Retry with control characters escaped
  // before giving up and falling back to the exit code.
  for (const candidate of [trimmed, trimmed.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function clampTooltip(text: string): string {
  const lines = text.trim().split('\n');
  const kept = lines.length > PROBE_TOOLTIP_MAX_LINES ? lines.slice(0, PROBE_TOOLTIP_MAX_LINES) : lines;
  const joined = kept.join('\n');
  return joined.length > PROBE_TOOLTIP_MAX_CHARS ? joined.slice(0, PROBE_TOOLTIP_MAX_CHARS) : joined;
}

function clampBadge(badge: string): string | undefined {
  const trimmed = badge.trim();
  if (!trimmed) return undefined;
  return trimmed.length > PROBE_BADGE_MAX_CHARS ? trimmed.slice(0, PROBE_BADGE_MAX_CHARS) : trimmed;
}
