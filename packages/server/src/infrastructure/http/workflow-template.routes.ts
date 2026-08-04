import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';
import type {
  WorkflowStep, WorkflowEdge, JsonSchemaProperty,
} from '@fleex/shared';
import { EDGE_OPERATORS } from '@fleex/shared';

// ── Manual validation helpers ──────────────────────────────────────────────

type ValidationResult = { ok: true } | { ok: false; error: string };

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SLUG_PATTERN = /^[a-z0-9_-]+$/;
const EXECUTOR_TYPES = ['agent', 'skill', 'panel', 'human_gate', 'native', 'route'] as const;
const STEP_MODES = ['talk', 'plan', 'edit'] as const;
const MATCH_MODES = ['all', 'any'] as const;
const JSON_SCHEMA_PROP_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

function validateJsonSchemaProperty(prop: unknown, path: string): ValidationResult {
  if (!isObject(prop)) return { ok: false, error: `${path} must be an object` };
  if (!isString(prop['type']) || !JSON_SCHEMA_PROP_TYPES.includes(prop['type'] as never)) {
    return { ok: false, error: `${path}.type must be one of ${JSON_SCHEMA_PROP_TYPES.join(', ')}` };
  }
  if (prop['enum'] !== undefined) {
    if (!isArray(prop['enum']) || !prop['enum'].every(isString)) {
      return { ok: false, error: `${path}.enum must be an array of strings` };
    }
  }
  if (prop['description'] !== undefined && !isString(prop['description'])) {
    return { ok: false, error: `${path}.description must be a string` };
  }
  return { ok: true };
}

function validateOutputSchema(schema: unknown, path: string): ValidationResult {
  if (!isObject(schema)) return { ok: false, error: `${path} must be an object` };
  if (schema['type'] !== 'object') return { ok: false, error: `${path}.type must be "object"` };
  if (!isObject(schema['properties'])) return { ok: false, error: `${path}.properties must be an object` };
  for (const [key, prop] of Object.entries(schema['properties'])) {
    const r = validateJsonSchemaProperty(prop, `${path}.properties.${key}`);
    if (!r.ok) return r;
  }
  if (schema['required'] !== undefined) {
    if (!isArray(schema['required']) || !schema['required'].every(isString)) {
      return { ok: false, error: `${path}.required must be an array of strings` };
    }
  }
  return { ok: true };
}

/**
 * Shape-only check. Whether the operation exists, whether its params satisfy the
 * descriptor, and whether references point at real ancestors is decided by
 * `WorkflowTemplateEntity.validate` — this guard only keeps malformed JSON from
 * reaching it.
 */
function validateNativeActions(actions: unknown, path: string): ValidationResult {
  if (!isArray(actions)) return { ok: false, error: `${path} must be an array` };
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const ap = `${path}[${i}]`;
    if (!isObject(a)) return { ok: false, error: `${ap} must be an object` };
    if (!isString(a['id']) || a['id'].length === 0) {
      return { ok: false, error: `${ap}.id must be a non-empty string` };
    }
    if (!isString(a['operationId']) || a['operationId'].length === 0) {
      return { ok: false, error: `${ap}.operationId must be a non-empty string` };
    }
    if (!isObject(a['params'])) return { ok: false, error: `${ap}.params must be an object` };
  }
  return { ok: true };
}

function validateStep(step: unknown, idx: number): ValidationResult {
  const p = `steps[${idx}]`;
  if (!isObject(step)) return { ok: false, error: `${p} must be an object` };
  if (!isString(step['id']) || step['id'].length === 0) return { ok: false, error: `${p}.id must be a non-empty string` };
  if (!isString(step['name']) || step['name'].length === 0) return { ok: false, error: `${p}.name must be a non-empty string` };
  if (!isString(step['executorType']) || !EXECUTOR_TYPES.includes(step['executorType'] as never)) {
    return { ok: false, error: `${p}.executorType must be one of ${EXECUTOR_TYPES.join(', ')}` };
  }
  if (!isString(step['executorRef'])) return { ok: false, error: `${p}.executorRef must be a string` };
  if (step['mode'] !== undefined && (!isString(step['mode']) || !STEP_MODES.includes(step['mode'] as never))) {
    return { ok: false, error: `${p}.mode must be one of ${STEP_MODES.join(', ')}` };
  }
  if (step['outputSchema'] !== undefined) {
    const r = validateOutputSchema(step['outputSchema'], `${p}.outputSchema`);
    if (!r.ok) return r;
  }
  if (step['humanGateOutcomes'] !== undefined) {
    if (!isArray(step['humanGateOutcomes']) || !step['humanGateOutcomes'].every(isString)) {
      return { ok: false, error: `${p}.humanGateOutcomes must be an array of strings` };
    }
  }
  if (step['nativeActions'] !== undefined) {
    const r = validateNativeActions(step['nativeActions'], `${p}.nativeActions`);
    if (!r.ok) return r;
  }
  if (!isObject(step['position'])) return { ok: false, error: `${p}.position must be an object` };
  if (!isNumber((step['position'] as Record<string, unknown>)['x'])) return { ok: false, error: `${p}.position.x must be a number` };
  if (!isNumber((step['position'] as Record<string, unknown>)['y'])) return { ok: false, error: `${p}.position.y must be a number` };
  return { ok: true };
}

