import type {
  EdgeConditionClause,
  EdgeOperator,
  JsonSchemaProperty,
  WorkflowEdge,
  WorkflowEdgeConditionGroup,
} from '../types/workflow.js';

/**
 * Everything the product needs to read, evaluate and render an edge condition.
 *
 * Lives in `shared` on purpose: the runtime evaluator (server), the save-time
 * validator (server), the agent prompt (server), the DAG labels and the edge
 * editor (web) all go through this one module, so none of them can disagree
 * about what a condition means.
 */

export const EDGE_OPERATORS: readonly EdgeOperator[] = [
  'eq', 'neq',
  'in', 'not_in',
  'gt', 'gte', 'lt', 'lte',
  'contains', 'not_contains',
  'starts_with', 'ends_with',
  'matches',
  'is_empty', 'is_not_empty',
  'is_true', 'is_false',
];

/** Operators that take no right-hand side. */
export const UNARY_OPERATORS: readonly EdgeOperator[] = [
  'is_empty', 'is_not_empty', 'is_true', 'is_false',
];

/** Operators whose value is a list. */
export const LIST_OPERATORS: readonly EdgeOperator[] = ['in', 'not_in'];

/** Operators whose comparison is textual — the only ones `caseInsensitive` affects. */
export const TEXT_OPERATORS: readonly EdgeOperator[] = [
  'eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'starts_with', 'ends_with', 'matches',
];

/** A regex longer than this is refused at save time — see the ReDoS note in the PRD. */
export const MAX_REGEX_LENGTH = 200;

export function isUnaryOperator(op: EdgeOperator): boolean {
  return UNARY_OPERATORS.includes(op);
}

export function isListOperator(op: EdgeOperator): boolean {
  return LIST_OPERATORS.includes(op);
}

const OPERATOR_LABELS: Record<EdgeOperator, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches: 'matches',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_true: 'is true',
  is_false: 'is false',
};

export function operatorLabel(op: EdgeOperator): string {
  return OPERATOR_LABELS[op] ?? op;
}

/**
 * Operators offered for a field of a given declared type.
 *
 * Unknown type (free-text field, or a step with no output schema) means "offer
 * everything" — the author knows something the schema doesn't.
 */
export function operatorsForType(type?: JsonSchemaProperty['type']): EdgeOperator[] {
  switch (type) {
    case 'boolean':
      return ['is_true', 'is_false', 'eq', 'neq', 'is_empty', 'is_not_empty'];
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_empty', 'is_not_empty'];
    case 'array':
      return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    case 'string':
      return [
        'eq', 'neq', 'in', 'not_in',
        'contains', 'not_contains', 'starts_with', 'ends_with', 'matches',
        'gt', 'gte', 'lt', 'lte',
        'is_empty', 'is_not_empty',
      ];
    default:
      return [...EDGE_OPERATORS];
  }
}

/**
 * The single condition an edge carries, whatever format it was saved in.
 *
 * `edges` is a JSONB column, so the legacy single-condition shape is upgraded
 * lazily here rather than by a migration: runs already in flight keep working
 * off their (un-migrated) template snapshot, and a template is only rewritten
 * the next time an author saves it from the editor.
 */
export function normalizeEdgeCondition(edge: WorkflowEdge): WorkflowEdgeConditionGroup | null {
  if (edge.conditionGroup && edge.conditionGroup.clauses.length > 0) return edge.conditionGroup;
  if (edge.condition && edge.condition.field) {
    return {
      match: 'all',
      clauses: [{
        field: edge.condition.field,
        operator: edge.condition.operator,
        value: edge.condition.value,
      }],
    };
  }
  return null;
}

/** Read a dotted path out of an arbitrary object, returning `undefined` on any miss. */
export function getByPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Evaluate a whole group. `readField` returns the live value for one clause —
 * the caller owns where values come from (a run's step outputs on the server,
 * nothing at all in a future editor preview).
 */
export function evaluateConditionGroup(
  group: WorkflowEdgeConditionGroup,
  readField: (clause: EdgeConditionClause) => unknown,
): boolean {
  if (group.clauses.length === 0) return false;
  if (group.match === 'any') {
    return group.clauses.some((clause) => evaluateClause(readField(clause), clause));
  }
  return group.clauses.every((clause) => evaluateClause(readField(clause), clause));
}

/**
 * Evaluate one clause against an already-resolved value.
 *
 * Missing data (an absent field, or a step on a branch that never ran) makes a
 * clause false for every operator but `is_empty`. Notably `neq` / `not_in` /
 * `not_contains` do NOT fire on missing data: routing a run down a branch
 * because a value is absent is almost always an accident, not an intent.
 */
