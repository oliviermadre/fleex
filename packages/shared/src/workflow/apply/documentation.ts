import { NATIVE_OPERATIONS, NATIVE_STEP_KIND_TICKET_ACTIONS } from '../../native-operations/descriptors.js';
import { CREATED_REFERENCE_FIELDS, TICKET_REFERENCE_FIELDS } from '../../native-operations/references.js';
import { EDGE_OPERATORS, LIST_OPERATORS, MAX_REGEX_LENGTH, UNARY_OPERATORS } from '../edge-conditions.js';
import { EDGE_STANDARD_FIELDS } from '../edge-validation.js';
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '../../constants.js';
import { EXECUTOR_TYPES, WORKFLOW_DOCUMENT_SCHEMA, type SchemaNode } from './schema.js';
import { EXECUTOR_REF_EXPECTATIONS, INVARIANTS, runInvariantExample, validateWorkflow, type WorkflowInvariant } from './invariants.js';
import { minimalExample, richExample } from './examples.js';
import type { Violation, WorkflowCapabilities, WorkflowDocument } from './types.js';
import {
  MAX_EXPANDED_STEPS, MAX_STEP_VISITS_PER_RUN, MAX_SUBWORKFLOW_DEPTH, SUBWORKFLOW_ID_SEPARATOR, SUBWORKFLOW_NAME_SEPARATOR,
} from '../subworkflows.js';

/**
 * `fleex workflow apply --documentation` — generated, never written by hand.
 *
 * Every section is derived from a source the validator itself reads:
 *   Contract     ← WORKFLOW_DOCUMENT_SCHEMA (the object the shape check runs)
 *   Rules        ← INVARIANTS (rule text + the message check() produces on the example)
 *   Capabilities ← the workspace, introspected on this call + the runtime constants
 *   Examples     ← minimalExample / richExample, validated before being served
 */

export interface DocumentationInput {
  caps: WorkflowCapabilities;
  workspace?: string;
  generatedAt?: string;
}

interface RuleDoc {
  id: string;
  severity: 'error' | 'warning';
  rule: string;
  example: { mistake: string; excerpt: unknown; message: string };
}

interface ExampleDoc {
  name: 'minimal' | 'rich';
  document: WorkflowDocument | null;
  /** Why the example could not be served in this workspace, when it could not. */
  unavailable?: string;
}

export interface ApplyDocumentation {
  title: string;
  summary: string[];
  workflow: string[];
  contract: { schema: SchemaNode; tables: { name: string; rows: FieldRow[] }[] };
  rules: RuleDoc[];
  capabilities: ReturnType<typeof buildCapabilities>;
  examples: ExampleDoc[];
}

interface FieldRow {
  field: string;
  type: string;
  required: boolean;
  notes: string;
}

// ── Contract ────────────────────────────────────────────────────────────────

function typeLabel(node: SchemaNode): string {
  if (node.$ref) return node.$ref.replace('#/$defs/', '');
  const t = Array.isArray(node.type) ? node.type.join(' | ') : node.type ?? 'any';
  if (t === 'array' && node.items) return `${typeLabel(node.items)}[]`;
  if (t === 'string | array' && node.items) return `string | ${typeLabel(node.items)}[]`;
  if (t === 'object' && typeof node.additionalProperties === 'object') {
    return `{ [name]: ${typeLabel(node.additionalProperties)} }`;
  }
  return t;
}

function tableOf(node: SchemaNode): FieldRow[] {
  const required = new Set(node.required ?? []);
  return Object.entries(node.properties ?? {})
    .filter(([, prop]) => !prop.deprecated)
    .map(([field, prop]) => {
      const notes: string[] = [];
      if (prop.readOnly) notes.push('read-only');
      if (prop.enum) notes.push(`one of: ${prop.enum.join(' | ')}`);
      if (prop.pattern) notes.push(`pattern ${prop.pattern}`);
      if (prop.minLength) notes.push('non-empty');
      if (prop.minItems) notes.push(`at least ${prop.minItems}`);
      if (prop.description) notes.push(prop.description);
      return { field, type: typeLabel(prop), required: required.has(field), notes: notes.join(' · ') };
    });
}

