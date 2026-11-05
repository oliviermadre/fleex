/**
 * Google Calendar on /agenda (read through gogcli), wired in one call: the
 * HTTP routes (status, links) and the external source the agenda use case merges.
 */
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import { googleAgendaRoutes } from '../http/google-agenda.routes.js';
import { GoogleCalendarClient } from './google-calendar.client.js';
import { ExternalLinksStore } from './external-links.js';
import { GoogleAgendaSource } from './google-agenda.source.js';

export { GoogleCalendarClient, GoogleNotConnectedError, GogNotInstalledError } from './google-calendar.client.js';
export { ExternalLinksStore } from './external-links.js';
export { GoogleAgendaSource, mapGoogleEvent } from './google-agenda.source.js';

export function createGoogleAgenda(deps: {
  kvStore: KvStorePort | null | undefined;
  deliverableStore: Pick<DeliverableStorePort, 'getById'>;
  logger?: LoggerPort;
  /** Injected gogcli client (tests); defaults to the `gog` binary on the host. */
  client?: GoogleCalendarClient;
}) {
  const client = deps.kvStore ? (deps.client ?? new GoogleCalendarClient({ logger: deps.logger })) : null;
  const source = deps.kvStore && client ? new GoogleAgendaSource(client, new ExternalLinksStore(deps.kvStore)) : null;
  const routes = googleAgendaRoutes({ kvStore: deps.kvStore, deliverableStore: deps.deliverableStore, client, logger: deps.logger });
  return { routes, source, client };
}
