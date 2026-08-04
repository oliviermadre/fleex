import type {
  EdgeConditionClause,
  JsonSchemaProperty,
  WorkflowEdge,
  WorkflowStep,
} from '../types/workflow.js';
import { computeAncestors, computeDominators } from './graph.js';
import {
  MAX_REGEX_LENGTH,
  compileRegex,
  isListOperator,
  isUnaryOperator,
  normalizeEdgeCondition,
} from './edge-conditions.js';

/**
 * Save-time validation and authoring suggestions for edge conditions.
 *
 * Same contract as `validateNativeSteps`: one pure function, two consumers —
 * the entity (throws on `errors`) and the editor (shows `errors` *and*
 * `warnings`) — so the editor can never offer something the server refuses.
 */

export interface EdgeValidationResult {
  errors: string[];
  warnings: string[];
  /** The same messages grouped by edge id, for per-edge display in the editor. */
  byEdge: Record<string, { errors: string[]; warnings: string[] }>;
}

/**
 * Fields every step publishes regardless of its output schema.
 *
 * Only offered for the edge's *source* step: a run only carries the
 * `schemaFields` of earlier steps forward, so `result` or `deliverable.status`
 * of a step further back is not readable at runtime and must not be offered.
 */
const STANDARD_FIELDS: { field: string; type: JsonSchemaProperty['type']; enum?: string[] }[] = [
  { field: 'result', type: 'string', enum: ['ok', 'needs_review', 'ko'] },
  { field: 'outcome', type: 'string' },
  { field: 'deliverable.status', type: 'string', enum: ['draft', 'final'] },
  { field: 'deliverable.type', type: 'string' },
  { field: 'mentionStatus', type: 'string', enum: ['resolved', 'waiting_for_info'] },
];

function isStandardField(field: string): boolean {
  return STANDARD_FIELDS.some((f) => f.field === field)
    || field === 'comment'
    || field.startsWith('deliverable.');
}

export function validateEdgeConditions(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId?: string,
): EdgeValidationResult {
  const byEdge: Record<string, { errors: string[]; warnings: string[] }> = {};
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ancestors = computeAncestors(steps, edges);
  const dominators = entryStepId ? computeDominators(steps, edges, entryStepId) : null;

  for (const edge of edges) {
    const bucket = (byEdge[edge.id] = { errors: [] as string[], warnings: [] as string[] });
    const { errors, warnings } = bucket;
    const sourceName = byId.get(edge.source)?.name || edge.source;
    const targetName = byId.get(edge.target)?.name || edge.target;
    const where = `edge "${sourceName}" → "${targetName}"`;

    const group = normalizeEdgeCondition(edge);

    if (edge.isDefault) continue;
    if (!group) {
      errors.push(`${where}: a non-default edge needs at least one condition`);
      continue;
    }

    group.clauses.forEach((clause, index) => {
      validateClause({
        clause, index, where, edge, byId, ancestors, dominators, errors, warnings,
      });
    });
  }

  return {
    errors: Object.values(byEdge).flatMap((i) => i.errors),
    warnings: Object.values(byEdge).flatMap((i) => i.warnings),
    byEdge,
  };
}

interface ClauseValidationCtx {
  clause: EdgeConditionClause;
  index: number;
  where: string;
  edge: WorkflowEdge;
  byId: Map<string, WorkflowStep>;
  ancestors: Map<string, Set<string>>;
  dominators: Map<string, Set<string>> | null;
  errors: string[];
  warnings: string[];
}

