import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SSE_EVENTS_PATH, EVENT_CATALOG_PATH, EVENT_TYPES } from '@asm/shared';
import type { DomainEvent } from '@asm/shared';
import type { EventBusAdapter } from '../adapters/event-bus.adapter.js';
import type { Container } from '../container.js';

function matchesFilter(eventType: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => {
    if (filter === '*') return true;
    if (filter.endsWith('.*')) {
      const namespace = filter.slice(0, -2);
      return eventType.startsWith(namespace + '.');
    }
    return eventType === filter;
  });
}

// Build the catalog from EVENT_TYPES constant
const CATALOG = Object.entries(EVENT_TYPES).map(([key, type]) => {
  const namespace = type.split('.')[0]!;
  return { key, type, namespace };
});

const NAMESPACES = [...new Set(CATALOG.map((e) => e.namespace))];

export function eventsRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // ── SSE stream endpoint ──

    app.get(
      SSE_EVENTS_PATH,
      async (request: FastifyRequest<{ Querystring: { filter?: string; lastEventId?: string } }>, reply: FastifyReply) => {
        const filterParam = request.query.filter ?? '';
        const filters = filterParam ? filterParam.split(',').map((f) => f.trim()) : [];
        const lastEventId = request.query.lastEventId ?? request.headers['last-event-id'] as string | undefined;

        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        // Send initial comment to establish connection
        reply.raw.write(':ok\n\n');

        // Replay missed events if lastEventId is provided
        const eventBus = container.eventBus as EventBusAdapter;
        if (lastEventId) {
          const missed = eventBus.getRecentEvents(lastEventId);
          for (const event of missed) {
            if (matchesFilter(event.type, filters)) {
              reply.raw.write(formatSSE(event));
            }
          }
        }

        // Subscribe to new events
        const handler = (event: DomainEvent) => {
          if (matchesFilter(event.type, filters)) {
            reply.raw.write(formatSSE(event));
          }
        };

        eventBus.onAny(handler);

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
          reply.raw.write(':heartbeat\n\n');
        }, 30_000);

        // Cleanup on disconnect
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          eventBus.offAny(handler);
        });
      },
    );

    // ── Event catalog endpoint ──

    app.get(EVENT_CATALOG_PATH, async () => {
      return {
        version: '1.0',
        namespaces: NAMESPACES,
        events: CATALOG.map((entry) => ({
          type: entry.type,
          namespace: entry.namespace,
        })),
        stream: {
          endpoint: SSE_EVENTS_PATH,
          protocol: 'SSE',
          filterParam: 'filter',
          filterExamples: [
            'session.*',
            'ticket.created,ticket.moved',
            '*',
          ],
          reconnect: {
            headerName: 'Last-Event-ID',
            queryParam: 'lastEventId',
          },
        },
      };
    });
  };
}

function formatSSE(event: DomainEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
