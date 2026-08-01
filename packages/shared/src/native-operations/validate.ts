import type { WorkflowStep, WorkflowEdge, NativeAction, JsonSchemaProperty } from '../types/workflow.js';
import {
  getNativeOperation,
  NATIVE_OP_CREATE_TICKET,
  NATIVE_STEP_KIND_TICKET_ACTIONS,
  type NativeOperationParam,
} from './descriptors.js';
import {
  asFullValueReference,
  findReferences,
  ReferenceSyntaxError,
  TICKET_REFERENCE_FIELDS,
  type ParsedReference,
} from './references.js';

/**
 * Static validation of every `native` step in a template.
 *
 * Pure function, shared by `WorkflowTemplateEntity.validate` (which throws on
 * `errors`) and the web editor (which shows `errors` *and* `warnings` live).
 * One implementation, two consumers — the editor can never disagree with the
 * server about what is saveable.
 */

export interface NativeValidationResult {
  errors: string[];
  warnings: string[];
  /**
   * The same messages grouped by step id. The editor only ever shows the issues
   * of the step being configured, and grouping here means it never has to
   * pattern-match on the message prefix to work out which step an issue is about.
   */
  byStep: Record<string, { errors: string[]; warnings: string[] }>;
}

export function validateNativeSteps(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId?: string,
): NativeValidationResult {
  const byStep: Record<string, { errors: string[]; warnings: string[] }> = {};
  const flatten = (): NativeValidationResult => ({
    errors: Object.values(byStep).flatMap((i) => i.errors),
    warnings: Object.values(byStep).flatMap((i) => i.warnings),
    byStep,
  });

  const nativeSteps = steps.filter((s) => s.executorType === 'native');
  if (nativeSteps.length === 0) return flatten();

  const byId = new Map(steps.map((s) => [s.id, s]));
  const ancestors = computeAncestors(steps, edges);
  const dominators = entryStepId ? computeDominators(steps, edges, entryStepId) : null;

  for (const step of nativeSteps) {
    const where = `step "${step.name || step.id}"`;
    // Every helper below pushes into these two arrays; the flat lists are
    // derived from `byStep` at the end, so the helpers stay unaware of grouping.
    const { errors, warnings } = (byStep[step.id] = { errors: [], warnings: [] } as { errors: string[]; warnings: string[] });

    if (step.executorRef && step.executorRef !== NATIVE_STEP_KIND_TICKET_ACTIONS) {
      errors.push(`${where}: unknown native step kind "${step.executorRef}"`);
    }

    const actions = step.nativeActions ?? [];
    if (actions.length === 0) {
      errors.push(`${where}: a native step must have at least one action`);
      continue;
    }

    validateCreatePlacement(actions, where, errors);

    const inboundCount = edges.filter((e) => e.target === step.id).length;
    const claimedFields = new Map<string, string>();

    for (const action of actions) {
      const op = getNativeOperation(action.operationId);
      if (!op) {
        errors.push(`${where}: unknown operation "${action.operationId}"`);
        continue;
      }
      const label = `${where}, action "${op.label}"`;

      for (const field of op.conflictsOn ?? []) {
        const previous = claimedFields.get(field);
        if (previous) {
          errors.push(
            `${where}: "${previous}" and "${op.label}" both write "${field}" — ` +
              `split them across two steps so the order stays irrelevant`,
          );
        } else {
          claimedFields.set(field, op.label);
        }
      }

      for (const param of op.params) {
        validateParam({
          param,
          value: action.params?.[param.name],
          label,
          step,
          byId,
          ancestors,
          dominators,
          inboundCount,
          edges,
          errors,
          warnings,
        });
      }
    }
  }

  return flatten();
}