function validateOperator(op: unknown, p: string): ValidationResult {
  if (!isString(op) || !EDGE_OPERATORS.includes(op as never)) {
    return { ok: false, error: `${p}.operator must be one of ${EDGE_OPERATORS.join(', ')}` };
  }
  return { ok: true };
}

function validateConditionGroup(group: unknown, p: string): ValidationResult {
  if (!isObject(group)) return { ok: false, error: `${p} must be an object` };
  if (!isString(group['match']) || !MATCH_MODES.includes(group['match'] as never)) {
    return { ok: false, error: `${p}.match must be one of ${MATCH_MODES.join(', ')}` };
  }
  if (!isArray(group['clauses']) || group['clauses'].length === 0) {
    return { ok: false, error: `${p}.clauses must be a non-empty array` };
  }
  for (let i = 0; i < group['clauses'].length; i++) {
    const cp = `${p}.clauses[${i}]`;
    const clause = group['clauses'][i];
    if (!isObject(clause)) return { ok: false, error: `${cp} must be an object` };
    if (clause['stepId'] !== undefined && !isString(clause['stepId'])) {
      return { ok: false, error: `${cp}.stepId must be a string` };
    }
    if (!isString(clause['field'])) return { ok: false, error: `${cp}.field must be a string` };
    const r = validateOperator(clause['operator'], cp);
    if (!r.ok) return r;
    if (clause['value'] !== undefined
      && !isString(clause['value'])
      && !(isArray(clause['value']) && (clause['value'] as unknown[]).every(isString))) {
      return { ok: false, error: `${cp}.value must be a string or array of strings` };
    }
    if (clause['caseInsensitive'] !== undefined && !isBoolean(clause['caseInsensitive'])) {
      return { ok: false, error: `${cp}.caseInsensitive must be a boolean` };
    }
  }
  return { ok: true };
}

function validateEdge(edge: unknown, idx: number): ValidationResult {
  const p = `edges[${idx}]`;
  if (!isObject(edge)) return { ok: false, error: `${p} must be an object` };
  if (!isString(edge['id']) || edge['id'].length === 0) return { ok: false, error: `${p}.id must be a non-empty string` };
  if (!isString(edge['source']) || edge['source'].length === 0) return { ok: false, error: `${p}.source must be a non-empty string` };
  if (!isString(edge['target']) || edge['target'].length === 0) return { ok: false, error: `${p}.target must be a non-empty string` };
  if (!isBoolean(edge['isDefault'])) return { ok: false, error: `${p}.isDefault must be a boolean` };
  if (edge['condition'] !== undefined) {
    const c = edge['condition'];
    if (!isObject(c)) return { ok: false, error: `${p}.condition must be an object` };
    if (!isString(c['field'])) return { ok: false, error: `${p}.condition.field must be a string` };
    const r = validateOperator(c['operator'], `${p}.condition`);
    if (!r.ok) return r;
    if (!isString(c['value']) && !(isArray(c['value']) && (c['value'] as unknown[]).every(isString))) {
      return { ok: false, error: `${p}.condition.value must be a string or array of strings` };
    }
  }
  if (edge['conditionGroup'] !== undefined) {
    const r = validateConditionGroup(edge['conditionGroup'], `${p}.conditionGroup`);
    if (!r.ok) return r;
  }
  if (edge['label'] !== undefined && !isString(edge['label'])) {
    return { ok: false, error: `${p}.label must be a string` };
  }
  return { ok: true };
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

export function parseTemplateBody(body: unknown): { ok: true; data: TemplateBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };

  if (!isString(body['name']) || body['name'].length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (!isString(body['slug'])) return { ok: false, error: 'slug must be a string' };
  if (!SLUG_PATTERN.test(body['slug'])) {
    return { ok: false, error: 'slug must match /^[a-z0-9_-]+$/' };
  }
  if (!isArray(body['steps']) || body['steps'].length === 0) {
    return { ok: false, error: 'steps must be a non-empty array' };
  }
  for (let i = 0; i < body['steps'].length; i++) {
    const r = validateStep(body['steps'][i], i);
    if (!r.ok) return r;
  }
  if (!isArray(body['edges'])) return { ok: false, error: 'edges must be an array' };
  for (let i = 0; i < body['edges'].length; i++) {
    const r = validateEdge(body['edges'][i], i);
    if (!r.ok) return r;
  }
  if (!isString(body['entryStepId']) || body['entryStepId'].length === 0) {
    return { ok: false, error: 'entryStepId must be a non-empty string' };
  }

  return {
    ok: true,
    data: {
      name: body['name'],
      slug: body['slug'],
      emoji: isString(body['emoji']) ? body['emoji'] : '',
      description: isString(body['description']) ? body['description'] : '',
      steps: body['steps'] as WorkflowStep[],
      edges: body['edges'] as WorkflowEdge[],
      entryStepId: body['entryStepId'],
      enabled: isBoolean(body['enabled']) ? body['enabled'] : true,
    },
  };
}

// ── Route registration ─────────────────────────────────────────────────────

export function workflowTemplateRoutes(deps: { templateStore: WorkflowTemplateStorePort }) {
  return async function (app: FastifyInstance) {
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
