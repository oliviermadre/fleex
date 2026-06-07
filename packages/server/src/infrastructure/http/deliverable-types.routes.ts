import type { FastifyInstance } from 'fastify';
import type { DeliverableRenderer, DeliverableTypeColor } from '@fleex/shared';
import type { Container } from '../container.js';

/**
 * Per-workspace deliverable-type backoffice (web/admin — no agent auth).
 * Manages the configured types and reassigns deliverables.
 */
export function deliverableTypesRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const svc = container.manageDeliverableTypes;

    // List configured types + usage counts
    app.get('/api/deliverable-types', async () => {
      return svc.list();
    });

    // Create a new type
    app.post<{
      Body: { id: string; label: string; description?: string; renderer: DeliverableRenderer; color?: DeliverableTypeColor | null };
    }>('/api/deliverable-types', async (request, reply) => {
      const view = await svc.create(request.body);
      return reply.code(201).send(view);
    });

    // Update an existing type (label/description/renderer/color)
    app.patch<{
      Params: { id: string };
      Body: { label?: string; description?: string; renderer?: DeliverableRenderer; color?: DeliverableTypeColor | null };
    }>('/api/deliverable-types/:id', async (request) => {
      return svc.update(request.params.id, request.body);
    });

    // Rename a type id (migrates existing deliverables)
    app.post<{
      Params: { id: string };
      Body: { newId: string };
    }>('/api/deliverable-types/:id/rename', async (request) => {
      const { view, migrated } = await svc.rename(request.params.id, request.body.newId);
      return { ...view, migrated };
    });

    // Delete a type (blocked while in use)
    app.delete<{ Params: { id: string } }>('/api/deliverable-types/:id', async (request) => {
      return svc.remove(request.params.id);
    });

    // Bulk reassign all deliverables of one type to another
    app.post<{
      Body: { from: string; to: string };
    }>('/api/deliverable-types/reassign', async (request) => {
      return svc.reassign(request.body.from, request.body.to);
    });

    // Change a single deliverable's type
    app.patch<{
      Params: { id: string };
      Body: { type: string };
    }>('/api/deliverables/:id/type', async (request) => {
      return svc.setDeliverableType(request.params.id, request.body.type);
    });
  };
}