function buildContract() {
  const schema = WORKFLOW_DOCUMENT_SCHEMA;
  const tables = [{ name: 'document', rows: tableOf(schema) }];
  for (const [name, def] of Object.entries(schema.$defs ?? {})) tables.push({ name, rows: tableOf(def) });
  return { schema, tables };
}

// ── Rules ───────────────────────────────────────────────────────────────────

function buildRules(invariants: readonly WorkflowInvariant[]): RuleDoc[] {
  return invariants
    .filter((inv) => inv.severity.apply !== 'off')
    .map((inv) => {
      const { excerpt, result } = runInvariantExample(inv, 'apply');
      const own: Violation | undefined = [...result.errors, ...result.warnings].find((v) => v.invariant === inv.id);
      return {
        id: inv.id,
        severity: inv.severity.apply as 'error' | 'warning',
        rule: inv.rule,
        example: {
          mistake: inv.example.describe,
          excerpt,
          message: own ? (own.message.startsWith(own.path) ? own.message : `${own.path}: ${own.message}`) : '(the example produced no message — report this as a Fleex bug)',
        },
      };
    });
}

// ── Capabilities ────────────────────────────────────────────────────────────

function buildCapabilities(caps: WorkflowCapabilities) {
  return {
    executorTypes: EXECUTOR_TYPES.map((type) => ({ type, executorRef: EXECUTOR_REF_EXPECTATIONS[type] ?? '' })),
    agents: caps.agents,
    skills: caps.skills,
    panels: caps.panels,
    workflows: caps.workflows ?? [],
    subworkflows: [
      'A step with "executorType": "workflow" and "executorRef": "<slug>" includes that whole workflow at this point of the graph. Leave prompt, mode, outputSchema, nativeActions and humanGateOutcomes out.',
      `When a run starts, the step is replaced by a copy of the included workflow's CURRENT version: its steps get ids "<stepId>${SUBWORKFLOW_ID_SEPARATOR}<childStepId>" and names "<child name>${SUBWORKFLOW_NAME_SEPARATOR}<step name>". One run, one ticket: the included steps see the run history of the steps before them. Do not write "${SUBWORKFLOW_ID_SEPARATOR}" in your own step ids.`,
      'Edges that enter the workflow step enter the included workflow\'s entry step. When the included workflow is over, the run continues on the workflow step\'s own outgoing edges.',
      'Those outgoing edges read the output of the included workflow\'s LAST COMPLETED step: any field declared in the outputSchema of one of its steps (e.g. {"field":"verdict","operator":"eq","value":"ko"} back to an earlier step), plus result and outcome.',
      'Inside the included workflow, a step whose edges all fail to match ends the included workflow and continues in the parent — except a human_gate: only its FIRST humanGateOutcome continues, any other unrouted outcome ends the whole run (a refusal stops everything). Put the outcome that means "go on" first.',
      `Limits: no inclusion cycle (a workflow never includes itself, even through others), at most ${MAX_SUBWORKFLOW_DEPTH} levels of nesting, at most ${MAX_EXPANDED_STEPS} steps once everything is expanded. A disabled included workflow makes every launch of this one fail.`,
      `Loop guard (every workflow, not only composed ones): a run entering the same step a ${MAX_STEP_VISITS_PER_RUN + 1}th time through an edge pauses for a human instead. Repeat work with an edge back to an earlier step, never by including a workflow in itself.`,
    ],
    nativeStepKind: NATIVE_STEP_KIND_TICKET_ACTIONS,
    nativeOperations: NATIVE_OPERATIONS.map((op) => ({
      operationId: op.id,
      description: op.description,
      worksWithoutTicket: op.requiresSubjectTicket === false,
      writes: op.conflictsOn ?? [],
      params: op.params.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required && !p.nullable,
        ...(p.enum ? { enum: [...p.enum] } : {}),
        ...(p.nullable ? { nullable: true } : {}),
        references: p.allowReference !== false,
        ...(p.description ? { description: p.description } : {}),
      })),
    })),
    edgeOperators: {
      all: [...EDGE_OPERATORS],
      unary: [...UNARY_OPERATORS],
      list: [...LIST_OPERATORS],
      maxRegexLength: MAX_REGEX_LENGTH,
    },
    standardFields: EDGE_STANDARD_FIELDS.map((f) => ({ field: f.field, type: f.type, ...(f.enum ? { enum: f.enum } : {}) })),
    ticket: { statuses: [...TICKET_STATUSES], priorities: [...TICKET_PRIORITIES], types: [...TICKET_TYPES] },
    references: {
      forms: [
        '{{ steps.<stepId>.<field> }} — a field of an upstream step\'s outputSchema',
        '{{ output.<field> }} — same, for the single direct predecessor (exactly one incoming edge)',
        `{{ ticket.<field> }} — fields: ${TICKET_REFERENCE_FIELDS.join(', ')}`,
        '{{ workflow }} — the workflow name',
        '{{ item }} / {{ item.<path> }} — the current element, in a step with forEach',
        `{{ created.<field> }} — the ticket this step's ticket.create made; fields: ${CREATED_REFERENCE_FIELDS.join(', ')}`,
      ],
    },
  };
}

