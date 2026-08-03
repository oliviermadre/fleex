import { WS_AGENT_PATH } from '@fleex/shared';

import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';

import type { Container } from '../container.js';
import type { WsHeartbeat } from './ws-heartbeat.js';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

interface AgentClient {
  socket: WebSocket;
  agentName: string;
  subscribedTickets: Set<string>;
}

export function agentWsPlugin(container: Container, heartbeat: WsHeartbeat) {
  return async function (app: FastifyInstance) {
    const clients = new Map<WebSocket, AgentClient>();

    app.get(WS_AGENT_PATH, { websocket: true }, async (socket, request) => {
      const ws = socket as unknown as WebSocket;

      // Authenticate via query param
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing token');
        return;
      }

      const hash = ApiTokenEntity.hashToken(token);
      const tokenEntity = await container.agentTokenStore.getByHash(hash);
      if (!tokenEntity) {
        ws.close(4001, 'Invalid token');
        return;
      }

      const agentName = url.searchParams.get('agent_name') ?? tokenEntity.name;

      const client: AgentClient = {
        socket: ws,
        agentName,
        subscribedTickets: new Set(),
      };
      clients.set(ws, client);
      heartbeat.register(ws);

      ws.on('error', (err) => {
        container.logger.error('WS error on /ws/agents', { error: String(err) });
        ws.terminate();
      });

      // Handle subscription messages from the agent
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.action === 'subscribe' && Array.isArray(msg.ticketIds)) {
            for (const id of msg.ticketIds) {
              client.subscribedTickets.add(id);
            }
          } else if (msg.action === 'unsubscribe' && Array.isArray(msg.ticketIds)) {
            for (const id of msg.ticketIds) {
              client.subscribedTickets.delete(id);
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
        heartbeat.unregister(ws);
      });
    });

    // Targeted broadcast: only send to agents who should see this event
    const agentBroadcast = (type: string, data: unknown) => {
      if (clients.size === 0) return;

      const record = data as Record<string, unknown> | null;
      const ticketId = record?.['ticketId'] as string | undefined;
      const targetAgent = record?.['targetAgent'] as string | undefined;
      const privateRecipients = record?.['privateRecipients'] as string[] | undefined;
      const assignee = record?.['assignee'] as string | undefined;

      const payload = JSON.stringify({ type, ticketId, data });

      for (const client of clients.values()) {
        if (shouldReceive(client, type, ticketId, targetAgent, privateRecipients, assignee)) {
          if (client.socket.readyState === 1) {
            client.socket.send(payload);
          }
        }
      }
    };

    container.agentBroadcast = agentBroadcast;

    app.addHook('onClose', () => {
      for (const client of clients.values()) {
        client.socket.close();
      }
      clients.clear();
    });
  };
}

function shouldReceive(
  client: AgentClient,
  type: string,
  ticketId: string | undefined,
  targetAgent: string | undefined,
  privateRecipients: string[] | undefined,
  assignee: string | undefined,
): boolean {
  // Mention events: only for the target agent
  if (type.startsWith('mention:') && targetAgent) {
    return client.agentName === targetAgent;
  }

  // Private comments: only for recipients
  if (type === 'comment:created' && privateRecipients && privateRecipients.length > 0) {
    return privateRecipients.includes(client.agentName);
  }

  // Ticket events: for assigned agent or subscribed agents
  if (ticketId) {
    if (client.subscribedTickets.has(ticketId)) return true;
    if (assignee && client.agentName === assignee) return true;
  }

  return false;
}
