import type { HubEventPublisherPort } from '../../application/ports/hub-event-publisher.port.js';

/** No-op publisher used when no hub URL is configured (single-instance mode). */
export class NullHubEventPublisher implements HubEventPublisherPort {
  publish(): void {
    // no-op
  }
}
