import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_AGENT_EVENTS_PATH } from '@fleex/shared';
import type { Container } from '../container.js';

interface EventClient {
  socket: WebSocket;
  subscribedExecutions: Set<string>;
  subscribedTickets: Set<string>;
}

export function agentEventsWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const clients = new Map<WebSocket, EventClient>();
    let batchBuffer: { client: EventClient; payload: string }[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    app.get(WS_AGENT_EVENTS_PATH, { websocket: true }, (socket) => {
      const ws = socket as unknown as WebSocket;

      const client: EventClient = {
        socket: ws,
        subscribedExecutions: new Set(),
        subscribedTickets: new Set(),
      };
      clients.set(ws, client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.action === 'subscribe') {
            if (msg.executionId) client.subscribedExecutions.add(msg.executionId);
            if (msg.ticketId) client.subscribedTickets.add(msg.ticketId);
          } else if (msg.action === 'unsubscribe') {
            if (msg.executionId) client.subscribedExecutions.delete(msg.executionId);
            if (msg.ticketId) client.subscribedTickets.delete(msg.ticketId);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
      });
    });

    const flushBatch = () => {
      const batch = batchBuffer;
      batchBuffer = [];
      batchTimer = null;

      for (const { client, payload } of batch) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    };

    // Wire up the executeAgent event callback for real-time streaming
    container.executeAgent.onEvent = (event) => {
      if (clients.size === 0) return;

      const dto = event.toDTO();
      const executionId = dto.executionId;

      // Look up ticketId from active executions in the event store
      // For now, broadcast to clients subscribed to this execution
      const payload = JSON.stringify({ type: 'agent_event:delta', data: dto });

      for (const client of clients.values()) {
        if (client.subscribedExecutions.has(executionId)) {
          batchBuffer.push({ client, payload });
        }
      }

      // Also broadcast to ticket subscribers — the ticketId is embedded in execution_start events
      if (dto.eventType === 'execution_start') {
        const ticketId = (dto.data as Record<string, unknown>)?.['ticketId'] as string | undefined;
        if (ticketId) {
          for (const client of clients.values()) {
            if (client.subscribedTickets.has(ticketId) && !client.subscribedExecutions.has(executionId)) {
              batchBuffer.push({ client, payload });
            }
          }
        }
      }

      // 50ms batching window
      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, 50);
      }
    };

    // Wire execution completion broadcast
    container.executeAgent.onExecutionComplete = (personaId, status, _mentionId) => {
      const type = status === 'completed' ? 'persona:execution_completed' : 'persona:execution_failed';
      container.personaBroadcast(type, { personaId });
    };

    // Wire ticket update broadcast from agent execution
    container.executeAgent.onTicketUpdate = (type, data) => {
      container.ticketBroadcast(type, data);
    };

    // Also wire the container broadcast for external use
    container.agentEventBroadcast = (msg: unknown) => {
      if (clients.size === 0) return;
      const payload = JSON.stringify(msg);
      for (const client of clients.values()) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    };

    app.addHook('onClose', () => {
      if (batchTimer) clearTimeout(batchTimer);
      for (const client of clients.values()) {
        client.socket.close();
      }
      clients.clear();
    });
  };
}
