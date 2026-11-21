import { randomUUID } from 'node:crypto';
import type { FactorySnapshot } from './engine.js';

/**
 * What changed on the floor since the last patch, for the pages that watch it live (the `factory` WS channel).
 *
 * A patch carries whole tickets, never fields: applying it twice, or on a snapshot that already holds part of it,
 * gives the same floor. `seq` counts the patches; the snapshot routes say which `seq` they are at, so a page knows
 * which patches it already holds (`seq` at most its own) and when it missed one (a gap): it then reads the whole
 * floor again. `epoch` names the feed: a server that restarted counts from 0 again, under another epoch.
 */
export interface FactoryPatch {
  epoch: string;
  seq: number;
  /** Tickets that came onto the floor or changed, whole. */
  tickets: FactorySnapshot['tickets'];
  /** Tickets that left the floor. */
  removed: string[];
  /** The floor (layout, settings, name), only when it changed. */
  floor?: FactorySnapshot['floor'];
  /** Every arm: they are few, and a page extrapolates their swing from the time the patch came. */
  arms: FactorySnapshot['arms'];
  armSwing: FactorySnapshot['armSwing'];
  beltSpeed: FactorySnapshot['beltSpeed'];
  fastBelt: FactorySnapshot['fastBelt'];
  runsLastHour: number;
  running: number;
  notice?: string | null;
  /** What each intake dropped over the last 24 hours, by its id: every intake's, as arms are. */
  intakes?: FactorySnapshot['intakes'];
  serverTime: string;
}

export class FactoryFeed {
  readonly epoch = randomUUID();
  private seqNo = 0;
  private sent = new Map<string, string>();
  private floorKey = '';
  private restKey = '';

  /** The last patch made: a snapshot taken now holds everything up to it. */
  get seq(): number { return this.seqNo; }

  /** What changed in `snap` since the last patch, or null when nothing did (the server's clock aside). */
  diff(snap: FactorySnapshot): FactoryPatch | null {
    const tickets: FactorySnapshot['tickets'] = [], live = new Set<string>(), keys = new Map<string, string>();
    for (const t of snap.tickets) {
      live.add(t.ticketId);
      const key = JSON.stringify(t);
      if (this.sent.get(t.ticketId) !== key) { tickets.push(t); keys.set(t.ticketId, key); }
    }
    const removed = [...this.sent.keys()].filter((id) => !live.has(id));
    const floorKey = JSON.stringify(snap.floor);
    const rest = { arms: snap.arms, armSwing: snap.armSwing, beltSpeed: snap.beltSpeed, fastBelt: snap.fastBelt, runsLastHour: snap.runsLastHour, running: snap.running, notice: snap.notice ?? null, intakes: snap.intakes ?? {} };
    const restKey = JSON.stringify(rest);
    if (!tickets.length && !removed.length && floorKey === this.floorKey && restKey === this.restKey) return null;

    for (const [id, key] of keys) this.sent.set(id, key);
    for (const id of removed) this.sent.delete(id);
    const floorChanged = floorKey !== this.floorKey;
    this.floorKey = floorKey; this.restKey = restKey;
    return { epoch: this.epoch, seq: ++this.seqNo, tickets, removed, ...(floorChanged ? { floor: snap.floor } : {}), ...rest, serverTime: snap.serverTime };
  }
}