function validateCreatePlacement(actions: NativeAction[], where: string, errors: string[]): void {
  const createIndexes = actions
    .map((a, i) => (a.operationId === NATIVE_OP_CREATE_TICKET ? i : -1))
    .filter((i) => i >= 0);
  if (createIndexes.length > 1) {
    errors.push(`${where}: only one "Create ticket" action is allowed per step`);
  }
  if (createIndexes.length === 1 && createIndexes[0] !== 0) {
    errors.push(
      `${where}: "Create ticket" must be the first action — the actions after it apply to the new ticket`,
    );
  }
}

interface ParamValidationCtx {
  param: NativeOperationParam;
  value: unknown;
  label: string;
  step: WorkflowStep;
  byId: Map<string, WorkflowStep>;
  ancestors: Map<string, Set<string>>;
  dominators: Map<string, Set<string>> | null;
  inboundCount: number;
  edges: WorkflowEdge[];
  errors: string[];
  warnings: string[];
}

function validateParam(ctx: ParamValidationCtx): void {
  const { param, value, label, errors } = ctx;
  const missing = value === undefined || value === null || value === '';

  if (missing) {
    if (param.required && !param.nullable) {
      errors.push(`${label}: "${param.label}" is required`);
    }
    return;
  }

  let references: ParsedReference[];
  try {
    references = findReferences(value);
  } catch (e) {
    errors.push(`${label}: ${e instanceof ReferenceSyntaxError ? e.message : String(e)}`);
    return;
  }

  if (references.length === 0) {
    validateLiteral(param, value, label, errors);
    return;
  }

  if (param.allowReference === false) {
    errors.push(`${label}: "${param.label}" does not accept {{ … }} references`);
    return;
  }

  const fullValue = asFullValueReference(value);
  if (!fullValue && !isTextual(param.type)) {
    errors.push(
      `${label}: "${param.label}" is ${param.type} — a reference must be the whole value ` +
        `(e.g. "{{ output.${param.name} }}"), not embedded in text`,
    );
    return;
  }

  for (const ref of references) {
    validateReference(ctx, ref, Boolean(fullValue));
  }
}

function validateReference(ctx: ParamValidationCtx, ref: ParsedReference, isFullValue: boolean): void {
  const { param, label, step, byId, ancestors, dominators, inboundCount, edges, errors, warnings } = ctx;

  if (ref.kind === 'workflow' || ref.kind === 'ticket') return; // always available at runtime

  let sourceStepId: string | undefined;

  if (ref.kind === 'output') {
    if (inboundCount !== 1) {
      errors.push(
        `${label}: ${ref.raw} needs exactly one incoming edge (this step has ${inboundCount}) — ` +
          `use {{ steps.<stepId>.${ref.field} }} instead`,
      );
      return;
    }
    sourceStepId = edges.find((e) => e.target === step.id)?.source;
  } else {
    sourceStepId = ref.stepId;
  }

  if (!sourceStepId) return;

  const source = byId.get(sourceStepId);
  if (!source) {
    errors.push(`${label}: ${ref.raw} points at unknown step "${sourceStepId}"`);
    return;
  }

  if (!(ancestors.get(step.id)?.has(sourceStepId) ?? false)) {
    errors.push(
      `${label}: ${ref.raw} points at "${source.name || sourceStepId}", which does not run before this step`,
    );
    return;
  }

  if (!source.outputSchema) {
    errors.push(
      `${label}: ${ref.raw} — step "${source.name || sourceStepId}" declares no output schema, ` +
        `so it produces no fields to read`,
    );
    return;
  }

  const property = source.outputSchema.properties?.[ref.field ?? ''];
  if (!property) {
    const available = Object.keys(source.outputSchema.properties ?? {});
    errors.push(
      `${label}: ${ref.raw} — "${source.name || sourceStepId}" has no output field "${ref.field}"` +
        (available.length > 0 ? ` (available: ${available.join(', ')})` : ''),
    );
    return;
  }

  if (isFullValue) {
    checkTypeCompatibility(param, property, ref, label, errors, warnings);
  }

  if (dominators && !dominators.get(step.id)?.has(sourceStepId)) {
    warnings.push(
      `${label}: ${ref.raw} — "${source.name || sourceStepId}" is on a branch that may not run; ` +
        `the step will fail at runtime if it was skipped`,
    );
  }
}

