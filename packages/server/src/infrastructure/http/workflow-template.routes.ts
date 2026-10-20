import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type { WorkflowStep, WorkflowEdge, SubworkflowSource } from '@fleex/shared';
import { hasSubworkflows, includedWorkflowSlugs, validateSubworkflows } from '@fleex/shared';
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

// ── Sub-workflows ──────────────────────────────────────────────────────────

/** Templates (other than `slug` itself) that include `slug` as a sub-workflow. */
export function consumersOf(templates: WorkflowTemplateEntity[], slug: string): WorkflowTemplateEntity[] {
  return templates.filter((t) => t.slug !== slug && includedWorkflowSlugs(t.steps).includes(slug));
}

/**
 * G1–G4 at save time. The resolver sees the store *as it will be after the
 * save*: the candidate under its new slug, and — when the slug changes — its
 * consumers already pointing at the new slug, so a cycle that only closes
 * through the edited template is caught. Only a template that includes others
 * can close a cycle, so the store is not even read otherwise.
 */
async function subworkflowErrors(
  store: WorkflowTemplateStorePort,
  candidate: TemplateBody,
  self: WorkflowTemplateEntity | null,
): Promise<string[]> {
  if (!hasSubworkflows(candidate.steps)) return [];
  const bySlug = new Map<string, SubworkflowSource>();
  for (const t of await store.getAll()) {
    if (t.id === self?.id) continue;
    const steps = self && self.slug !== candidate.slug ? retarget(t.steps, self.slug, candidate.slug) : t.steps;
    bySlug.set(t.slug, { ...t.toDTO(), steps });
  }
  bySlug.set(candidate.slug, candidate);
  return validateSubworkflows(candidate, (slug) => bySlug.get(slug));
}

/** `workflow` steps pointing at `from` now point at `to`. */
function retarget(steps: WorkflowStep[], from: string, to: string): WorkflowStep[] {
  return steps.map((st) => (st.executorType === 'workflow' && st.executorRef === from ? { ...st, executorRef: to } : st));
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

      const subErrors = await subworkflowErrors(deps.templateStore, parsed.data, null);
      if (subErrors.length > 0) {
        return reply.code(400).send({ error: 'INVALID_TEMPLATE', message: subErrors.join('\n') });
      }

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

      const subErrors = await subworkflowErrors(deps.templateStore, parsed.data, t);
      if (subErrors.length > 0) {
        return reply.code(400).send({ error: 'INVALID_TEMPLATE', message: subErrors.join('\n') });
      }

      const previousSlug = t.slug;
      try {
        t.update(parsed.data);
        await deps.templateStore.save(t);
        // A renamed template keeps every workflow including it launchable: their
        // sub-workflow steps follow the new slug (references are by slug, as
        // for `workflow.trigger` and the export).
        if (previousSlug !== t.slug) {
          for (const consumer of consumersOf(await deps.templateStore.getAll(), previousSlug)) {
            consumer.update({ steps: retarget(consumer.steps, previousSlug, t.slug) });
            await deps.templateStore.save(consumer);
          }
        }
        return t.toDTO();
      } catch (err) {
        return reply.code(400).send({
          error: 'INVALID_TEMPLATE',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // DELETE /api/workflows/templates/:id — soft delete (enabled = false)
    // A template other workflows include can't run without it: refuse with the
    // list of consumers unless the caller confirms with `?force=true`.
    app.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/api/workflows/templates/:id', async (request, reply) => {
      const t = await deps.templateStore.getById(request.params.id);
      if (!t) return reply.code(404).send({ error: 'WORKFLOW_TEMPLATE_NOT_FOUND' });
      if (request.query.force !== 'true') {
        const consumers = consumersOf(await deps.templateStore.getAll(), t.slug).filter((c) => c.enabled);
        if (consumers.length > 0) {
          return reply.code(409).send({
            error: 'TEMPLATE_IN_USE',
            message: `"${t.slug}" is included by ${consumers.map((c) => `"${c.slug}"`).join(', ')}, which could no longer start. Pass ?force=true to disable it anyway.`,
            consumers: consumers.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
          });
        }
      }
      t.update({ enabled: false });
      await deps.templateStore.save(t);
      return reply.code(204).send();
    });
  };
}
