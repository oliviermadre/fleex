import type { FactoryFloorRow, FactoryRunRow, FactoryTicketRow } from './types.js';

export interface FactoryStorePort {
  getFloor(id: string): Promise<FactoryFloorRow | null>;
  saveFloor(floor: FactoryFloorRow): Promise<void>;

  listTickets(floorId: string): Promise<FactoryTicketRow[]>;
  saveTicket(row: FactoryTicketRow): Promise<void>;
  removeTicket(ticketId: string): Promise<void>;
  /** Ids of every ticket handed over to the Factory: what the rest of Fleex should leave alone. */
  listManagedTicketIds(): Promise<string[]>;

  saveRun(run: FactoryRunRow): Promise<void>;
  listRunsByTicket(ticketId: string): Promise<FactoryRunRow[]>;
  listRecentRuns(floorId: string, limit: number): Promise<FactoryRunRow[]>;
  /** Every run that started or ended since `sinceIso`, oldest first: what the stats are computed from. */
  listRunsSince(floorId: string, sinceIso: string): Promise<FactoryRunRow[]>;
  countRunsSince(floorId: string, sinceIso: string): Promise<number>;
  /** After a restart no run is in flight any more: flag the ones left `running`. Returns their rows. */
  interruptRunningRuns(nowIso: string): Promise<FactoryRunRow[]>;
}
