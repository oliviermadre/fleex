import type { DomainEventLog } from '@fleex/shared';

export class DomainEventLogEntity {
  constructor(
    public readonly id: string,
    public readonly eventType: string,
    public readonly payload: Record<string, unknown>,
    public readonly instanceId: string,
    public readonly occurredAt: Date,
  ) {}

  static create(params: {
    id: string;
    eventType: string;
    payload: Record<string, unknown>;
    instanceId: string;
    occurredAt: Date;
  }): DomainEventLogEntity {
    return new DomainEventLogEntity(
      params.id,
      params.eventType,
      params.payload,
      params.instanceId,
      params.occurredAt,
    );
  }

  toDTO(): DomainEventLog {
    return {
      id: this.id,
      eventType: this.eventType,
      payload: this.payload,
      instanceId: this.instanceId,
      occurredAt: this.occurredAt.toISOString(),
    };
  }
}
