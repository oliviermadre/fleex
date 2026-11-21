/**
 * What fills the pulled intakes (Gmail): each one, at its own interval (`everySec`), asks its source with its own
 * query for what came since its last pull, and hands every message to the floor (`FactoryEngine.ingest`, naming the
 * intake that saw it). One conversation stays one item whichever intakes see it; which of them keeps it is the
 * engine's to settle (the order they are served in, while the item waits on a dock).
 *
 * The first time an intake is seen, it starts from then: what was in the mailbox before is not poured onto the floor.
 * A pull looks back a little before its cursor (`PULL_OVERLAP_MS`), for what the source indexed late; what is seen
 * twice is nothing new to the floor (`ItemInput.at`). A pull that fails keeps its cursor and says why on the intake.
 */
import type { FactoryEngine } from './engine.js';
import type { MailMessage, MailSourcePort } from './mail-source.port.js';
import type { IntakeSpec, ItemInput } from './types.js';

export const PULL_OVERLAP_MS = 10 * 60_000;
/* how often due intakes are looked for; each is pulled at its own interval */
const SCAN_MS = 15_000;

export interface PullResult { pulled: number; new: number; updated: number; moved: number; error: string | null }

export function mailToItem(m: MailMessage): ItemInput {
  return {
    source: 'gmail', key: m.threadId, title: m.subject, author: m.from, excerpt: m.body, url: m.url, at: m.at,
    fields: { ...(m.to ? { to: m.to } : {}), ...(m.cc ? { cc: m.cc } : {}), labels: m.labels, attachment: m.attachments > 0 },
  };
}

export class IntakePuller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly busy = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: {
    engine: Pick<FactoryEngine, 'pulledIntakes' | 'recordPull' | 'ingest'>;
    mail: MailSourcePort | null;
    logger: { warn(msg: string, meta?: Record<string, unknown>): void };
    now?: () => number;
  }) {
    this.now = deps.now ?? Date.now;
  }

  /** Every `SCAN_MS`, the intakes that are due are pulled, while `active()` says the floor is on and loaded. */
  start(active: () => boolean): void {
    if (this.timer) return;
    this.timer = setInterval(() => { if (active()) void this.tick(); }, SCAN_MS);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Pull the intakes that are due: never pulled, or last asked longer ago than their interval (a failure waits as long). */
  async tick(): Promise<void> {
    const now = this.now();
    for (const { spec, pull } of this.deps.engine.pulledIntakes()) {
      if (this.busy.has(spec.id)) continue;
      if (pull && now - Date.parse(pull.updatedAt) < (spec.everySec ?? 300) * 1000) continue;
      await this.pull(spec.id);
    }
  }

  /** Pull one intake now (also its "Pull now" button). */
  async pull(intakeId: string): Promise<PullResult> {
    const out: PullResult = { pulled: 0, new: 0, updated: 0, moved: 0, error: null };
    const found = this.deps.engine.pulledIntakes().find((x) => x.spec.id === intakeId);
    if (!found) { out.error = 'No pulled intake with this id on the floor'; return out; }
    if (this.busy.has(intakeId)) return out;
    this.busy.add(intakeId);
    const { spec, pull } = found, started = new Date(this.now()).toISOString();
    try {
      /* first sight: from now on */
      if (!pull?.lastPulledAt) { await this.deps.engine.recordPull(intakeId, started, null); return out; }
      if (!this.deps.mail) throw new Error('No mail reader on this Fleex server');
      const since = new Date(Date.parse(pull.lastPulledAt) - PULL_OVERLAP_MS);
      const messages = await this.read(spec, since);
      for (const m of messages) {
        const r = await this.deps.engine.ingest(mailToItem(m), { intakeId });
        out.pulled++;
        if (r.status === 'new' || r.status === 'back') out.new++;
        else if (r.status === 'updated') out.updated++;
        else if (r.status === 'moved') out.moved++;
      }
      await this.deps.engine.recordPull(intakeId, started, null);
    } catch (err) {
      out.error = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn('Factory: an intake could not be pulled', { intakeId, error: out.error });
      await this.deps.engine.recordPull(intakeId, pull?.lastPulledAt ?? null, out.error).catch(() => undefined);
    } finally {
      this.busy.delete(intakeId);
    }
    return out;
  }

  private read(spec: IntakeSpec, since: Date): Promise<MailMessage[]> {
    if (spec.source !== 'gmail') throw new Error(`${spec.source} intakes are not pulled`);
    return this.deps.mail!.search(spec.query ?? '', since);
  }
}
