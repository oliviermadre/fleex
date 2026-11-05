import type { KvStorePort } from '../ports/kv-store.port.js';
import type { MissedSlot, MissedSlotRecorder } from '../../domain/services/routine-scheduler.js';

/** KV prefix of the missed routine slots (agenda R3). One key per slot. */
export const MISSED_SLOT_PREFIX = 'agenda:missed:';

export interface StoredMissedSlot {
  routineId: string;
  /** ISO instant of the slot that never fired. */
  slotAt: string;
  detectedAt: string;
  reason: 'scheduler_down';
}

export const missedSlotKey = (routineId: string, slotAt: Date | string) =>
  `${MISSED_SLOT_PREFIX}${routineId}:${typeof slotAt === 'string' ? slotAt : slotAt.toISOString()}`;

/**
 * Writes each missed slot under its own key, so detecting the same slot twice
 * (two instances booting on one storage) overwrites rather than duplicates.
 */
export class KvMissedSlotRecorder implements MissedSlotRecorder {
  constructor(private readonly kv: KvStorePort) {}

  async record(slots: MissedSlot[]): Promise<void> {
    for (const s of slots) {
      const value: StoredMissedSlot = {
        routineId: s.routineId,
        slotAt: s.slotAt.toISOString(),
        detectedAt: s.detectedAt.toISOString(),
        reason: 'scheduler_down',
      };
      await this.kv.set(missedSlotKey(s.routineId, s.slotAt), JSON.stringify(value));
    }
  }
}

/** Every recorded missed slot; unreadable rows are skipped. */
export async function listMissedSlots(kv: KvStorePort): Promise<StoredMissedSlot[]> {
  const rows = await kv.listByPrefix(MISSED_SLOT_PREFIX);
  const out: StoredMissedSlot[] = [];
  for (const { value } of rows) {
    try {
      const v = JSON.parse(value) as Partial<StoredMissedSlot>;
      if (typeof v.routineId === 'string' && typeof v.slotAt === 'string' && !Number.isNaN(Date.parse(v.slotAt))) {
        out.push({ routineId: v.routineId, slotAt: v.slotAt, detectedAt: String(v.detectedAt ?? v.slotAt), reason: 'scheduler_down' });
      }
    } catch {
      // a corrupted row is not worth failing the agenda for
    }
  }
  return out;
}
