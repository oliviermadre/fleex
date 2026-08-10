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
  /**
   * The current element of a `forEach` fan-out. `undefined` (not `null`) when
   * the step does not iterate — `null` is a legal element value.
   */
  item?: unknown;
  /** Identifiers of the ticket this step's own `ticket.create` just made. */
  created?: Record<string, unknown> | null;
}

export interface ResolveOptions {
  /**
   * Leave `{{ created.* }}` occurrences untouched instead of failing on them.
   *
   * `apply-native-actions` resolves and validates everything *before* its first
   * write, and `created.*` is by construction unknowable at that point. This
   * flag lets the pre-write pass check every other reference — the whole point
   * of that pass — while deferring only the ones that genuinely cannot be
   * answered yet. Resolution is pure, so re-running it afterwards is free.
   */
  tolerateCreated?: boolean;
  /**
   * Params that may simply disappear when `{{ ticket.* }}` has no ticket to
   * read. Only reachable in a routine run: a ticket run always has a subject,
   * so nothing is ever dropped there.
   */
  droppableWithoutTicket?: ReadonlySet<string>;
}

export function resolveParams(
  params: Record<string, unknown>,
  ctx: RuntimeReferenceContext,
  options: ResolveOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (
      ctx.ticket === null
      && options.droppableWithoutTicket?.has(key)
      && referencesTicket(value)
    ) {
      // Dropped, not blanked: an optional param that defaults to a ticket field
      // has to behave as "unset" when there is no ticket, so the cascade that
      // owns the fallback (board of the routine's subject, say) can take over.
      continue;
    }
    out[key] = resolveValue(value, ctx, options);
  }
  return out;
}

function referencesTicket(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return findReferences(value).some((r) => r.kind === 'ticket');
  } catch {
    return false;
  }
}

export function resolveValue(
  value: unknown,
  ctx: RuntimeReferenceContext,
  options: ResolveOptions = {},
): unknown {
  if (typeof value !== 'string') return value;
  if (findReferences(value).length === 0) return value;

  // Whole-value reference: pass the source through with its original type, so
  // numbers, booleans and arrays survive instead of being stringified.
  const full = asFullValueReference(value);
  if (full) {
    if (options.tolerateCreated && full.kind === 'created') return value;
    return lookup(full, ctx);
  }

  return value.replace(REFERENCE_PATTERN, (raw, inner: string) => {
    const ref = parse(inner, raw);
    if (options.tolerateCreated && ref.kind === 'created') return raw;
    const resolved = lookup(ref, ctx);
    return resolved === null || resolved === undefined ? '' : String(resolved);
  });
}

/** Whether a value still holds an unsubstituted `{{ created.* }}` placeholder. */
export function hasPendingCreatedReference(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return findReferences(value).some((r) => r.kind === 'created');
  } catch {
    return false;
  }
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

    case 'item': {
      if (ctx.item === undefined) {
        throw new ReferenceResolutionError(
          `${ref.raw} — no item in scope (only a step with a forEach binds one)`,
        );
      }
      if (!ref.field) return ctx.item;
      return readItemPath(ctx.item, ref);
    }

    case 'created': {
      if (!ctx.created) {
        throw new ReferenceResolutionError(
          `${ref.raw} — no ticket was created by this step`,
        );
      }
      const value = ctx.created[ref.field ?? ''];
      if (value === undefined) {
        throw new ReferenceResolutionError(`${ref.raw} — created ticket has no field "${ref.field}"`);
      }
      return value;
    }
  }
}

/**
 * Walks `{{ item.a.b }}` into the element. Throws rather than returning
 * `undefined` for the same reason as every other lookup here: a typo in the
 * path must fail the step, not blank a field on 30 tickets in a row.
 */
function readItemPath(item: unknown, ref: ParsedReference): unknown {
  return walkPath(item, (ref.field ?? '').split('.'), ref, 'item');
}

function walkPath(root: unknown, segments: string[], ref: ParsedReference, what: string): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') {
      throw new ReferenceResolutionError(
        `${ref.raw} — ${what} is ${cursor === null ? 'null' : typeof cursor}, it has no "${segment}"`,
      );
    }
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) {
      throw new ReferenceResolutionError(`${ref.raw} — ${what} has no "${segment}"`);
    }
  }
  return cursor;
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
  // A deep reference digs into the object field, same walk as {{ item.a.b }}
  // — the trigger step's webhook payload is the motivating case.
  if (ref.path) return walkPath(value, ref.path.split('.'), ref, `"${ref.field}"`);
  return value;
}
