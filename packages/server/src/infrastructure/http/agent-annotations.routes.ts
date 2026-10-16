import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

type AnnotationBody = { at?: string; title?: string; body?: string; tone?: string };

/**
 * Timeline annotations for agents (CLI / MCP). Same behaviour as the web
 * routes, except that an agent may only edit or delete its own annotations
 * (enforced by the use-case, 403 otherwise).
 */
export function agentAnnotationsRoutes(container: Container) {
  const actor = (request: { agent?: { name: string } }) => ({ type: 'agent' as const, name: request.agent?.name ?? 'unknown' });

  return async function (app: FastifyInstance) {
    app.get<{ Params: { id: string } }>('/tickets/:id/annotations', async (request) => {
      const annotations = await container.timelineAnnotations.list(request.params.id);
      return annotations.map((a) => a.toDTO());
    });

    app.post<{ Params: { id: string }; Body: AnnotationBody }>('/tickets/:id/annotations', async (request, reply) => {
      const body = request.body ?? {};
      const annotation = await container.timelineAnnotations.create(
        request.params.id,
        { at: body.at ?? 'now', title: body.title ?? '', body: body.body, tone: body.tone },
        actor(request),
      );
      return reply.code(201).send(annotation.toDTO());
    });

    app.post<{ Params: { id: string; commentId: string }; Body: AnnotationBody }>(
      '/tickets/:id/comments/:commentId/annotate',
      async (request, reply) => {
        const annotation = await container.timelineAnnotations.promote(
          request.params.id, request.params.commentId, request.body ?? {}, actor(request),
        );
        return reply.code(201).send(annotation.toDTO());
      },
    );

    app.patch<{ Params: { id: string; annotationId: string }; Body: AnnotationBody }>(
      '/tickets/:id/annotations/:annotationId',
      async (request) => {
        const annotation = await container.timelineAnnotations.update(
          request.params.id, request.params.annotationId, request.body ?? {}, actor(request),
        );
        return annotation.toDTO();
      },
    );

    app.delete<{ Params: { id: string; annotationId: string } }>(
      '/tickets/:id/annotations/:annotationId',
      async (request, reply) => {
        await container.timelineAnnotations.remove(request.params.id, request.params.annotationId, actor(request));
        return reply.code(204).send();
      },
    );
  };
}
