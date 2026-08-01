/**
 * `{{ … }}` references inside native action parameters.
 *
 * Four forms are understood:
 *   {{ steps.<stepId>.<field> }}  canonical — a schemaField of an upstream step
 *   {{ output.<field> }}          shorthand for the single direct predecessor
 *   {{ ticket.<field> }}          a field of the run's subject ticket
 *   {{ workflow }}                the workflow name
 *
 * Parsing lives in `shared` because both the editor (static validation) and the
 * server (runtime resolution) need exactly the same grammar.
 */

export const REFERENCE_PATTERN = /\{\{([^{}]*)\}\}/g;

export type ReferenceKind = 'step' | 'output' | 'ticket' | 'workflow';

export interface ParsedReference {
  /** The whole `{{ … }}` occurrence, as written. */
  raw: string;
  kind: ReferenceKind;
  /** Set when `kind === 'step'`. */
  stepId?: string;
  /** Set for `step` / `output` / `ticket`. */
  field?: string;
}

/** Ticket fields exposed to `{{ ticket.* }}`. Read-only, deliberately narrow. */
export const TICKET_REFERENCE_FIELDS = [
  'id',
  'displayId',
  'boardId',
  'title',
  'description',
  'status',
  'priority',
  'type',
  'assignee',
  'tags',
] as const;

export type TicketReferenceField = (typeof TICKET_REFERENCE_FIELDS)[number];

export class ReferenceSyntaxError extends Error {}

/**
 * Parse the inner text of one `{{ … }}` occurrence.
 * Throws `ReferenceSyntaxError` when the path is not one of the four forms.
 */
export function parseReferencePath(inner: string, raw: string): ParsedReference {
  const path = inner.trim();
  if (path === '') throw new ReferenceSyntaxError(`empty reference "${raw}"`);

  if (path === 'workflow') return { raw, kind: 'workflow' };

  const parts = path.split('.');

  if (parts[0] === 'steps') {
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      throw new ReferenceSyntaxError(`"${raw}" must be {{ steps.<stepId>.<field> }}`);
    }
    return { raw, kind: 'step', stepId: parts[1], field: parts[2] };
  }

  if (parts[0] === 'output') {
    if (parts.length !== 2 || !parts[1]) {
      throw new ReferenceSyntaxError(`"${raw}" must be {{ output.<field> }}`);
    }
    return { raw, kind: 'output', field: parts[1] };
  }

  if (parts[0] === 'ticket') {
    if (parts.length !== 2 || !parts[1]) {
      throw new ReferenceSyntaxError(`"${raw}" must be {{ ticket.<field> }}`);
    }
    if (!(TICKET_REFERENCE_FIELDS as readonly string[]).includes(parts[1])) {
      throw new ReferenceSyntaxError(
        `"${raw}" — unknown ticket field "${parts[1]}" (allowed: ${TICKET_REFERENCE_FIELDS.join(', ')})`,
      );
    }
    return { raw, kind: 'ticket', field: parts[1] };
  }

  throw new ReferenceSyntaxError(
    `"${raw}" — must start with steps. / output. / ticket. or be {{ workflow }}`,
  );
}

/** Every reference occurring anywhere inside a string value. */
export function findReferences(value: unknown): ParsedReference[] {
  if (typeof value !== 'string') return [];
  const out: ParsedReference[] = [];
  for (const match of value.matchAll(REFERENCE_PATTERN)) {
    out.push(parseReferencePath(match[1] ?? '', match[0]));
  }
  return out;
}

/**
 * When the value is *exactly* one reference (`"{{ output.priority }}"`), returns
 * it. Such references pass the source value through with its original type;
 * references embedded in surrounding text are string-interpolated instead.
 */
export function asFullValueReference(value: unknown): ParsedReference | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const matches = [...trimmed.matchAll(REFERENCE_PATTERN)];
  const only = matches[0];
  if (matches.length !== 1 || !only || only[0] !== trimmed) return null;
  return parseReferencePath(only[1] ?? '', only[0]);
}

export function containsReference(value: unknown): boolean {
  return typeof value === 'string' && REFERENCE_PATTERN.test(resetRegex(value));
}

// `REFERENCE_PATTERN` is a global regex — `.test` advances `lastIndex`, so reset
// before reuse to keep `containsReference` stateless.
function resetRegex(value: string): string {
  REFERENCE_PATTERN.lastIndex = 0;
  return value;
}
