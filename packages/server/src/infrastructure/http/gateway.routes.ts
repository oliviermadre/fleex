import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { GatewayRegisterRequest } from '@fleex/shared';

export function gatewayRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    // Register a new gateway
    app.post<{ Body: GatewayRegisterRequest }>('/api/gateways', async (req, reply) => {
      const { name, publicKey, hostname } = req.body;
      if (!name || !publicKey) {
        return reply.code(400).send({ error: 'name and publicKey are required' });
      }
      if (publicKey.length !== 64 || !/^[0-9a-f]+$/i.test(publicKey)) {
        return reply.code(400).send({ error: 'publicKey must be a 64-char hex Ed25519 public key' });
      }

      const gatewayStore = container.gatewayStore;
      if (!gatewayStore) {
        return reply.code(501).send({ error: 'Gateway registration requires a database' });
      }

      const userId = (req as any).userId ?? '00000000-0000-0000-0000-000000000000';
      const gateway = await gatewayStore.register(userId, name, publicKey, hostname);

      const serverUrl = `${req.protocol}://${req.hostname}`;
      return reply.code(201).send({
        id: gateway.id,
        name: gateway.name,
        serverUrl,
      });
    });

    // List gateways with live tunnel status
    app.get('/api/gateways', async (req, reply) => {
      const gatewayStore = container.gatewayStore;
      if (!gatewayStore) {
        // No DB: report tunnel-only status
        const connected = container.tunnelManager.connectedGatewayIds;
        return reply.send(connected.map((id) => ({
          id,
          name: 'default',
          hostname: null,
          publicKey: null,
          status: 'online' as const,
          lastSeenAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        })));
      }
      const userId = (req as any).userId ?? '00000000-0000-0000-0000-000000000000';
      const gateways = await gatewayStore.listByUser(userId);

      // Enrich with live tunnel status
      const connected = new Set(container.tunnelManager.connectedGatewayIds);
      const enriched = gateways.map((gw) => ({
        ...gw,
        status: connected.has(gw.id) ? 'online' as const : gw.status,
        tunnelConnected: connected.has(gw.id),
      }));
      return reply.send(enriched);
    });

    // Delete a gateway
    app.delete<{ Params: { id: string } }>('/api/gateways/:id', async (req, reply) => {
      const gatewayStore = container.gatewayStore;
      if (!gatewayStore) {
        return reply.code(501).send({ error: 'Gateway management requires a database' });
      }
      await gatewayStore.delete(req.params.id);
      return reply.code(204).send();
    });
  };
}
