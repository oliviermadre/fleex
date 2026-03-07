export interface DomainEventLog {
  readonly id: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly instanceId: string;
  readonly occurredAt: string; // ISO 8601
}
