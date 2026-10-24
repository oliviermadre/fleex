import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';
import { checkDocumentShape } from '@fleex/shared';
import { applyWorkflowDocument, loadWorkflowCapabilities, type ApplyDeps } from '../../application/use-cases/apply-workflow-template.js';
import { buildApplyDocumentation, renderApplyDocumentationMarkdown } from '@fleex/shared';

// ── Body guard ──────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface TemplateBody {
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  enabled: boolean;
}

/**
 * Shape guard for the editor's PUT / POST, on top of the shared document
 * schema (`WORKFLOW_DOCUMENT_SCHEMA`) — the same one `workflow apply` and its
 * documentation use. Returns every shape error at once. Unknown fields are
 * tolerated here (the `save` profile only warns about them); semantic rules are
 * the entity's job.
 */
export function parseTemplateBody(body: unknown): { ok: true; data: TemplateBody } | { ok: false; error: string } {
  const shapeErrors = checkDocumentShape(body).filter((i) => i.kind === 'shape');
  if (shapeErrors.length > 0) return { ok: false, error: shapeErrors.map((i) => i.message).join('\n') };
  const b = body as Record<string, unknown>;
  return {
    ok: true,
    data: {
      name: b['name'] as string,
      slug: b['slug'] as string,
      emoji: (b['emoji'] as string | undefined) ?? '',
      description: (b['description'] as string | undefined) ?? '',
      steps: b['steps'] as WorkflowStep[],
      edges: b['edges'] as WorkflowEdge[],
      entryStepId: b['entryStepId'] as string,
      enabled: (b['enabled'] as boolean | undefined) ?? true,
    },
  };
}

// ── Route registration ─────────────────────────────────────────────────────

export function workflowTemplateRoutes(deps: { templateStore: WorkflowTemplateStorePort } & Partial<ApplyDeps>) {
  return async function (app: FastifyInstance) {
    // POST /api/workflows/templates/apply?dryRun=1 — create or replace a whole
    // template from one document (`fleex workflow apply`). Never a partial edit.
    app.post<{ Querystring: { dryRun?: string } }>('/api/workflows/templates/apply', async (request, reply) => {
      const dryRun = request.query.dryRun === '1' || request.query.dryRun === 'true';
      const result = await applyWorkflowDocument(request.body, { ...deps }, { dryRun });
      return reply.code(result.status).send(result.body);
    });

    // GET /api/workflows/templates/apply/documentation?format=markdown|json
    app.get<{ Querystring: { format?: string } }>('/api/workflows/templates/apply/documentation', async (request, reply) => {
      const format = request.query.format ?? 'markdown';
      if (format !== 'markdown' && format !== 'json') {
        return reply.code(400).send({ error: 'INVALID_FORMAT', message: `format must be markdown or json (got "${format}")` });
      }
      const caps = await loadWorkflowCapabilities(deps);
      const doc = buildApplyDocumentation({ caps, workspace: process.env.FLEEX_WORKSPACE });
      if (format === 'json') return doc;
      return reply.type('text/markdown; charset=utf-8').send(renderApplyDocumentationMarkdown(doc));
    });

    // GET /api/workflows/templates — list all
    app.get('/api/workflows/templates', async () => {
      const templates = await deps.templateStore.getAll();
      return templates.map((t) => t.toDTO());
    });

    // GET /api/workflows/templates/enabled — list enabled only
    app.get('/api/workflows/templates/enabled', async () => {
      const templates = await deps.templateStore.getEnabled();
      return templates.map((t) => t.toDTO());
    });

    // GET /api/workflows/templates/:id — get one
    app.get<{ Params: { id: string } }>('/api/workflows/templates/:id', async (request, reply) => {
      const t = await deps.templateStore.getById(request.params.id);
      if (!t) return reply.code(404).send({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
      return t.toDTO();
    });

    // POST /api/workflows/templates — create
    app.post('/api/workflows/templates', async (request, reply) => {
      const parsed = parseTemplateBody(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

      // Slug uniqueness check
      const existing = await deps.templateStore.getBySlug(parsed.data.slug);
      if (existing) return reply.code(409).send({ error: 'SLUG_TAKEN', message: `Slug "${parsed.data.slug}" is already in use` });

      try {
        const t = WorkflowTemplateEntity.create({ id: randomUUID(), ...parsed.data });
        await deps.templateStore.save(t);
        return reply.code(201).send(t.toDTO());
      } catch (err) {
        return reply.code(400).send({
          error: 'INVALID_TEMPLATE',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // PUT /api/workflows/templates/:id — update
    app.put<{ Params: { id: string } }>('/api/workflows/templates/:id', async (request, reply) => {
      const t = await deps.templateStore.getById(request.params.id);
      if (!t) return reply.code(404).send({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });

      const parsed = parseTemplateBody(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: 'INVALID_BODY', message: parsed.error });

      // Slug collision check (only if slug changed)
      if (parsed.data.slug !== t.slug) {
        const existing = await deps.templateStore.getBySlug(parsed.data.slug);
        if (existing) return reply.code(409).send({ error: 'SLUG_TAKEN', message: `Slug "${parsed.data.slug}" is already in use` });
      }

      try {
        t.update(parsed.data);
        await deps.templateStore.save(t);
        return t.toDTO();
      } catch (err) {
        return reply.code(400).send({
          error: 'INVALID_TEMPLATE',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // DELETE /api/workflows/templates/:id — soft delete (enabled = false)
    app.delete<{ Params: { id: string } }>('/api/workflows/templates/:id', async (request, reply) => {
      const t = await deps.templateStore.getById(request.params.id);
      if (!t) return reply.code(404).send({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
      t.update({ enabled: false });
      await deps.templateStore.save(t);
      return reply.code(204).send();
    });
  };
}
