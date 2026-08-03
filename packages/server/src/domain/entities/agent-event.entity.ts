import { randomUUID } from 'node:crypto';

import type { AgentEvent, AgentEventType } from '@fleex/shared';

export class AgentEventEntity {
  constructor(
    public readonly id: string,
    public readonly executionId: string,
    public readonly eventType: AgentEventType,
    public readonly data: unknown,
    public readonly sequence: number,
    public readonly createdAt: Date,
  ) {}

  static create(params: {
    executionId: string;
    eventType: AgentEventType;
    data: unknown;
    sequence: number;
  }): AgentEventEntity {
    return new AgentEventEntity(
      randomUUID(),
      params.executionId,
      params.eventType,
      params.data,
      params.sequence,
      new Date(),
    );
  }

  toDTO(): AgentEvent {
    return {
      id: this.id,
      executionId: this.executionId,
      eventType: this.eventType,
      data: this.data,
      sequence: this.sequence,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