function checkTypeCompatibility(
  param: NativeOperationParam,
  property: JsonSchemaProperty,
  ref: ParsedReference,
  label: string,
  errors: string[],
  warnings: string[],
): void {
  const expected = expectedSchemaType(param.type);
  if (property.type !== expected) {
    errors.push(
      `${label}: ${ref.raw} is ${property.type}, but "${param.label}" expects ${param.type}`,
    );
    return;
  }

  if (param.type !== 'enum' || !param.enum) return;

  if (!property.enum || property.enum.length === 0) {
    warnings.push(
      `${label}: ${ref.raw} has no enum constraint — the value is only checked at runtime ` +
        `(allowed: ${param.enum.join(', ')})`,
    );
    return;
  }
  const outside = property.enum.filter((v) => !param.enum?.includes(v));
  if (outside.length > 0) {
    warnings.push(
      `${label}: ${ref.raw} can produce ${outside.join(', ')}, which "${param.label}" rejects`,
    );
  }
}

function expectedSchemaType(type: NativeOperationParam['type']): JsonSchemaProperty['type'] {
  switch (type) {
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'string[]': return 'array';
    default: return 'string';
  }
}

function isTextual(type: NativeOperationParam['type']): boolean {
  return type === 'string' || type === 'text';
}

export interface ReferenceSuggestion {
  /** The exact text to insert — always the step *id*, never its name. */
  token: string;
  /** What the author reads, built from the step *name*. */
  label: string;
  group: 'Steps' | 'Ticket' | 'Workflow';
  /** The source step is on a branch that may not run — same condition as the warning. */
  conditional?: boolean;
}

/**
 * Every `{{ … }}` a given native step may legally use, ready to insert.
 *
 * Lives next to the validator on purpose: the picker offers exactly what
 * `validateNativeSteps` accepts, so an author can never build a reference from
 * the UI that the server then refuses. It also keeps step *ids* out of the
 * author's face — they pick "Qualify idea → priority" and the editor inserts
 * `{{ steps.<uuid>.priority }}`, which survives renaming the step.
 */
export function nativeReferenceSuggestions(
  step: WorkflowStep,
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId?: string,
): ReferenceSuggestion[] {
  const out: ReferenceSuggestion[] = [];
  const ancestors = computeAncestors(steps, edges).get(step.id) ?? new Set<string>();
  const dominators = entryStepId ? computeDominators(steps, edges, entryStepId).get(step.id) : null;

  const inbound = edges.filter((e) => e.target === step.id);
  const solePredecessorId = inbound.length === 1 ? inbound[0]?.source : undefined;

  for (const source of steps) {
    if (!ancestors.has(source.id)) continue;
    const fields = Object.keys(source.outputSchema?.properties ?? {});
    const conditional = dominators ? !dominators.has(source.id) : false;
    const name = source.name || source.id;
    for (const field of fields) {
      out.push({
        token: `{{ steps.${source.id}.${field} }}`,
        label: `${name} → ${field}`,
        group: 'Steps',
        conditional,
      });
      // The `{{ output.<field> }}` shorthand is only valid — and only
      // unambiguous — when the step has exactly one incoming edge.
      if (source.id === solePredecessorId) {
        out.push({
          token: `{{ output.${field} }}`,
          label: `previous step → ${field}`,
          group: 'Steps',
          conditional,
        });
      }
    }
  }

  for (const field of TICKET_REFERENCE_FIELDS) {
    out.push({ token: `{{ ticket.${field} }}`, label: `ticket.${field}`, group: 'Ticket' });
  }
  out.push({ token: '{{ workflow }}', label: 'workflow name', group: 'Workflow' });

  return out;
}

