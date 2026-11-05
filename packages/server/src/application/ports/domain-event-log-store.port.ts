import type { DomainEventLogEntity } from '../../domain/entities/domain-event-log.entity.js';

export interface DomainEventLogStorePort {
  save(entry: DomainEventLogEntity): Promise<void>;
  list(params: {
    limit: number;
    before?: string;           // cursor pagination by ID
    eventType?: string;        // exact type, or a family without the dot: 'ticket' matches 'ticket.*' (adapters add the '.%')
    instanceId?: string;
    since?: Date;
    until?: Date;
  }): Promise<DomainEventLogEntity[]>;
  count(): Promise<number>;
  deleteOlderThan(date: Date): Promise<number>;
}