function validateClause(ctx: ClauseValidationCtx): void {
  const { clause, index, where, edge, byId, ancestors, dominators, errors, warnings } = ctx;
  const label = `${where}, condition ${index + 1}`;

  if (!clause.field || !clause.field.trim()) {
    errors.push(`${label}: a field is required`);
    return;
  }

  // ── Right-hand side ────────────────────────────────────────────────────────
  if (isUnaryOperator(clause.operator)) {
    // Nothing to check — a value is simply ignored.
  } else if (isListOperator(clause.operator)) {
    if (!Array.isArray(clause.value) || clause.value.length === 0) {
      errors.push(`${label}: "${clause.operator}" needs a non-empty list of values`);
      return;
    }
  } else if (typeof clause.value !== 'string' || clause.value === '') {
    errors.push(`${label}: "${clause.operator}" needs a value`);
    return;
  }

  if (clause.operator === 'matches' && typeof clause.value === 'string') {
    if (clause.value.length > MAX_REGEX_LENGTH) {
      errors.push(`${label}: the pattern must be at most ${MAX_REGEX_LENGTH} characters`);
      return;
    }
    if (!compileRegex(clause.value, clause.caseInsensitive)) {
      errors.push(`${label}: "${clause.value}" is not a valid regular expression`);
      return;
    }
  }

  // ── Left-hand side ─────────────────────────────────────────────────────────
  const sourceStepId = clause.stepId ?? edge.source;
  const step = byId.get(sourceStepId);
  if (!step) {
    errors.push(`${label}: unknown step "${sourceStepId}"`);
    return;
  }

  if (clause.stepId && clause.stepId !== edge.source) {
    if (!(ancestors.get(edge.source)?.has(clause.stepId) ?? false)) {
      errors.push(
        `${label}: "${step.name || sourceStepId}" does not run before this edge, ` +
          `so its output is never available here`,
      );
      return;
    }
    if (dominators && !dominators.get(edge.source)?.has(clause.stepId)) {
      warnings.push(
        `${label}: "${step.name || sourceStepId}" is on a branch that may not run — ` +
          `this condition is false whenever it was skipped`,
      );
    }
  }

  // Schema-aware checks are warnings, never errors: an author may legitimately
  // read a field a step forgot to declare (or a nested path inside one).
  const readsSourceStep = !clause.stepId || clause.stepId === edge.source;
  if (readsSourceStep && isStandardField(clause.field)) return;

  const property = step.outputSchema?.properties?.[clause.field];
  if (!property) {
    const available = Object.keys(step.outputSchema?.properties ?? {});
    warnings.push(
      `${label}: "${step.name || sourceStepId}" declares no output field "${clause.field}"` +
        (available.length > 0 ? ` (declared: ${available.join(', ')})` : ''),
    );
    return;
  }

  if (property.enum && property.enum.length > 0) {
    const values = Array.isArray(clause.value)
      ? clause.value
      : typeof clause.value === 'string' ? [clause.value] : [];
    const outside = values.filter((v) => !property.enum?.includes(v));
    if (outside.length > 0 && (clause.operator === 'eq' || clause.operator === 'neq' || isListOperator(clause.operator))) {
      warnings.push(
        `${label}: "${step.name || sourceStepId}" never produces ${outside.join(', ')} ` +
          `(allowed: ${property.enum.join(', ')})`,
      );
    }
  }
}

// ── Authoring suggestions ────────────────────────────────────────────────────

export interface EdgeFieldSuggestion {
  /** Step the value comes from. Undefined = the edge's source step. */
  stepId?: string;
  stepName: string;
  field: string;
  /** What the author reads in the dropdown. */
  label: string;
  type?: JsonSchemaProperty['type'];
  enum?: string[];
  /** A field every step publishes (result, outcome, deliverable.status…). */
  standard?: boolean;
  /** The source step is on a branch that may not run — same condition as the warning. */
  conditional?: boolean;
}

/**
 * Every field an edge's conditions may legally read, ready to pick.
 *
 * Ordering matters for authoring: the edge's own source step comes first
 * (that's what an author reaches for nine times out of ten), then its ancestors
 * closest-first, so the dropdown reads like walking back up the graph.
 */
export function edgeConditionSuggestions(
  edge: WorkflowEdge,
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId?: string,
): EdgeFieldSuggestion[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const source = byId.get(edge.source);
  if (!source) return [];

  const ancestors = computeAncestors(steps, edges).get(edge.source) ?? new Set<string>();
  const dominators = entryStepId ? computeDominators(steps, edges, entryStepId).get(edge.source) : null;

  const out: EdgeFieldSuggestion[] = [];
  const sourceName = source.name || source.id;

  // The source step: its declared fields, then the standard ones. `stepId` is
  // left undefined so the clause keeps working if the edge is re-parented.
  for (const [field, prop] of Object.entries(source.outputSchema?.properties ?? {})) {
    out.push({
      stepName: sourceName,
      field,
      label: `${sourceName} → ${field}`,
      type: prop.type,
      enum: prop.enum,
    });
  }
  for (const std of STANDARD_FIELDS) {
    out.push({
      stepName: sourceName,
      field: std.field,
      label: `${sourceName} → ${std.field}`,
      type: std.type,
      enum: std.enum,
      standard: true,
    });
  }

  // Ancestors, closest first. Only `schemaFields` travel forward in a run, so
  // the standard fields of an earlier step are deliberately not offered.
  for (const step of orderByDistance(steps, edges, edge.source, ancestors)) {
    const name = step.name || step.id;
    const conditional = dominators ? !dominators.has(step.id) : false;
    for (const [field, prop] of Object.entries(step.outputSchema?.properties ?? {})) {
      out.push({
        stepId: step.id,
        stepName: name,
        field,
        label: `${name} → ${field}`,
        type: prop.type,
        enum: prop.enum,
        conditional,
      });
    }
  }

  return out;
}

/** Ancestors of `from`, nearest first (BFS over reversed edges). */
function orderByDistance(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  from: string,
  keep: Set<string>,
): WorkflowStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const preds = new Map<string, string[]>();
  for (const edge of edges) {
    if (!preds.has(edge.target)) preds.set(edge.target, []);
    preds.get(edge.target)?.push(edge.source);
  }

  const ordered: WorkflowStep[] = [];
  const seen = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const pred of preds.get(id) ?? []) {
        if (seen.has(pred)) continue;
        seen.add(pred);
        next.push(pred);
        const step = byId.get(pred);
        if (step && keep.has(pred)) ordered.push(step);
      }
    }
    frontier = next;
  }
  return ordered;
}
