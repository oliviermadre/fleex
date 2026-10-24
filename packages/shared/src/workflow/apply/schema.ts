import { EDGE_OPERATORS } from '../edge-conditions.js';
import type { WorkflowExecutorType } from '../../types/workflow.js';

/**
 * The shape of a workflow template document — the single source of truth for
 * "which keys exist, with which types".
 *
 * The same literal object is (a) interpreted by `checkDocumentShape` below and
 * (b) printed verbatim by `fleex workflow apply --documentation`. Enums are built
 * from the runtime constants, never copied by hand, so the doc cannot drift
 * from what the validator accepts.
 *
 * Only a subset of JSON Schema is used — the subset `checkDocumentShape`
 * understands: `type`, `enum`, `required`, `pattern`, `minLength`, `minItems`,
 * `items`, `properties`, `additionalProperties`, `$ref` (to `#/$defs/*`). A key
 * outside that list would be silently ignored by the interpreter, so a test
 * walks the schema and fails on any other keyword.
 */

export const EXECUTOR_TYPES: readonly WorkflowExecutorType[] = [
  'agent', 'skill', 'panel', 'human_gate', 'native', 'route',
];
export const STEP_MODES = ['talk', 'plan', 'edit'] as const;
export const CONDITION_MATCH_MODES = ['all', 'any'] as const;
export const OUTPUT_PROPERTY_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;
export const SLUG_PATTERN_SOURCE = '^[a-z0-9_-]+$';

export interface SchemaNode {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: readonly unknown[];
  required?: readonly string[];
  pattern?: string;
  minLength?: number;
  minItems?: number;
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  /** Accepted, shape-checked, but documented as refused by `apply`. */
  deprecated?: boolean;
  /** Read-only on input: accepted so an export re-applies, never written. */
  readOnly?: boolean;
  $ref?: string;
  $schema?: string;
  $defs?: Record<string, SchemaNode>;
}

export const WORKFLOW_DOCUMENT_SCHEMA: SchemaNode = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'workflow document',
  description:
    'A whole Fleex workflow template. `fleex workflow apply` creates it when no template has this slug, '
    + 'and replaces it entirely otherwise.',
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'name', 'entryStepId', 'steps', 'edges'],
  properties: {
    slug: {
      type: 'string',
      pattern: SLUG_PATTERN_SOURCE,
      description: 'Upsert key, and the @workflow:<slug> handle. Lowercase letters, digits, "-" and "_".',
    },
    name: { type: 'string', minLength: 1, description: 'Display name.' },
    emoji: { type: 'string', description: 'Optional, defaults to "".' },
    description: { type: 'string', description: 'Optional, defaults to "".' },
    enabled: {
      type: 'boolean',
      description:
        'Optional. On create: defaults to true. On replace: when absent, the current value is kept '
        + '(leaving it out never disables a workflow).',
    },
    // No minLength: an empty entryStepId is reported by entry.exists, which names the valid ids.
    entryStepId: { type: 'string', description: 'Id of the step every run starts with.' },
    steps: { type: 'array', items: { $ref: '#/$defs/step' }, description: 'At least one step.' },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' }, description: 'Transitions between steps.' },
    id: {
      type: 'string',
      readOnly: true,
      description: 'Read-only, accepted so `fleex workflow show <slug> --json` re-applies. The template is matched by slug.',
    },
    createdAt: { type: 'string', readOnly: true, description: 'Read-only, ignored.' },
    updatedAt: { type: 'string', readOnly: true, description: 'Read-only, ignored.' },
  },
  $defs: {
    step: {
      title: 'step',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'executorType', 'executorRef'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description: 'Free-form, unique among steps, kept as-is. Readable ids ("spec", "review") are encouraged.',
        },
        name: { type: 'string', minLength: 1, description: 'Display name.' },
        executorType: { type: 'string', enum: EXECUTOR_TYPES, description: 'Who runs the step. See Capabilities.' },
        executorRef: {
          type: 'string',
          description: 'What runs it: an agent name, a skill command name, a panel name, "ticket.actions" for native, "" for human_gate and route.',
        },
        position: {
          $ref: '#/$defs/position',
          description: 'Optional. Missing positions are computed (layered layout from the entry step).',
        },
        prompt: { type: 'string', description: 'Instructions given to the agent / skill / panel for this step.' },
        mode: { type: 'string', enum: STEP_MODES, description: 'Agent execution mode. Defaults to "edit".' },
        outputSchema: {
          $ref: '#/$defs/outputSchema',
          description: 'Structured fields the step must produce. Edge conditions and {{ steps.<id>.<field> }} references read them.',
        },
        humanGateOutcomes: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'human_gate only: the decisions a human can pick (at least 2).',
        },
        nativeActions: {
          type: 'array',
          items: { $ref: '#/$defs/nativeAction' },
          description: 'native only: the deterministic operations to run, in order (at least 1).',
        },
        forEach: {
          type: 'string',
          description: 'native only: "{{ steps.<stepId>.<arrayField> }}" — run the actions once per element, with {{ item.* }} bound.',
        },
      },
    },
    position: {
      title: 'position',
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    outputSchema: {
      title: 'outputSchema',
      type: 'object',
      additionalProperties: false,
      required: ['type', 'properties'],
      properties: {
        type: { type: 'string', enum: ['object'] },
        properties: { type: 'object', additionalProperties: { $ref: '#/$defs/outputProperty' } },
        required: { type: 'array', items: { type: 'string' } },
      },
    },
    outputProperty: {
      title: 'output property',
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: OUTPUT_PROPERTY_TYPES },
        enum: { type: 'array', items: { type: 'string' }, description: 'Closed list of values (string fields).' },
        description: { type: 'string' },
        items: { $ref: '#/$defs/outputProperty', description: 'Element schema of an array field.' },
        properties: { type: 'object', additionalProperties: { $ref: '#/$defs/outputProperty' } },
      },
    },
    nativeAction: {
      title: 'native action',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'operationId', 'params'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Unique within the step.' },
        operationId: { type: 'string', minLength: 1, description: 'A native operation id. See Capabilities.' },
        params: {
          type: 'object',
          additionalProperties: true,
          description: 'The operation parameters. Values are literals or {{ … }} references. See Capabilities.',
        },
      },
    },
    edge: {
      title: 'edge',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'source', 'target', 'isDefault'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Free-form, unique among edges, kept as-is.' },
        source: { type: 'string', minLength: 1, description: 'Id of the step the edge leaves.' },
        target: { type: 'string', minLength: 1, description: 'Id of the step the edge enters.' },
        isDefault: {
          type: 'boolean',
          description: 'true = taken when no conditional edge of the same source matches (evaluated last, at most one per source).',
        },
        conditionGroup: { $ref: '#/$defs/conditionGroup', description: 'Required when isDefault is false.' },
        label: { type: 'string', description: 'Optional text shown on the edge.' },
        condition: {
          type: 'object',
          deprecated: true,
          description: 'Legacy single condition. Still read by the editor, refused by `apply`: use conditionGroup.',
        },
      },
    },
    conditionGroup: {
      title: 'conditionGroup',
      type: 'object',
      additionalProperties: false,
      required: ['match', 'clauses'],
      properties: {
        match: { type: 'string', enum: CONDITION_MATCH_MODES, description: '"all" = AND, "any" = OR.' },
        clauses: { type: 'array', minItems: 1, items: { $ref: '#/$defs/clause' } },
      },
    },
    clause: {
      title: 'clause',
      type: 'object',
      additionalProperties: false,
      required: ['field', 'operator'],
      properties: {
        stepId: {
          type: 'string',
          description: 'Step whose output is read. Absent = the edge source. Must run before the edge.',
        },
        field: { type: 'string', description: 'A standard field, or a field of the read step\'s outputSchema.' },
        operator: { type: 'string', enum: EDGE_OPERATORS },
        value: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description: 'Absent for unary operators, a list for in / not_in, a string otherwise.',
        },
        caseInsensitive: { type: 'boolean', description: 'Text operators only. Defaults to false.' },
      },
    },
  },
};

