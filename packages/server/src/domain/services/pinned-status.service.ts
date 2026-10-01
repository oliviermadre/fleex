import {
  PROBE_DEFAULT_INTERVAL_SEC,
  PROBE_DEFAULT_TIMEOUT_SEC,
  PROBE_MAX_TIMEOUT_SEC,
  PROBE_MIN_INTERVAL_SEC,
} from '@fleex/shared';
import type { PinnedIcon, ProbeTestResult, StatusProbe, StatusSnapshot } from '@fleex/shared';
import { parseProbeOutput, type ProbeOutcome } from './probe-output.js';

export const MAX_CONCURRENT_PROBES = 4;
/** Grace on top of the probe timeout before we stop waiting on the gateway itself. */
const GATEWAY_GRACE_MS = 5_000;

export type ProbeExecFn = (command: string, options: { cwd: string; timeoutMs: number }) => Promise<ProbeOutcome>;

export interface PinnedStatusDeps {
  exec: ProbeExecFn;
  /** Where probes run — the gateway user's home directory. */
  cwd: string;
  broadcast: (type: 'pinned-status:snapshot' | 'pinned-status:update', data: unknown) => void;
  logger?: { debug?: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
  now?: () => Date;
  maxConcurrent?: number;
}

interface Entry {
  probe: Required<StatusProbe>;
  timer: ReturnType<typeof setInterval> | null;
  /** Bumped whenever the probe definition changes, so a stale in-flight result is dropped. */
  generation: number;
  snapshot: StatusSnapshot;
}

export function normaliseProbe(probe: StatusProbe): Required<StatusProbe> {
  const interval = Number.isFinite(probe.intervalSec) ? probe.intervalSec : PROBE_DEFAULT_INTERVAL_SEC;
  const timeout = Number.isFinite(probe.timeoutSec) ? (probe.timeoutSec as number) : PROBE_DEFAULT_TIMEOUT_SEC;
  return {
    command: probe.command,
    intervalSec: Math.max(PROBE_MIN_INTERVAL_SEC, Math.round(interval)),
    timeoutSec: Math.min(PROBE_MAX_TIMEOUT_SEC, Math.max(1, Math.round(timeout))),
  };
}

/** Icons that should be probed: enabled, with a non-empty probe command. */
function probedIcons(icons: readonly PinnedIcon[] | undefined): Map<string, Required<StatusProbe>> {
  const out = new Map<string, Required<StatusProbe>>();
  for (const icon of icons ?? []) {
    if (icon.enabled === false) continue;
    if (!icon.status?.command?.trim()) continue;
    out.set(icon.id, normaliseProbe(icon.status));
  }
  return out;
}

/**
 * Runs the pinned icons' status probes on this server's host and pushes the
 * results to every connected client.
 *
 * Probing is server-side so N open tabs cost one execution, and it pauses while
 * nobody is connected: an auth check every minute on a laptop nobody is looking
 * at is pure waste (and some CLIs log or rate-limit each call). The moment a
 * client connects, every probe fires so the first paint is fresh rather than
 * up to one interval stale.
 *
 * Each server probes its own host on purpose — auth state is per machine — so
 * nothing here goes through the event hub or takes a claim.
 */
export class PinnedStatusService {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Set<string>();
  private readonly queue: string[] = [];
  private clients = 0;
  private readonly maxConcurrent: number;

  constructor(private readonly deps: PinnedStatusDeps) {
    this.maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT_PROBES;
  }

  /** (Re)programme probes from the current config. Unchanged probes keep their timer and state. */
  configure(icons: readonly PinnedIcon[] | undefined): void {
    const wanted = probedIcons(icons);
    let changed = false;

    for (const [id, entry] of this.entries) {
      if (!wanted.has(id)) {
        this.clearTimer(entry);
        this.entries.delete(id);
        this.dequeue(id);
        changed = true;
      }
    }

    for (const [id, probe] of wanted) {
      const existing = this.entries.get(id);
      if (existing && sameProbe(existing.probe, probe)) continue;
      changed = true;
      if (existing) this.clearTimer(existing);
      const entry: Entry = {
        probe,
        timer: null,
        generation: (existing?.generation ?? 0) + 1,
        snapshot: { iconId: id, status: 'unknown', probing: false },
      };
      this.entries.set(id, entry);
      this.dequeue(id);
      if (this.active) {
        this.startTimer(id, entry);
        this.request(id);
      }
    }

    if (changed) this.deps.broadcast('pinned-status:snapshot', this.getSnapshots());
  }

  clientConnected(): void {
    this.clients += 1;
    if (this.clients !== 1) return;
    for (const [id, entry] of this.entries) {
      this.startTimer(id, entry);
      this.request(id);
    }
  }

