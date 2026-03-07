import type { DomainEventLogEntity } from '../../domain/entities/domain-event-log.entity.js';

export interface DomainEventLogStorePort {
  save(entry: DomainEventLogEntity): Promise<void>;
  list(params: {
    limit: number;
    before?: string;           // cursor pagination by ID
    eventType?: string;        // filter by type or prefix (e.g. 'ticket.')
    instanceId?: string;
    since?: Date;
    until?: Date;
  }): Promise<DomainEventLogEntity[]>;
  count(): Promise<number>;
  deleteOlderThan(date: Date): Promise<number>;
}
