import type { HubClient } from './hub-client.js';
import type { HubEventPublisherPort } from '../../application/ports/hub-event-publisher.port.js';
import type { AnyDomainEvent } from '../../domain/events.js';

/** Forwards locally-emitted events to the HubClient. */
export class HubEventPublisher implements HubEventPublisherPort {
  constructor(private readonly client: HubClient) {}

  publish(event: AnyDomainEvent): void {
    this.client.publish(event);
  }
}