  clientDisconnected(): void {
    this.clients = Math.max(0, this.clients - 1);
    if (this.clients !== 0) return;
    for (const entry of this.entries.values()) this.clearTimer(entry);
    this.queue.length = 0;
  }

  getSnapshots(): StatusSnapshot[] {
    return [...this.entries.values()].map((e) => ({ ...e.snapshot }));
  }

  hasProbe(iconId: string): boolean {
    return this.entries.has(iconId);
  }

  /** Probe now, out of band (manual refresh, or right after an action ran). */
  refresh(iconId: string): boolean {
    if (!this.entries.has(iconId)) return false;
    this.request(iconId);
    return true;
  }

  refreshAll(): void {
    for (const id of this.entries.keys()) this.request(id);
  }

  /** Run a probe command once without persisting or broadcasting anything — the Settings "Test" button. */
  async test(command: string, timeoutSec?: number): Promise<ProbeTestResult> {
    const probe = normaliseProbe({ command, intervalSec: PROBE_DEFAULT_INTERVAL_SEC, timeoutSec });
    const started = Date.now();
    const outcome = await this.execProbe(probe);
    const parsed = parseProbeOutput(outcome);
    return {
      snapshot: {
        iconId: 'test',
        status: parsed.status,
        ...(parsed.tooltip ? { tooltip: parsed.tooltip } : {}),
        ...(parsed.badge ? { badge: parsed.badge } : {}),
        checkedAt: this.now().toISOString(),
        durationMs: Date.now() - started,
        probing: false,
      },
      source: parsed.source,
      stdout: outcome.stdout,
      stderr: outcome.error ?? outcome.stderr,
      exitCode: outcome.exitCode,
    };
  }

  stop(): void {
    for (const entry of this.entries.values()) this.clearTimer(entry);
    this.entries.clear();
    this.queue.length = 0;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private get active(): boolean {
    return this.clients > 0;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private startTimer(id: string, entry: Entry): void {
    this.clearTimer(entry);
    entry.timer = setInterval(() => this.request(id), entry.probe.intervalSec * 1000);
    // Never keep the process alive just to probe.
    (entry.timer as { unref?: () => void }).unref?.();
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer) clearInterval(entry.timer);
    entry.timer = null;
  }

  private dequeue(id: string): void {
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** At most one probe per icon at a time: a tick that lands while one runs is skipped, not stacked. */
  private request(id: string): void {
    if (!this.entries.has(id)) return;
    if (this.inFlight.has(id) || this.queue.includes(id)) return;
    if (this.inFlight.size >= this.maxConcurrent) {
      this.queue.push(id);
      return;
    }
    void this.run(id);
  }

  private async run(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    const generation = entry.generation;
    this.inFlight.add(id);
    entry.snapshot = { ...entry.snapshot, probing: true };
    this.deps.broadcast('pinned-status:update', { ...entry.snapshot });
    const started = Date.now();

    let outcome: ProbeOutcome;
    try {
      outcome = await this.execProbe(entry.probe);
    } finally {
      this.inFlight.delete(id);
    }

    const current = this.entries.get(id);
    if (current && current.generation === generation) {
      const parsed = parseProbeOutput(outcome);
      current.snapshot = {
        iconId: id,
        status: parsed.status,
        ...(parsed.tooltip ? { tooltip: parsed.tooltip } : {}),
        ...(parsed.badge ? { badge: parsed.badge } : {}),
        checkedAt: this.now().toISOString(),
        durationMs: Date.now() - started,
        probing: false,
      };
      this.deps.logger?.debug?.('Pinned status probed', { iconId: id, status: parsed.status });
      this.deps.broadcast('pinned-status:update', { ...current.snapshot });
    }

    this.drain();
  }

  private drain(): void {
    while (this.inFlight.size < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (this.entries.has(next) && !this.inFlight.has(next)) void this.run(next);
    }
  }

  private async execProbe(probe: Required<StatusProbe>): Promise<ProbeOutcome> {
    const timeoutMs = probe.timeoutSec * 1000;
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.deps.exec(probe.command, { cwd: this.deps.cwd, timeoutMs }),
        new Promise<ProbeOutcome>((resolve) => {
          guard = setTimeout(
            () => resolve({ stdout: '', stderr: '', exitCode: 1, timedOut: true }),
            timeoutMs + GATEWAY_GRACE_MS,
          );
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn('Pinned status probe failed to run', { error: message });
      return { stdout: '', stderr: '', exitCode: 1, error: message };
    } finally {
      if (guard) clearTimeout(guard);
    }
  }
}

function sameProbe(a: Required<StatusProbe>, b: Required<StatusProbe>): boolean {
  return a.command === b.command && a.intervalSec === b.intervalSec && a.timeoutSec === b.timeoutSec;
}
