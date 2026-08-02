import type { TicketEventSource } from '../../domain/events.js';

/**
 * Who triggered a ticket action. Feeds both the activity row (audit UI) and the
 * domain event (audit log + cluster fan-out), so callers describe their origin
 * once instead of duplicating it at every write site.
 */
export interface TicketActor {
  source: TicketEventSource;
  actorType?: 'user' | 'agent';
  actorName?: string | null;
  /** Set when the action originates from an agent execution stream. */
  executionId?: string;
}

/**
 * `TicketActivityEntity.source` is constrained to 'web' | 'api' (persisted
 * column + shared DTO), so the richer event source is projected onto it.
 * Everything that isn't the web UI is an API-side write.
 */
export function toActivitySource(actor: TicketActor): 'web' | 'api' {
  return actor.source === 'web' ? 'web' : 'api';
}
