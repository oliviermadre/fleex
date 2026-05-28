import type { AnyDomainEvent } from '../../domain/events.js';

/**
 * Publishes a locally-emitted domain event to the multi-instance hub.
 *
 * Implementations are responsible for filtering out events listed in
 * HUB_SHARED_EXCLUDED (sessions, worktree) and for handling the hub being
 * temporarily unreachable.
 */
export interface HubEventPublisherPort {
  publish(event: AnyDomainEvent): void;
}
