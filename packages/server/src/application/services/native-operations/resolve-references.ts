import {
  asFullValueReference,
  findReferences,
  REFERENCE_PATTERN,
  type ParsedReference,
} from '@fleex/shared';

/**
 * Runtime substitution of `{{ … }}` inside native action parameters.
 *
 * There is deliberately no fallback: an unresolved reference throws instead of
 * quietly becoming `""` or `undefined`. A native step is supposed to be
 * deterministic, so its failure mode has to be loud — a step on a branch that
 * never ran must fail the step, not silently blank a field.
 */

export class ReferenceResolutionError extends Error {}

export interface RuntimeReferenceContext {
  /** `previousOutputs` — schemaFields of every completed upstream step. */
  steps: Record<string, Record<string, unknown>>;
  /** Subject ticket fields exposed to `{{ ticket.* }}`; null before creation. */
  ticket: Record<string, unknown> | null;
  workflowName: string;
  /** Direct predecessors of the current step, for `{{ output.* }}`. */
  predecessorStepIds: string[];
}

export function resolveParams(
  params: Record<string, unknown>,
  ctx: RuntimeReferenceContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] = resolveValue(value, ctx);
  }
  return out;
}

export function resolveValue(value: unknown, ctx: RuntimeReferenceContext): unknown {
  if (typeof value !== 'string') return value;
  if (findReferences(value).length === 0) return value;

  // Whole-value reference: pass the source through with its original type, so
  // numbers, booleans and arrays survive instead of being stringified.
  const full = asFullValueReference(value);
  if (full) return lookup(full, ctx);

  return value.replace(REFERENCE_PATTERN, (raw, inner: string) => {
    const ref = parse(inner, raw);
    const resolved = lookup(ref, ctx);
    return resolved === null || resolved === undefined ? '' : String(resolved);
  });
}

function parse(inner: string, raw: string): ParsedReference {
  const [ref] = findReferences(raw);
  if (ref) return ref;
  throw new ReferenceResolutionError(`cannot parse reference "${raw}" (${inner})`);
}

function lookup(ref: ParsedReference, ctx: RuntimeReferenceContext): unknown {
  switch (ref.kind) {
    case 'workflow':
      return ctx.workflowName;

    case 'ticket': {
      if (!ctx.ticket) {
        throw new ReferenceResolutionError(`${ref.raw} — no subject ticket available yet`);
      }
      const value = ctx.ticket[ref.field ?? ''];
      if (value === undefined) {
        throw new ReferenceResolutionError(`${ref.raw} — ticket has no field "${ref.field}"`);
      }
      return value;
    }

    case 'output': {
      if (ctx.predecessorStepIds.length !== 1) {
        throw new ReferenceResolutionError(
          `${ref.raw} — needs exactly one incoming edge (found ${ctx.predecessorStepIds.length})`,
        );
      }
      return readStepField(ctx.predecessorStepIds[0] as string, ref, ctx);
    }

    case 'step':
      return readStepField(ref.stepId as string, ref, ctx);
  }
}

function readStepField(
  stepId: string,
  ref: ParsedReference,
  ctx: RuntimeReferenceContext,
): unknown {
  const output = ctx.steps[stepId];
  if (!output) {
    throw new ReferenceResolutionError(
      `${ref.raw} — step "${stepId}" has not completed in this run (a skipped or failed step produces no output)`,
    );
  }
  const value = output[ref.field ?? ''];
  if (value === undefined) {
    const available = Object.keys(output);
    throw new ReferenceResolutionError(
      `${ref.raw} — step "${stepId}" produced no field "${ref.field}"` +
        (available.length > 0 ? ` (got: ${available.join(', ')})` : ' (empty output)'),
    );
  }
  return value;
}