/**
 * Re-check an action's parameters *after* `{{ … }}` substitution.
 *
 * Static validation can only promise so much about a referenced value (an
 * upstream schema may declare a plain string where an enum is expected), so the
 * resolved values are checked again before anything is written. Returns the
 * error messages; empty means good to run.
 */
export function validateResolvedParams(
  operationId: string,
  params: Record<string, unknown>,
): string[] {
  const op = getNativeOperation(operationId);
  if (!op) return [`unknown operation "${operationId}"`];

  const errors: string[] = [];
  for (const param of op.params) {
    const value = params[param.name];
    if (value === undefined || value === null || value === '') {
      if (param.required && !param.nullable) {
        errors.push(`${op.label}: "${param.label}" is required`);
      }
      continue;
    }
    validateLiteral(param, value, op.label, errors);
  }
  return errors;
}

function validateLiteral(
  param: NativeOperationParam,
  value: unknown,
  label: string,
  errors: string[],
): void {
  switch (param.type) {
    case 'enum':
      if (typeof value !== 'string' || !param.enum?.includes(value)) {
        errors.push(
          `${label}: "${param.label}" must be one of ${param.enum?.join(', ')} (got ${JSON.stringify(value)})`,
        );
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${label}: "${param.label}" must be a boolean`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${label}: "${param.label}" must be a number`);
      }
      break;
    case 'string[]':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        errors.push(`${label}: "${param.label}" must be a list of strings`);
      }
      break;
    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        errors.push(`${label}: "${param.label}" must be a valid date`);
      }
      break;
    default:
      if (typeof value !== 'string') {
        errors.push(`${label}: "${param.label}" must be a string`);
      }
  }
}

// ── Graph helpers ────────────────────────────────────────────────────────────

/** For each step, the set of steps that can reach it (transitive predecessors). */
function computeAncestors(steps: WorkflowStep[], edges: WorkflowEdge[]): Map<string, Set<string>> {
  const preds = new Map<string, string[]>();
  for (const step of steps) preds.set(step.id, []);
  for (const edge of edges) preds.get(edge.target)?.push(edge.source);

  const result = new Map<string, Set<string>>();
  for (const step of steps) {
    const seen = new Set<string>();
    const queue = [...(preds.get(step.id) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      queue.push(...(preds.get(current) ?? []));
    }
    result.set(step.id, seen);
  }
  return result;
}

/**
 * Classic iterative dominator analysis. `X ∈ dom(S)` means every path from the
 * entry step to S passes through X — i.e. if S runs, X is guaranteed to have
 * run. Anything weaker only warrants a warning, because a step on a
 * not-taken branch never lands in `previousOutputs`.
 */
function computeDominators(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId: string,
): Map<string, Set<string>> {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const step of steps) {
    preds.set(step.id, []);
    succs.set(step.id, []);
  }
  for (const edge of edges) {
    preds.get(edge.target)?.push(edge.source);
    succs.get(edge.source)?.push(edge.target);
  }

  // Restrict the analysis to what the entry can actually reach.
  const reachable = new Set<string>([entryStepId]);
  const queue = [entryStepId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of succs.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const dom = new Map<string, Set<string>>();
  for (const id of reachable) {
    dom.set(id, id === entryStepId ? new Set([entryStepId]) : new Set(reachable));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachable) {
      if (id === entryStepId) continue;
      const livePreds = (preds.get(id) ?? []).filter((p) => reachable.has(p));
      let next: Set<string>;
      if (livePreds.length === 0) {
        next = new Set([id]);
      } else {
        const first = dom.get(livePreds[0] as string) ?? new Set<string>();
        next = new Set(first);
        for (const p of livePreds.slice(1)) {
          const other = dom.get(p) ?? new Set<string>();
          for (const value of [...next]) if (!other.has(value)) next.delete(value);
        }
        next.add(id);
      }
      const current = dom.get(id);
      if (!current || current.size !== next.size || [...next].some((v) => !current.has(v))) {
        dom.set(id, next);
        changed = true;
      }
    }
  }
  return dom;
}
