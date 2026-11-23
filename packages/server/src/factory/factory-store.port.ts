import type { FactoryFloorRow, FactoryItemRow, FactoryRunRow, FactoryTicketRow, IntakePullRow } from './types.js';

export interface FactoryStorePort {
  getFloor(id: string): Promise<FactoryFloorRow | null>;
  saveFloor(floor: FactoryFloorRow): Promise<void>;

  listTickets(floorId: string): Promise<FactoryTicketRow[]>;
  saveTicket(row: FactoryTicketRow): Promise<void>;
  removeTicket(ticketId: string): Promise<void>;
  /** Ids of every ticket handed over to the Factory: what the rest of Fleex should leave alone. */
  listManagedTicketIds(): Promise<string[]>;

  /** The items of a floor that are not archived: those on the floor. */
  listItems(floorId: string): Promise<FactoryItemRow[]>;
  /** The item of a conversation, archived or not. */
  getItemByKey(source: string, sourceKey: string): Promise<FactoryItemRow | null>;
  saveItem(row: FactoryItemRow): Promise<void>;
  /** The items archived at this exit (at any exit, with null) since then, the latest first. */
  listExitItems(floorId: string, machineId: string | null, sinceIso: string): Promise<FactoryItemRow[]>;
  /** How many items each intake dropped since then, by intake id. */
  countDropped(floorId: string, sinceIso: string): Promise<Record<string, number>>;

  /** Where each pulled intake of a floor stands: its last pull, its last error. */
  listIntakePulls(floorId: string): Promise<IntakePullRow[]>;
  saveIntakePull(row: IntakePullRow): Promise<void>;

  saveRun(run: FactoryRunRow): Promise<void>;
  /** A station's visit to an item, with what it answered (`ticketId` is the item's id). */
  saveItemRun(run: FactoryRunRow): Promise<void>;
  /** The visits to an item, oldest first. */
  listItemRuns(itemId: string): Promise<FactoryRunRow[]>;
  listRunsByTicket(ticketId: string): Promise<FactoryRunRow[]>;
  /** The floor's latest runs, newest first; only one machine's with `machineId`. */
  listRecentRuns(floorId: string, limit: number, machineId?: string): Promise<FactoryRunRow[]>;
  /** Every run that started or ended since `sinceIso`, oldest first: what the stats are computed from. */
  listRunsSince(floorId: string, sinceIso: string): Promise<FactoryRunRow[]>;
  countRunsSince(floorId: string, sinceIso: string): Promise<number>;
  /** After a restart no run is in flight any more: flag the ones left `running`, a ticket's or an item's. Returns their rows. */
  interruptRunningRuns(nowIso: string): Promise<FactoryRunRow[]>;
}