// ── Examples ────────────────────────────────────────────────────────────────

function buildExamples(caps: WorkflowCapabilities): ExampleDoc[] {
  const agent = caps.agents[0]?.name;
  const skill = caps.skills[0]?.name;
  const make = (name: 'minimal' | 'rich'): ExampleDoc => {
    if (!agent) {
      return {
        name,
        document: null,
        unavailable: `this workspace has no agent, so the ${name} example cannot reference a real one. Install one first (fleex agent list).`,
      };
    }
    const refs = { agent, skill };
    const document = name === 'minimal' ? minimalExample(refs) : richExample(refs);
    const check = validateWorkflow(document, { caps }, 'apply');
    const problems = [...check.errors, ...check.warnings];
    if (problems.length > 0) {
      return {
        name,
        document: null,
        unavailable: `the ${name} example does not validate in this workspace (${problems.map((p) => p.invariant).join(', ')}) — report this as a Fleex bug.`,
      };
    }
    return { name, document };
  };
  return [make('minimal'), make('rich')];
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function buildApplyDocumentation(
  input: DocumentationInput,
  invariants: readonly WorkflowInvariant[] = INVARIANTS,
): ApplyDocumentation {
  return {
    title: 'fleex workflow apply — contract',
    summary: [
      'Creates a workflow template when no template has the document\'s slug, replaces it ENTIRELY otherwise. There is no partial edit.',
      'Atomic: the whole document is accepted, or nothing is written.',
      'Every violation is reported in one call, each with its path, the step or edge at fault, and what was expected.',
      'Round-trip: the output of `fleex workflow show <slug> --json` is a valid input (unless it still uses the legacy "condition" field).',
      'Runs already in progress are never affected: each run keeps the copy of the template it started with.',
      `Workspace: ${input.workspace ?? 'current'} · generated ${input.generatedAt ?? new Date().toISOString()}`,
    ],
    workflow: [
      'Read Capabilities: use only the agents, skills, panels, workflows and native operations listed there.',
      'Start from Examples › rich and adapt it. Ids are free-form strings you choose (e.g. "spec", "review-ok"); keep them unique.',
      'Every edge is either `"isDefault": true` (at most one per source step) or carries a conditionGroup.',
      'Run `fleex workflow apply --file wf.json --dry-run`, fix EVERY listed error, run it again, then apply without --dry-run.',
      'Positions are optional: leave them out and the visual builder gets a computed layout.',
    ],
    contract: buildContract(),
    rules: buildRules(invariants),
    capabilities: buildCapabilities(input.caps),
    examples: buildExamples(input.caps),
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const inline = (v: unknown) => JSON.stringify(v);

export function renderApplyDocumentationMarkdown(doc: ApplyDocumentation): string {
  const out: string[] = [];
  const caps = doc.capabilities;
  out.push(`# ${doc.title}`, '');
  out.push(...doc.summary.map((s) => `- ${s}`), '');
  out.push('## How to write a document', '');
  doc.workflow.forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push('');

  out.push('## 1. Contract', '');
  out.push('Any key not listed here is an error (schema.unknown_field). `$ref` names point to the tables below.', '');
  for (const table of doc.contract.tables) {
    out.push(`### ${table.name}`, '', '| field | type | required | notes |', '|---|---|---|---|');
    for (const row of table.rows) {
      out.push(`| ${row.field} | ${row.type.replace(/\|/g, '\\|')} | ${row.required ? 'yes' : ''} | ${row.notes.replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }
  out.push('<details><summary>Full JSON Schema</summary>', '', '```json', json(doc.contract.schema), '```', '', '</details>', '');

  out.push('## 2. Rules', '');
  out.push('Checked on every apply. "error" blocks the write, "warning" is reported and does not block.', '');
  for (const rule of doc.rules) {
    out.push(`### ${rule.id} (${rule.severity})`, '', rule.rule, '');
    out.push(`- Mistake: ${rule.example.mistake}`);
    out.push(`- Excerpt: \`${inline(rule.example.excerpt)}\``);
    out.push(`- Message: \`${rule.example.message}\``, '');
  }

  out.push('## 3. Capabilities of this workspace', '');
  out.push('### executorType → executorRef', '');
  for (const e of caps.executorTypes) out.push(`- \`${e.type}\` → ${e.executorRef}`);
  out.push('');
  const refs = (title: string, items: { name: string; description?: string }[], empty: string) => {
    out.push(`### ${title}`, '');
    if (items.length === 0) out.push(empty);
    for (const i of items) out.push(`- \`${i.name}\`${i.description ? ` — ${i.description}` : ''}`);
    out.push('');
  };
  refs('agents (executorRef of an agent step)', caps.agents, '_none installed in this workspace_');
  refs('skills (executorRef of a skill step)', caps.skills, '_none installed in this workspace_');
  refs('panels (executorRef of a panel step)', caps.panels, '_none in this workspace_');
  refs(
    'workflows (executorRef of a workflow step — a sub-workflow)',
    caps.workflows.map((w) => ({ name: w.name, description: `${w.description ?? ''}${w.enabled ? '' : ' (disabled: cannot be included in a workflow that must run)'}`.trim() || undefined })),
    '_no workflow template in this workspace_',
  );
  out.push('### sub-workflows (workflow steps)', '');
  for (const note of caps.subworkflows) out.push(`- ${note}`);
  out.push('');

  out.push(`### native operations (nativeActions[].operationId, in a step with executorRef "${caps.nativeStepKind}")`, '');
  for (const op of caps.nativeOperations) {
    out.push(`- \`${op.operationId}\` — ${op.description}${op.writes.length ? ` Writes: ${op.writes.join(', ')}.` : ''}`);
    for (const p of op.params) {
      const bits = [p.type, p.required ? 'required' : 'optional'];
      if ('enum' in p && p.enum) bits.push(`one of ${p.enum.join(' | ')}`);
      if ('nullable' in p && p.nullable) bits.push('null clears it');
      if (!p.references) bits.push('no {{ }} references');
      out.push(`  - \`${p.name}\`: ${bits.join(', ')}${'description' in p && p.description ? ` — ${p.description}` : ''}`);
    }
  }
  out.push('');

  out.push('### edge conditions', '');
  out.push(`- operators: ${caps.edgeOperators.all.join(', ')}`);
  out.push(`- no value: ${caps.edgeOperators.unary.join(', ')} · list value: ${caps.edgeOperators.list.join(', ')} · string value: all others (matches: regex ≤ ${caps.edgeOperators.maxRegexLength} chars)`);
  out.push('- standard fields (readable on the edge source step without declaring them in outputSchema):');
  for (const f of caps.standardFields) out.push(`  - \`${f.field}\` (${f.type}${'enum' in f && f.enum ? `: ${f.enum.join(' | ')}` : ''})`);
  out.push('  - `outcome` on an edge leaving a human_gate = the outcome the human picked (one of the gate\'s humanGateOutcomes).');
  out.push('- any other field must be declared in the outputSchema of the step the clause reads (the source, or `stepId`).', '');

  out.push('### ticket values', '');
  out.push(`- statuses: ${caps.ticket.statuses.join(', ')}`);
  out.push(`- priorities: ${caps.ticket.priorities.join(', ')}`);
  out.push(`- types: ${caps.ticket.types.join(', ')}`, '');
  out.push('### {{ … }} references (native action params)', '');
  for (const f of caps.references.forms) out.push(`- ${f}`);
  out.push('');

  out.push('## 4. Examples', '');
  for (const ex of doc.examples) {
    out.push(`### ${ex.name}`, '');
    if (!ex.document) out.push(`_Not available: ${ex.unavailable}_`, '');
    else out.push('Validated against this workspace before being shown: 0 errors, 0 warnings.', '', '```json', json(ex.document), '```', '');
  }
  return out.join('\n');
}