// ── Interpreter ─────────────────────────────────────────────────────────────

export interface ShapeIssue {
  kind: 'unknown_field' | 'shape';
  /** JSONPath-like: `$.steps[2].executorType`. */
  path: string;
  message: string;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function resolve(node: SchemaNode, root: SchemaNode): SchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.replace('#/$defs/', '');
  const target = root.$defs?.[name];
  if (!target) throw new Error(`schema: unresolved $ref ${node.$ref}`);
  return target;
}

/**
 * Check `value` against the document schema and return EVERY violation, each
 * with its path — never just the first one.
 */
export function checkDocumentShape(value: unknown, schema: SchemaNode = WORKFLOW_DOCUMENT_SCHEMA): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  walk(value, schema, schema, '$', issues);
  return issues;
}

function walk(value: unknown, rawNode: SchemaNode, root: SchemaNode, path: string, issues: ShapeIssue[]): void {
  const node = resolve(rawNode, root);

  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => matchesType(value, t))) {
      issues.push({
        kind: 'shape',
        path,
        message: `${path} must be ${types.map(article).join(' or ')} (got ${typeOf(value) === 'integer' ? 'number' : typeOf(value)})`,
      });
      return;
    }
  }

  if (node.enum && !node.enum.includes(value)) {
    issues.push({
      kind: 'shape',
      path,
      message: `${path} must be one of ${node.enum.join(', ')} (got ${JSON.stringify(value)})`,
    });
    return;
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      issues.push({ kind: 'shape', path, message: `${path} must be a non-empty string` });
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      issues.push({
        kind: 'shape',
        path,
        message: `${path} must match ${node.pattern} (got ${JSON.stringify(value)})`,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      issues.push({ kind: 'shape', path, message: `${path} must contain at least ${node.minItems} item(s)` });
    }
    if (node.items) {
      value.forEach((item, i) => walk(item, node.items as SchemaNode, root, `${path}[${i}]`, issues));
    }
    return;
  }

  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of node.required ?? []) {
      if (obj[key] === undefined) {
        issues.push({ kind: 'shape', path: `${path}.${key}`, message: `${path}.${key} is required` });
      }
    }
    const declared = node.properties ?? {};
    for (const [key, child] of Object.entries(obj)) {
      // A JS object built in code may carry `key: undefined`; JSON never does. Same as absent.
      if (child === undefined) continue;
      const childPath = `${path}.${key}`;
      const prop = declared[key];
      if (prop) {
        walk(child, prop, root, childPath, issues);
      } else if (node.additionalProperties === false) {
        const allowed = Object.keys(declared).filter((k) => !declared[k]?.deprecated);
        issues.push({
          kind: 'unknown_field',
          path: childPath,
          message: `${childPath}: unknown field "${key}" on ${node.title ?? 'object'} (allowed: ${allowed.join(', ')})`,
        });
      } else if (typeof node.additionalProperties === 'object') {
        walk(child, node.additionalProperties, root, childPath, issues);
      }
    }
  }
}

/** Every keyword `walk` understands — anything else in the schema would be silently ignored. */
export const SUPPORTED_SCHEMA_KEYWORDS: readonly string[] = [
  'type', 'title', 'description', 'enum', 'required', 'pattern', 'minLength', 'minItems',
  'items', 'properties', 'additionalProperties', 'deprecated', 'readOnly', '$ref', '$schema', '$defs',
];