export function evaluateClause(actual: unknown, clause: EdgeConditionClause): boolean {
  const { operator, caseInsensitive } = clause;
  const missing = actual === undefined || actual === null;

  if (operator === 'is_empty') return missing || isEmptyValue(actual);
  if (missing) return false;
  if (operator === 'is_not_empty') return !isEmptyValue(actual);
  if (operator === 'is_true') return isTruthyFlag(actual) === true;
  if (operator === 'is_false') return isTruthyFlag(actual) === false;

  const value = clause.value;

  switch (operator) {
    // eq/neq coerce `actual` to string to match the always-string `value`
    // (agents may emit numbers/bools that edges compare against `"high"` or `"10"`).
    case 'eq':
      return typeof value === 'string' && textEquals(String(actual), value, caseInsensitive);
    case 'neq':
      return typeof value === 'string' && !textEquals(String(actual), value, caseInsensitive);
    case 'in':
      return Array.isArray(value) && value.some((v) => textEquals(String(actual), v, caseInsensitive));
    case 'not_in':
      return Array.isArray(value) && !value.some((v) => textEquals(String(actual), v, caseInsensitive));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = Number(actual);
      const v = Number(typeof value === 'string' ? value : NaN);
      if (!Number.isFinite(a) || !Number.isFinite(v)) return false;
      if (operator === 'gt') return a > v;
      if (operator === 'gte') return a >= v;
      if (operator === 'lt') return a < v;
      return a <= v;
    }
    case 'contains':
    case 'not_contains': {
      if (typeof value !== 'string') return false;
      const hit = containsValue(actual, value, caseInsensitive);
      return operator === 'contains' ? hit : !hit;
    }
    case 'starts_with':
      return typeof actual === 'string' && typeof value === 'string'
        && fold(actual, caseInsensitive).startsWith(fold(value, caseInsensitive));
    case 'ends_with':
      return typeof actual === 'string' && typeof value === 'string'
        && fold(actual, caseInsensitive).endsWith(fold(value, caseInsensitive));
    case 'matches': {
      if (typeof value !== 'string') return false;
      const re = compileRegex(value, caseInsensitive);
      // An invalid pattern is rejected at save time; at runtime (legacy rows,
      // snapshots) it must not take down the run — the clause is simply false.
      return re ? re.test(String(actual)) : false;
    }
    default:
      return false;
  }
}

/** `null` when the pattern does not compile — callers decide what that means. */
export function compileRegex(pattern: string, caseInsensitive?: boolean): RegExp | null {
  try {
    return new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch {
    return null;
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** `undefined` when the value is not recognisably boolean-ish. */
function isTruthyFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return undefined;
}

function fold(value: string, caseInsensitive?: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

function textEquals(a: string, b: string, caseInsensitive?: boolean): boolean {
  return fold(a, caseInsensitive) === fold(b, caseInsensitive);
}

/** `contains` reads an array as membership and anything else as a substring test. */
function containsValue(actual: unknown, value: string, caseInsensitive?: boolean): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => textEquals(String(item), value, caseInsensitive));
  }
  if (typeof actual !== 'string') return false;
  return fold(actual, caseInsensitive).includes(fold(value, caseInsensitive));
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Human-readable form of a condition group — DAG labels, run view, agent prompt
 * and CLI all render conditions through this, so an author reads the same
 * sentence everywhere.
 */
export function formatEdgeCondition(
  group: WorkflowEdgeConditionGroup | null,
  steps?: { id: string; name?: string }[],
): string {
  if (!group || group.clauses.length === 0) return '';
  const joiner = group.match === 'any' ? ' OR ' : ' AND ';
  return group.clauses.map((clause) => formatClause(clause, steps)).join(joiner);
}

export function formatClause(
  clause: EdgeConditionClause,
  steps?: { id: string; name?: string }[],
): string {
  const stepName = clause.stepId
    ? steps?.find((s) => s.id === clause.stepId)?.name || clause.stepId
    : undefined;
  const field = stepName ? `${stepName}.${clause.field}` : clause.field;
  const op = operatorLabel(clause.operator);
  if (isUnaryOperator(clause.operator)) return `${field} ${op}`;
  const value = Array.isArray(clause.value)
    ? clause.value.join(', ')
    : String(clause.value ?? '');
  return `${field} ${op} ${value}`;
}
