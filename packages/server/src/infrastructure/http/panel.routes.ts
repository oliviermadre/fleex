import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { ExecutionMode, PanelMember } from '@fleex/shared';
import { PanelNotFoundError } from '../../domain/errors.js';

export function panelRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // GET /api/panels — list all panels
    app.get('/api/panels', async () => {
      const panels = await container.panelStore.getAll();
      return panels.map((p) => p.toDTO());
    });

    // GET /api/panels/enabled — list enabled panels only
    app.get('/api/panels/enabled', async () => {
      const panels = await container.panelStore.getEnabled();
      return panels.map((p) => p.toDTO());
    });

    // GET /api/panels/:id — get single panel
    app.get<{ Params: { id: string } }>('/api/panels/:id', async (request) => {
      const panel = await container.panelStore.getById(request.params.id);
      if (!panel) throw new PanelNotFoundError(request.params.id);
      return panel.toDTO();
    });

    // POST /api/panels — create panel
    app.post<{
      Body: {
        name: string;
        displayName: string;
        description?: string;
        executionMode?: ExecutionMode;
        members: PanelMember[];
        orchestratorPrompt?: string;
        orchestratorModel?: string;
        defaultMemberModel?: string;
        enabled?: boolean;
      };
    }>('/api/panels', async (request, reply) => {
      const panel = await container.createPanel.execute(request.body);
      emit({ type: 'panel.created', panelId: panel.id, occurredAt: new Date() });
      return reply.code(201).send(panel.toDTO());
    });

    // PATCH /api/panels/:id — update panel
    app.patch<{
      Params: { id: string };
      Body: {
        name?: string;
        displayName?: string;
        description?: string;
        executionMode?: ExecutionMode;
        members?: PanelMember[];
        orchestratorPrompt?: string;
        orchestratorModel?: string;
        orchestratorPersonaId?: string | null;
        defaultMemberModel?: string;
        enabled?: boolean;
      };
    }>('/api/panels/:id', async (request) => {
      const panel = await container.updatePanel.execute(
        request.params.id,
        request.body,
      );
      emit({ type: 'panel.updated', panelId: panel.id, occurredAt: new Date() });
      return panel.toDTO();
    });

    // DELETE /api/panels/:id — delete panel
    app.delete<{ Params: { id: string } }>('/api/panels/:id', async (request, reply) => {
      await container.deletePanel.execute(request.params.id);
      emit({ type: 'panel.deleted', panelId: request.params.id, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // POST /api/panels/:id/execute — execute panel against a ticket
    app.post<{
      Params: { id: string };
      Body: { ticketId: string; topic?: string };
    }>('/api/panels/:id/execute', async (request) => {
      const { id } = request.params;
      const { ticketId, topic } = request.body;

      const panel = await container.panelStore.getById(id);
      if (!panel) throw new PanelNotFoundError(id);

      // Fire-and-forget — execution runs in background (panel.executed event emitted by run-panel use case on completion)
      container.runPanel.execute({
        panelName: panel.name,
        ticketId,
        topic,
      }).catch((err) => {
        container.logger.error('Panel execution failed', {
          panelId: id, ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return { status: 'started', panelId: id, panelName: panel.name, ticketId };
    });
  };
}
