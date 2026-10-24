import type { WorkflowEdge, WorkflowStep } from '../../types/workflow.js';
import { collectEdgeIssues, type EdgeIssue, type EdgeIssueCode } from '../edge-validation.js';
import { collectNativeIssues, type NativeIssue, type NativeIssueCode } from '../../native-operations/validate.js';
import { NATIVE_STEP_KIND_TICKET_ACTIONS } from '../../native-operations/descriptors.js';
import { isListOperator, normalizeEdgeCondition } from '../edge-conditions.js';
import { checkDocumentShape, type ShapeIssue } from './schema.js';
import {
  MAX_EXPANDED_STEPS, MAX_SUBWORKFLOW_DEPTH, SUBWORKFLOW_ID_SEPARATOR, SubworkflowExpansionError, expandSubworkflows, includedWorkflowSlugs, subworkflowOutputSchema,
  type SubworkflowResolver, type SubworkflowSource,
} from '../subworkflows.js';
import { EXAMPLE_REFS, richExample } from './examples.js';
import type {
  InvariantSeverity,
  ValidationEnv,
  ValidationProfile,
  Violation,
  WorkflowCapabilities,
  WorkflowDocument,
  WorkflowValidationResult,
} from './types.js';

/**
 * The workflow invariant registry — the ONLY place a template rule is declared.
 *
 * Each entry is read by three consumers:
 *   - `validateWorkflow` runs `check()` and files the result under the entry's
 *     severity for the profile (`save` = the web editor, `apply` = the CLI/MCP);
 *   - `fleex workflow apply --documentation` prints `rule`, the `example`
 *     excerpt and the message `check()` produces on that example — computed,
 *     never copied, so the doc cannot drift from the validator;
 *   - a test asserts each example violates its own invariant, and only it.
 *
 * Adding a rule = appending an entry here. Nothing else to touch.
 */

export interface InvariantExample {
  /** One-line description of the mistake, for the doc. */
  describe: string;
  /** Turns a valid document (the rich example) into one violating this invariant only. */
  build: (valid: WorkflowDocument) => unknown;
  /** The part of the violating document worth showing. */
  excerpt: (violating: any) => unknown;
  /** Extra validation context the example needs (e.g. an existing template). */
  env?: Partial<ValidationEnv>;
}

interface Finding {
  path: string;
  message: string;
  stepId?: string;
  edgeId?: string;
  actionId?: string;
}

export interface WorkflowInvariant {
  id: string;
  scope: 'document' | 'step' | 'edge' | 'action';
  severity: Record<ValidationProfile, InvariantSeverity>;
  /** Plain-language rule, published as-is in `--documentation`. */
  rule: string;
  /**
   * `shape` rules run on any input. `graph` rules assume the shape is valid and
   * only run when `schema.shape` found nothing.
   */
  stage: 'shape' | 'graph';
  check: (doc: any, ctx: CheckContext) => Finding[];
  example: InvariantExample;
}

/** Shared, memoised view of the document handed to every `check()`. */
export class CheckContext {
  private shape?: ShapeIssue[];
  private edges?: EdgeIssue[];
  private natives?: NativeIssue[];

  constructor(
    private readonly raw: unknown,
    readonly env: ValidationEnv,
  ) {}

  get doc(): WorkflowDocument {
    return this.raw as WorkflowDocument;
  }

  get steps(): WorkflowStep[] {
    // Positions may be missing in a document; no validator reads them.
    return this.doc.steps as WorkflowStep[];
  }

  shapeIssues(): ShapeIssue[] {
    return (this.shape ??= checkDocumentShape(this.raw));
  }

  /**
   * The workspace's templates with this document overlaid on its own slug — the
   * store as it will be once the document is applied, so a cycle closing
   * through it is seen. Null when the caller gave no templates.
   */
  get resolve(): SubworkflowResolver | null {
    const base = this.env.resolveWorkflow;
    if (!base) return null;
    const doc = this.doc;
    const self: SubworkflowSource = {
      slug: doc.slug, name: doc.name, emoji: doc.emoji ?? '', enabled: doc.enabled ?? true,
      steps: this.steps, edges: doc.edges, entryStepId: doc.entryStepId,
    };
    return (slug) => (slug === doc.slug ? self : base(slug));
  }

  edgeIssues(): EdgeIssue[] {
    // A `workflow` step relays the output of its sub-workflow's last completed
    // step: its outgoing edges may read any field the sub-workflow's steps
    // declare, so they are checked against that union.
    if (this.edges) return this.edges;
    const resolve = this.resolve;
    const steps = resolve
      ? this.steps.map((st) => {
        if (st.executorType !== 'workflow' || st.outputSchema) return st;
        const outputSchema = subworkflowOutputSchema(st.executorRef, resolve);
        return outputSchema ? { ...st, outputSchema } : st;
      })
      : this.steps;
    return (this.edges = collectEdgeIssues(steps, this.doc.edges, this.doc.entryStepId));
  }

  nativeIssues(): NativeIssue[] {
    return (this.natives ??= collectNativeIssues(this.steps, this.doc.edges, this.doc.entryStepId));
  }

  stepIndex(id: string): number {
    return this.doc.steps.findIndex((s) => s.id === id);
  }

  edgeIndex(id: string): number {
    return this.doc.edges.findIndex((e) => e.id === id);
  }

  stepIds(): string[] {
    return this.doc.steps.map((s) => s.id);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function edgeName(edge: WorkflowEdge): string {
  return `edge "${edge.id}" (${edge.source} → ${edge.target})`;
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

/** Levenshtein distance — enough to suggest "builder" for "buidler". */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

function closest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(input.toLowerCase(), c.toLowerCase());
    if (d < bestScore) { best = c; bestScore = d; }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(input.length / 3)) ? best : undefined;
}

function nativeFinding(ctx: CheckContext, issue: NativeIssue): Finding {
  const stepIdx = ctx.stepIndex(issue.stepId);
  const step = ctx.doc.steps[stepIdx];
  const actionIdx = issue.actionId ? (step?.nativeActions ?? []).findIndex((a) => a.id === issue.actionId) : -1;
  const path = actionIdx >= 0 ? `$.steps[${stepIdx}].nativeActions[${actionIdx}]` : `$.steps[${stepIdx}]`;
  return { path, message: issue.message, stepId: issue.stepId, actionId: issue.actionId };
}

function edgeFinding(ctx: CheckContext, issue: EdgeIssue): Finding {
  const idx = ctx.edgeIndex(issue.edgeId);
  const edge = ctx.doc.edges[idx];
  let path = `$.edges[${idx}]`;
  if (issue.clauseIndex !== undefined) {
    path += edge?.conditionGroup ? `.conditionGroup.clauses[${issue.clauseIndex}]` : '.condition';
  }
  return { path, message: issue.message, edgeId: issue.edgeId };
}

const fromNative = (code: NativeIssueCode) => (_doc: unknown, ctx: CheckContext): Finding[] =>
  ctx.nativeIssues().filter((i) => i.code === code).map((i) => nativeFinding(ctx, i));

const fromEdges = (code: EdgeIssueCode) => (_doc: unknown, ctx: CheckContext): Finding[] =>
  ctx.edgeIssues().filter((i) => i.code === code).map((i) => edgeFinding(ctx, i));

function stepOf(doc: WorkflowDocument, id: string) {
  return doc.steps.find((s) => s.id === id)!;
}

function edgeOf(doc: WorkflowDocument, id: string) {
  return doc.edges.find((e) => e.id === id)!;
}

/** Values an `outcome` clause compares against, when it compares against fixed values. */
function outcomeValues(edge: WorkflowEdge): { clauseIndex: number; values: string[] }[] {
  const out: { clauseIndex: number; values: string[] }[] = [];
  // Normalised so a legacy `condition` is read too: it is reported by
  // edge.legacy_condition, and must not ALSO look like a missing route.
  (normalizeEdgeCondition(edge)?.clauses ?? []).forEach((clause, clauseIndex) => {
    if (clause.field !== 'outcome') return;
    if (clause.stepId && clause.stepId !== edge.source) return;
    if (clause.operator !== 'eq' && clause.operator !== 'neq' && !isListOperator(clause.operator)) return;
    const values = Array.isArray(clause.value) ? clause.value : typeof clause.value === 'string' ? [clause.value] : [];
    out.push({ clauseIndex, values });
  });
  return out;
}


/** Slugs of the example workspace's workflows (see `EXAMPLE_CAPABILITIES`). */
export const EXAMPLE_WORKFLOW_SLUGS = { qa: 'qa', disabled: 'legacy-qa', consumer: 'release' } as const;

/** The rich example with a `ship` workflow step between "set-done" and "stop". */
function withWorkflowStep(d: WorkflowDocument, slug: string): WorkflowDocument {
  d.steps.push({ id: 'ship', name: 'Ship', executorType: 'workflow', executorRef: slug });
  edgeOf(d, 'done-stop').target = 'ship';
  d.edges.push({ id: 'ship-stop', source: 'ship', target: 'stop', isDefault: true });
  return d;
}

const EXPECTED_REF: Record<string, string> = {
  agent: 'an agent name (see Capabilities › agents)',
  skill: 'a skill command name (see Capabilities › skills)',
  panel: 'a panel name (see Capabilities › panels)',
  human_gate: '""',
  route: '""',
  native: `"${NATIVE_STEP_KIND_TICKET_ACTIONS}"`,
  workflow: 'the slug of another workflow template, included as a sub-workflow (see Capabilities › workflows)',
};

/** For each executor type, what `executorRef` must hold — published in Capabilities. */
export const EXECUTOR_REF_EXPECTATIONS: Readonly<Record<string, string>> = EXPECTED_REF;

function capsFor(caps: WorkflowCapabilities, type: string): string[] | null {
  if (type === 'agent') return caps.agents.map((a) => a.name);
  if (type === 'skill') return caps.skills.map((s) => s.name);
  if (type === 'panel') return caps.panels.map((p) => p.name);
  if (type === 'workflow') return caps.workflows ? caps.workflows.map((w) => w.name) : null;
  return null;
}

// ── The registry ────────────────────────────────────────────────────────────

const ERROR_BOTH: Record<ValidationProfile, InvariantSeverity> = { save: 'error', apply: 'error' };
const WARN_BOTH: Record<ValidationProfile, InvariantSeverity> = { save: 'warning', apply: 'warning' };
const APPLY_ONLY: Record<ValidationProfile, InvariantSeverity> = { save: 'off', apply: 'error' };
const STRICT_ON_APPLY: Record<ValidationProfile, InvariantSeverity> = { save: 'warning', apply: 'error' };

export const INVARIANTS: readonly WorkflowInvariant[] = [
  // ── Shape ────────────────────────────────────────────────────────────────
  {
    id: 'schema.shape',
    scope: 'document',
    severity: ERROR_BOTH,
    stage: 'shape',
    rule: 'The document follows the JSON Schema of the Contract section: types, required fields, enums, slug pattern.',
    check: (_doc, ctx) => ctx.shapeIssues().filter((i) => i.kind === 'shape').map((i) => ({ path: i.path, message: i.message })),
    example: {
      describe: 'executorType outside its enum',
      build: (d) => { stepOf(d, 'spec').executorType = 'bot' as never; return d; },
      excerpt: (d) => stepOf(d, 'spec'),
    },
  },
  {
    id: 'schema.unknown_field',
    scope: 'document',
    severity: STRICT_ON_APPLY,
    stage: 'shape',
    rule: 'No key outside the contract, at any depth. Nothing is silently ignored.',
    check: (_doc, ctx) => ctx.shapeIssues().filter((i) => i.kind === 'unknown_field').map((i) => ({ path: i.path, message: i.message })),
    example: {
      describe: 'a "timeout" key on a step',
      build: (d) => { (stepOf(d, 'spec') as unknown as Record<string, unknown>).timeout = 300; return d; },
      excerpt: (d) => stepOf(d, 'spec'),
    },
  },

  // ── Document ─────────────────────────────────────────────────────────────
  {
    id: 'document.has_steps',
    scope: 'document',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'A workflow has at least one step.',
    check: (doc: WorkflowDocument) =>
      doc.steps.length === 0 ? [{ path: '$.steps', message: 'Workflow must have at least one step' }] : [],
    example: {
      describe: 'an empty steps list',
      build: (d) => ({ ...d, steps: [], edges: [] }),
      excerpt: (d) => ({ entryStepId: d.entryStepId, steps: d.steps }),
    },
  },
  {
    id: 'document.id_ignored',
    scope: 'document',
    severity: { save: 'off', apply: 'warning' },
    stage: 'graph',
    rule: 'id / createdAt / updatedAt are read-only: the template is matched by slug, and an id that is not the one of the template holding that slug is ignored.',
    check: (doc: WorkflowDocument, ctx) => {
      const existing = ctx.env.existingTemplateId;
      if (doc.id === undefined || doc.id === existing) return [];
      return [{
        path: '$.id',
        message: existing
          ? `"${doc.id}" is not the id of template "${doc.slug}" in this workspace (${existing}); ignored, the template is matched by slug`
          : `"${doc.id}" is ignored — no template has slug "${doc.slug}" here, so a new one is created with a fresh id`,
      }];
    },
    example: {
      describe: 'an export from another workspace (different id, same slug)',
      build: (d) => ({ ...d, id: '9f1c0000-0000-4000-8000-000000000000' }),
      excerpt: (d) => ({ id: d.id, slug: d.slug }),
      env: { existingTemplateId: '4ab20000-0000-4000-8000-000000000000' },
    },
  },
  {
    id: 'entry.exists',
    scope: 'document',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'entryStepId names an existing step.',
    check: (doc: WorkflowDocument, ctx) => {
      if (doc.steps.length === 0 || ctx.stepIds().includes(doc.entryStepId)) return [];
      return [{
        path: '$.entryStepId',
        message: `entryStepId "${doc.entryStepId}" not found in steps[] (expected one of: ${list(ctx.stepIds())})`,
      }];
    },
    example: {
      describe: 'entryStepId pointing at no step',
      build: (d) => ({ ...d, entryStepId: 'start' }),
      excerpt: (d) => ({ entryStepId: d.entryStepId }),
    },
  },
  {
    id: 'step.id_unique',
    scope: 'step',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'Step ids are unique.',
    check: (doc: WorkflowDocument) => duplicates(doc.steps.map((s) => s.id)).map(({ index, first }) => ({
      path: `$.steps[${index}].id`,
      stepId: doc.steps[index]!.id,
      message: `step id "${doc.steps[index]!.id}" is already used by $.steps[${first}] (expected: a unique step id)`,
    })),
    example: {
      describe: 'two steps with id "stop"',
      build: (d) => { d.steps.push({ id: 'stop', name: 'Stop again', executorType: 'route', executorRef: '' }); return d; },
      excerpt: (d) => d.steps.filter((s: { id: string }) => s.id === 'stop'),
    },
  },
  {
    id: 'edge.id_unique',
    scope: 'edge',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'Edge ids are unique.',
    check: (doc: WorkflowDocument) => duplicates(doc.edges.map((e) => e.id)).map(({ index, first }) => ({
      path: `$.edges[${index}].id`,
      edgeId: doc.edges[index]!.id,
      message: `edge id "${doc.edges[index]!.id}" is already used by $.edges[${first}] (expected: a unique edge id)`,
    })),
    example: {
      describe: 'two edges with id "spec-review"',
      build: (d) => { edgeOf(d, 'done-stop').id = 'spec-review'; return d; },
      excerpt: (d) => d.edges.filter((e: { id: string }) => e.id === 'spec-review'),
    },
  },
  {
    id: 'action.id_unique',
    scope: 'action',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'Native action ids are unique within their step.',
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, s) =>
      duplicates((step.nativeActions ?? []).map((a) => a.id)).map(({ index, first }) => ({
        path: `$.steps[${s}].nativeActions[${index}].id`,
        stepId: step.id,
        actionId: step.nativeActions![index]!.id,
        message: `step "${step.id}": action id "${step.nativeActions![index]!.id}" is already used by nativeActions[${first}] (expected: a unique action id within the step)`,
      }))),
    example: {
      describe: 'two actions with id "status" in one step',
      build: (d) => { stepOf(d, 'set-done').nativeActions![1]!.id = 'status'; return d; },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions,
    },
  },
  {
    id: 'step.id_no_separator',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: `A step id does not contain "${SUBWORKFLOW_ID_SEPARATOR}": it is reserved for the steps a sub-workflow is expanded into when a run starts ("build${SUBWORKFLOW_ID_SEPARATOR}implement").`,
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, i) => (step.id.includes(SUBWORKFLOW_ID_SEPARATOR) ? [{
      path: `$.steps[${i}].id`,
      stepId: step.id,
      message: `step id "${step.id}" contains "${SUBWORKFLOW_ID_SEPARATOR}" (expected: an id without it, e.g. "${step.id.split(SUBWORKFLOW_ID_SEPARATOR).join('-')}" — update the edges and conditions that use it)`,
    }] : [])),
    example: {
      describe: 'a step id written like an expanded sub-workflow step',
      build: (d) => {
        const id = `end${SUBWORKFLOW_ID_SEPARATOR}stop`;
        stepOf(d, 'stop').id = id;
        for (const e of d.edges) if (e.target === 'stop') e.target = id;
        return d;
      },
      excerpt: (d) => ({ id: d.steps[d.steps.length - 1].id }),
    },
  },
  {
    id: 'step.position_present',
    scope: 'step',
    severity: { save: 'error', apply: 'off' },
    stage: 'graph',
    rule: 'The web editor saves a position for every step. (apply computes missing positions instead.)',
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, i) => (step.position
      ? []
      : [{ path: `$.steps[${i}].position`, stepId: step.id, message: `$.steps[${i}].position is required` }])),
    example: {
      describe: 'a step saved from the editor without position',
      build: (d) => { d.steps.forEach((s, i) => { if (s.id !== 'spec') s.position = { x: i * 260, y: 0 }; }); return d; },
      excerpt: (d) => stepOf(d, 'spec'),
    },
  },
  {
    id: 'step.reachable',
    scope: 'step',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'Every step is reachable from entryStepId by following edges (cycles are allowed).',
    check: (doc: WorkflowDocument, ctx) => {
      if (!ctx.stepIds().includes(doc.entryStepId)) return [];
      const reached = new Set([doc.entryStepId]);
      const queue = [doc.entryStepId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of doc.edges) {
          if (edge.source === current && !reached.has(edge.target)) {
            reached.add(edge.target);
            queue.push(edge.target);
          }
        }
      }
      return doc.steps.flatMap((step, i) => (reached.has(step.id) ? [] : [{
        path: `$.steps[${i}]`,
        stepId: step.id,
        message: `step "${step.id}" cannot be reached from entry step "${doc.entryStepId}" (expected: an edge with target "${step.id}" on a path from "${doc.entryStepId}")`,
      }]));
    },
    example: {
      describe: 'a step no edge leads to',
      build: (d) => { d.steps.push({ id: 'notify', name: 'Notify', executorType: 'route', executorRef: '' }); return d; },
      excerpt: (d) => stepOf(d, 'notify'),
    },
  },

  // ── Executors ────────────────────────────────────────────────────────────
  {
    id: 'executor.type_ref_coherent',
    scope: 'step',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'executorRef matches executorType: agent/skill/panel → a non-empty name, workflow → a non-empty workflow slug, native → "ticket.actions", human_gate and route → "". nativeActions and forEach only on native steps, humanGateOutcomes only on human_gate steps, no outputSchema on a workflow step (it relays its sub-workflow\'s output).',
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, i): Finding[] => {
      const out: Finding[] = [];
      const at = (field: string, message: string) =>
        out.push({ path: `$.steps[${i}].${field}`, stepId: step.id, message });
      const type = step.executorType;
      if ((type === 'agent' || type === 'skill' || type === 'panel' || type === 'workflow') && step.executorRef.trim() === '') {
        at('executorRef', `${type} step "${step.id}" has an empty executorRef (expected: ${EXPECTED_REF[type]})`);
      }
      if (type === 'workflow' && step.outputSchema !== undefined) {
        at('outputSchema', `workflow step "${step.id}" has an outputSchema (expected: none — the step relays the output of the last completed step of sub-workflow "${step.executorRef}", and its outgoing edges may read any field that sub-workflow's steps declare; declare fields there)`);
      }
      if ((type === 'human_gate' || type === 'route') && step.executorRef !== '') {
        at('executorRef', `${type} step "${step.id}" has executorRef "${step.executorRef}" (expected: "")`);
      }
      // A non-empty unknown kind is already reported by native.kind.
      if (type === 'native' && step.executorRef === '') {
        at('executorRef', `native step "${step.id}" has an empty executorRef (expected: "${NATIVE_STEP_KIND_TICKET_ACTIONS}", the operations go in nativeActions[].operationId)`);
      }
      if (type !== 'native' && step.nativeActions !== undefined) {
        at('nativeActions', `${type} step "${step.id}" has nativeActions (expected: only on native steps)`);
      }
      if (type !== 'native' && step.forEach !== undefined) {
        at('forEach', `${type} step "${step.id}" has forEach (expected: only on native steps)`);
      }
      if (type !== 'human_gate' && step.humanGateOutcomes !== undefined) {
        at('humanGateOutcomes', `${type} step "${step.id}" has humanGateOutcomes (expected: only on human_gate steps)`);
      }
      return out;
    }),
    example: {
      describe: 'a route step with an executorRef',
      build: (d) => { stepOf(d, 'stop').executorRef = 'builder'; return d; },
      excerpt: (d) => stepOf(d, 'stop'),
    },
  },
  {
    id: 'executor.ref_exists',
    scope: 'step',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'An agent step names an installed agent, a skill step an installed skill, a panel step an existing panel, a workflow step an existing workflow template slug (see Capabilities).',
    check: (doc: WorkflowDocument, ctx) => {
      const caps = ctx.env.caps;
      if (!caps) return [];
      return doc.steps.flatMap((step, i) => {
        const listed = capsFor(caps, step.executorType);
        // The document's own slug exists once applied: including it is a cycle,
        // which subworkflow.inclusion reports — not a missing workflow.
        const names = listed && step.executorType === 'workflow' && !listed.includes(doc.slug) ? [...listed, doc.slug] : listed;
        if (!names || step.executorRef.trim() === '' || names.includes(step.executorRef)) return [];
        const near = closest(step.executorRef, names);
        const kind = step.executorType;
        return [{
          path: `$.steps[${i}].executorRef`,
          stepId: step.id,
          message: `step "${step.id}": no ${kind} "${step.executorRef}" in this workspace`
            + (near ? ` — did you mean "${near}"?` : '')
            + ` (available: ${list(names)})`,
        }];
      });
    },
    example: {
      describe: 'a misspelled agent name',
      build: (d) => { stepOf(d, 'spec').executorRef = 'catalist'; return d; },
      excerpt: (d) => ({ id: 'spec', executorType: 'agent', executorRef: stepOf(d, 'spec').executorRef }),
    },
  },

  // ── Sub-workflows ────────────────────────────────────────────────────────
  {
    id: 'subworkflow.inclusion',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: `Sub-workflow inclusions expand into a finite run: a workflow never includes itself, directly or through other workflows (no inclusion cycle), nests at most ${MAX_SUBWORKFLOW_DEPTH} levels deep, reaches at most ${MAX_EXPANDED_STEPS} steps once every sub-workflow is expanded, and every workflow it includes (at any depth) exists. Checked against the templates as they are now, with this document in place.`,
    check: (doc: WorkflowDocument, ctx) => {
      const resolve = ctx.resolve;
      if (!resolve || !includedWorkflowSlugs(ctx.steps).length) return [];
      try {
        expandSubworkflows(
          { name: doc.name, emoji: doc.emoji ?? '', steps: ctx.steps, edges: doc.edges, entryStepId: doc.entryStepId },
          doc.slug, resolve, { requireEnabled: false },
        );
        return [];
      } catch (err) {
        if (!(err instanceof SubworkflowExpansionError)) throw err;
        // A missing direct child is executor.ref_exists' business.
        if (err.code === 'not_found' && err.chain.length === 2) return [];
        const top = doc.steps.findIndex((st) => st.executorType === 'workflow' && st.executorRef === err.chain[1]);
        if (top < 0) return [{ path: '$.steps', message: `${err.message} (expected: fewer steps or fewer sub-workflows)` }];
        // Said from the document's own step: the author fixes THAT step.
        const step = doc.steps[top]!;
        const via = err.chain.slice(1).map((c) => `"${c}"`).join(' → ');
        const message = err.code === 'cycle'
          ? (err.chain.length === 2
            ? `step "${step.id}": a workflow cannot include itself ("${doc.slug}") (expected: another workflow's slug — to repeat work, use an edge back to an earlier step)`
            : `step "${step.id}" includes ${err.chain.slice(1, -1).map((c) => `"${c}"`).join(" → ")}, which leads back to "${doc.slug}": inclusion cycle ${err.chain.join(' → ')} (expected: remove or change this step — to repeat work, use an edge back to an earlier step)`)
          : err.code === 'depth'
            ? `step "${step.id}": sub-workflows nested more than ${MAX_SUBWORKFLOW_DEPTH} levels deep (${err.chain.join(' → ')}) (expected: flatten one level — include the deepest workflow's steps directly, or include it higher up)`
            : err.code === 'not_found'
              ? `step "${step.id}": ${via} — "${err.chain[err.chain.length - 1]}" does not exist (expected: fix or apply that workflow first)`
              : `${err.message} (expected: fewer steps or fewer sub-workflows)`;
        return [{ path: `$.steps[${top}].executorRef`, stepId: step.id, message }];
      }
    },
    example: {
      describe: '"spec-review" includes "release", which already includes "spec-review"',
      build: (d) => withWorkflowStep(d, EXAMPLE_WORKFLOW_SLUGS.consumer),
      excerpt: (d) => stepOf(d, 'ship'),
    },
  },
  {
    id: 'subworkflow.enabled',
    scope: 'step',
    severity: WARN_BOTH,
    stage: 'graph',
    rule: 'A workflow step names an enabled workflow: while the included workflow is disabled, every run of this one is refused at launch (warning).',
    check: (doc: WorkflowDocument, ctx) => {
      const resolve = ctx.resolve;
      if (!resolve) return [];
      return doc.steps.flatMap((step, i) => {
        if (step.executorType !== 'workflow' || step.executorRef === doc.slug) return [];
        const child = resolve(step.executorRef);
        return child && !child.enabled ? [{
          path: `$.steps[${i}].executorRef`,
          stepId: step.id,
          message: `step "${step.id}": workflow "${step.executorRef}" is disabled — runs of "${doc.slug}" will be refused until it is enabled again`,
        }] : [];
      });
    },
    example: {
      describe: 'including a disabled workflow',
      build: (d) => withWorkflowStep(d, EXAMPLE_WORKFLOW_SLUGS.disabled),
      excerpt: (d) => stepOf(d, 'ship'),
    },
  },
  {
    id: 'subworkflow.disable_in_use',
    scope: 'document',
    severity: { save: 'off', apply: 'warning' },
    stage: 'graph',
    rule: 'Setting "enabled": false on a workflow other enabled workflows include as a sub-workflow stops them from starting (warning).',
    check: (doc: WorkflowDocument, ctx) => {
      const resolve = ctx.resolve;
      const all = ctx.env.caps?.workflows;
      if (doc.enabled !== false || !resolve || !all) return [];
      const consumers = all
        .filter((w) => w.name !== doc.slug && w.enabled)
        .filter((w) => includedWorkflowSlugs(resolve(w.name)?.steps ?? []).includes(doc.slug))
        .map((w) => w.name);
      return consumers.length > 0 ? [{
        path: '$.enabled',
        message: `"${doc.slug}" is included by ${consumers.map((c) => `"${c}"`).join(', ')}, which will no longer start while it is disabled`,
      }] : [];
    },
    example: {
      describe: 'disabling a workflow that "release" includes',
      build: (d) => ({ ...d, enabled: false }),
      excerpt: (d) => ({ slug: d.slug, enabled: d.enabled }),
    },
  },

  {
    id: 'subworkflow.exit_fields',
    scope: 'edge',
    severity: STRICT_ON_APPLY,
    stage: 'graph',
    rule: 'An edge leaving a workflow step only reads what the sub-workflow hands over — the fields its steps declare, result and outcome. deliverable.*, comment and mentionStatus are not relayed (the included step already posted them), so a clause on them would never match.',
    check: (doc: WorkflowDocument) => doc.edges.flatMap((edge, i) => {
      const source = doc.steps.find((st) => st.id === edge.source);
      if (source?.executorType !== 'workflow') return [];
      return (normalizeEdgeCondition(edge)?.clauses ?? []).flatMap((clause, c) => {
        if (clause.stepId && clause.stepId !== edge.source) return [];
        const f = clause.field;
        if (!(f === 'comment' || f === 'mentionStatus' || f === 'deliverable' || f.startsWith('deliverable.'))) return [];
        return [{
          path: edge.conditionGroup ? `$.edges[${i}].conditionGroup.clauses[${c}].field` : `$.edges[${i}].condition.field`,
          edgeId: edge.id,
          message: `${edgeName(edge)}: "${f}" is not relayed by workflow step "${source.id}" (expected: result, outcome, or a field declared by a step of "${source.executorRef}" — to branch on a deliverable, route inside "${source.executorRef}" instead)`,
        }];
      });
    }),
    example: {
      describe: 'branching on deliverable.status after a sub-workflow',
      build: (d) => {
        withWorkflowStep(d, EXAMPLE_WORKFLOW_SLUGS.qa);
        d.edges.push({ id: 'ship-again', source: 'ship', target: 'spec', isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'deliverable.status', operator: 'eq', value: 'draft' }] } });
        return d;
      },
      excerpt: (d) => edgeOf(d, 'ship-again'),
    },
  },

  // ── Edges ────────────────────────────────────────────────────────────────
  {
    id: 'edge.endpoints_exist',
    scope: 'edge',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'An edge\'s source and target name existing steps.',
    check: (doc: WorkflowDocument, ctx) => {
      const ids = ctx.stepIds();
      return doc.edges.flatMap((edge, i) => (['source', 'target'] as const)
        .filter((end) => !ids.includes(edge[end]))
        .map((end) => ({
          path: `$.edges[${i}].${end}`,
          edgeId: edge.id,
          message: `edge ${edge.id} ${end} "${edge[end]}" not found in steps[] (expected one of: ${list(ids)})`,
        })));
    },
    example: {
      describe: 'an edge pointing at a step that does not exist',
      build: (d) => { edgeOf(d, 'done-stop').target = 'deploy'; return d; },
      excerpt: (d) => edgeOf(d, 'done-stop'),
    },
  },
  {
    id: 'edge.legacy_condition',
    scope: 'edge',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'The legacy "condition" field is refused: use "conditionGroup". The error gives the exact replacement.',
    check: (doc: WorkflowDocument) => doc.edges.flatMap((edge, i) => {
      if (!edge.condition) return [];
      const group = { match: 'all', clauses: [edge.condition] };
      return [{
        path: `$.edges[${i}].condition`,
        edgeId: edge.id,
        message: `${edgeName(edge)}: legacy "condition", refused by apply. Replace it with: "conditionGroup": ${JSON.stringify(group)}`,
      }];
    }),
    example: {
      describe: 'an edge written with the legacy "condition" field',
      build: (d) => {
        const e = edgeOf(d, 'review-again');
        e.condition = { field: 'decision', operator: 'eq', value: 'changes_requested' };
        delete e.conditionGroup;
        return d;
      },
      excerpt: (d) => edgeOf(d, 'review-again'),
    },
  },
  {
    id: 'edge.single_default',
    scope: 'edge',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'At most one isDefault edge per source step. The default edge is only taken when no conditional edge of that source matches.',
    check: fromEdges('edge.single_default'),
    example: {
      describe: 'two default edges leaving "review"',
      build: (d) => { const e = edgeOf(d, 'review-again'); e.isDefault = true; delete e.conditionGroup; return d; },
      excerpt: (d) => d.edges.filter((e: WorkflowEdge) => e.source === 'review'),
    },
  },
  {
    id: 'edge.needs_condition',
    scope: 'edge',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'An edge with isDefault: false carries a conditionGroup.',
    check: fromEdges('edge.needs_condition'),
    example: {
      describe: 'a non-default edge without condition',
      build: (d) => { delete edgeOf(d, 'review-again').conditionGroup; return d; },
      excerpt: (d) => edgeOf(d, 'review-again'),
    },
  },
  {
    id: 'edge.clause_operand',
    scope: 'edge',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'A clause names a field, and its value fits the operator: none for is_empty / is_not_empty / is_true / is_false, a non-empty list for in / not_in, a non-empty string otherwise (a valid regex of at most 200 characters for matches).',
    check: fromEdges('edge.clause_operand'),
    example: {
      describe: '"in" with a single string instead of a list',
      build: (d) => { edgeOf(d, 'review-again').conditionGroup!.clauses[0] = { field: 'decision', operator: 'in', value: 'changes_requested' }; return d; },
      excerpt: (d) => edgeOf(d, 'review-again').conditionGroup,
    },
  },
  {
    id: 'edge.clause_step_ancestor',
    scope: 'edge',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'A clause\'s stepId names a step that runs before the edge (an ancestor of its source).',
    check: fromEdges('edge.clause_step_ancestor'),
    example: {
      describe: 'a clause reading a step that only runs after the edge',
      build: (d) => { edgeOf(d, 'spec-review').isDefault = false; edgeOf(d, 'spec-review').conditionGroup = { match: 'all', clauses: [{ stepId: 'set-done', field: 'result', operator: 'eq', value: 'ok' }] }; d.edges.push({ id: 'spec-fallback', source: 'spec', target: 'review', isDefault: true }); return d; },
      excerpt: (d) => edgeOf(d, 'spec-review'),
    },
  },
  {
    id: 'edge.clause_step_may_be_skipped',
    scope: 'edge',
    severity: WARN_BOTH,
    stage: 'graph',
    rule: 'A clause reading a step on a branch that may not run is false whenever that step was skipped (warning).',
    check: fromEdges('edge.clause_step_may_be_skipped'),
    example: {
      describe: '"stop" reads "review", but a failed spec reaches "stop" without running "review"',
      build: (d) => {
        d.edges.push({ id: 'spec-stop', source: 'spec', target: 'stop', isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'result', operator: 'eq', value: 'ko' }] } });
        d.steps.push({ id: 'audit', name: 'Audit', executorType: 'route', executorRef: '' });
        d.edges.push({ id: 'stop-audit', source: 'stop', target: 'audit', isDefault: false, conditionGroup: { match: 'all', clauses: [{ stepId: 'review', field: 'decision', operator: 'eq', value: 'ok' }] } });
        return d;
      },
      excerpt: (d) => edgeOf(d, 'stop-audit'),
    },
  },
  {
    id: 'edge.clause_field_declared',
    scope: 'edge',
    severity: STRICT_ON_APPLY,
    stage: 'graph',
    rule: 'A clause field is a standard field (see Capabilities) or is declared in the outputSchema of the step it reads. A dotted path inside a declared object field is accepted.',
    check: fromEdges('edge.clause_field_declared'),
    example: {
      describe: 'a field the review step does not declare',
      build: (d) => { edgeOf(d, 'review-again').conditionGroup!.clauses[0]!.field = 'verdict'; return d; },
      excerpt: (d) => edgeOf(d, 'review-again').conditionGroup,
    },
  },
  {
    id: 'edge.clause_value_in_enum',
    scope: 'edge',
    severity: STRICT_ON_APPLY,
    stage: 'graph',
    rule: 'eq / neq / in / not_in against a field declared with an enum only compare values of that enum.',
    check: fromEdges('edge.clause_value_in_enum'),
    example: {
      describe: 'a value the review step never produces',
      build: (d) => { edgeOf(d, 'review-again').conditionGroup!.clauses[0]!.value = 'rejected'; return d; },
      excerpt: (d) => edgeOf(d, 'review-again').conditionGroup,
    },
  },
  {
    id: 'edge.overlapping_conditions',
    scope: 'edge',
    severity: WARN_BOTH,
    stage: 'graph',
    rule: 'Two conditional edges of the same source that can match together make the run stop and ask a human which branch to follow (warning).',
    check: fromEdges('edge.overlapping_conditions'),
    example: {
      describe: 'two edges leaving "review" on the same condition',
      build: (d) => { d.edges.push({ ...clone(edgeOf(d, 'review-again')), id: 'review-again-2', target: 'approve' }); return d; },
      excerpt: (d) => d.edges.filter((e: WorkflowEdge) => e.id.startsWith('review-again')),
    },
  },

  // ── Human gates ──────────────────────────────────────────────────────────
  {
    id: 'gate.min_outcomes',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'A human_gate step declares at least two humanGateOutcomes.',
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, i) => (
      step.executorType === 'human_gate' && (step.humanGateOutcomes ?? []).length < 2
        ? [{ path: `$.steps[${i}].humanGateOutcomes`, stepId: step.id, message: `step ${step.id}: human_gate must have at least two outcomes (got ${JSON.stringify(step.humanGateOutcomes ?? [])})` }]
        : [])),
    example: {
      describe: 'a gate with a single outcome',
      build: (d) => { stepOf(d, 'approve').humanGateOutcomes = ['approve']; d.edges = d.edges.filter((e) => e.id !== 'approve-stop'); return d; },
      excerpt: (d) => stepOf(d, 'approve'),
    },
  },
  {
    id: 'gate.outcome_value_known',
    scope: 'edge',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'A clause on the field "outcome" of an edge leaving a human_gate only compares outcomes the gate declares.',
    check: (doc: WorkflowDocument) => doc.edges.flatMap((edge, i) => {
      const gate = doc.steps.find((s) => s.id === edge.source);
      if (gate?.executorType !== 'human_gate') return [];
      const declared = gate.humanGateOutcomes ?? [];
      return outcomeValues(edge).flatMap(({ clauseIndex, values }) => values
        .filter((v) => !declared.includes(v))
        .map((v) => ({
          path: edge.conditionGroup ? `$.edges[${i}].conditionGroup.clauses[${clauseIndex}].value` : `$.edges[${i}].condition.value`,
          edgeId: edge.id,
          message: `${edgeName(edge)}: gate "${gate.id}" has no outcome "${v}" (expected one of: ${list(declared)})`,
        })));
    }),
    example: {
      describe: 'an edge routing on "approved" when the gate declares "approve"',
      build: (d) => { edgeOf(d, 'approve-done').conditionGroup!.clauses[0]!.value = 'approved'; d.edges.push({ id: 'approve-fallback', source: 'approve', target: 'stop', isDefault: true }); return d; },
      excerpt: (d) => edgeOf(d, 'approve-done'),
    },
  },
  {
    id: 'gate.outcomes_covered',
    scope: 'step',
    severity: APPLY_ONLY,
    stage: 'graph',
    rule: 'Every outcome of a human_gate is routed by an edge with a clause outcome eq / in that outcome, or the gate has a default edge.',
    check: (doc: WorkflowDocument) => doc.steps.flatMap((step, i) => {
      if (step.executorType !== 'human_gate') return [];
      const outgoing = doc.edges.filter((e) => e.source === step.id);
      if (outgoing.some((e) => e.isDefault)) return [];
      const routed = new Set<string>();
      for (const edge of outgoing) {
        for (const clause of normalizeEdgeCondition(edge)?.clauses ?? []) {
          if (clause.field !== 'outcome' || (clause.stepId && clause.stepId !== step.id)) continue;
          if (clause.operator === 'eq' && typeof clause.value === 'string') routed.add(clause.value);
          if (clause.operator === 'in' && Array.isArray(clause.value)) clause.value.forEach((v) => routed.add(v));
        }
      }
      return (step.humanGateOutcomes ?? []).filter((o) => !routed.has(o)).map((o) => ({
        path: `$.steps[${i}].humanGateOutcomes`,
        stepId: step.id,
        message: `outcome "${o}" of gate "${step.id}" leads nowhere (expected: an edge from "${step.id}" with a clause {"field":"outcome","operator":"eq","value":"${o}"}, or a default edge)`,
      }));
    }),
    example: {
      describe: 'a gate whose "reject" outcome has no edge',
      build: (d) => { d.edges = d.edges.filter((e) => e.id !== 'approve-stop'); return d; },
      excerpt: (d) => ({ humanGateOutcomes: stepOf(d, 'approve').humanGateOutcomes, edges: d.edges.filter((e: WorkflowEdge) => e.source === 'approve') }),
    },
  },

  // ── Native steps ─────────────────────────────────────────────────────────
  {
    id: 'native.kind',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: `A native step's executorRef is "${NATIVE_STEP_KIND_TICKET_ACTIONS}".`,
    check: fromNative('native.kind'),
    example: {
      describe: 'the operation id put in executorRef',
      build: (d) => { stepOf(d, 'set-done').executorRef = 'ticket.set_status'; return d; },
      excerpt: (d) => ({ id: 'set-done', executorType: 'native', executorRef: stepOf(d, 'set-done').executorRef }),
    },
  },
  {
    id: 'native.has_actions',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'A native step has at least one nativeActions entry.',
    check: fromNative('native.has_actions'),
    example: {
      describe: 'a native step with no action',
      build: (d) => { stepOf(d, 'set-done').nativeActions = []; return d; },
      excerpt: (d) => stepOf(d, 'set-done'),
    },
  },
  {
    id: 'native.create_placement',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'At most one ticket.create per step, and it is the first action (the actions after it apply to the created ticket).',
    check: fromNative('native.create_placement'),
    example: {
      describe: 'ticket.create after another action',
      build: (d) => { stepOf(d, 'set-done').nativeActions!.push({ id: 'child', operationId: 'ticket.create', params: { title: 'Follow-up' } }); return d; },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions,
    },
  },
  {
    id: 'native.for_each',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'forEach is a single {{ steps.<stepId>.<field> }} reference to an array field declared by a step that runs before.',
    check: fromNative('native.for_each'),
    example: {
      describe: 'forEach over a field that is not an array',
      build: (d) => { stepOf(d, 'set-done').forEach = '{{ steps.review.decision }}'; return d; },
      excerpt: (d) => ({ id: 'set-done', forEach: stepOf(d, 'set-done').forEach }),
    },
  },
  {
    id: 'native.operation_known',
    scope: 'action',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'Every nativeActions[].operationId is a known operation (see Capabilities › native operations).',
    check: fromNative('native.operation_known'),
    example: {
      describe: 'an operation that does not exist',
      build: (d) => { stepOf(d, 'set-done').nativeActions![0]!.operationId = 'ticket.close'; return d; },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions![0],
    },
  },
  {
    id: 'native.conflicts',
    scope: 'step',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'Two actions of the same step never write the same ticket field (so their order is irrelevant).',
    check: fromNative('native.conflicts'),
    example: {
      describe: 'two status changes in one step',
      build: (d) => { stepOf(d, 'set-done').nativeActions!.push({ id: 'status-2', operationId: 'ticket.set_status', params: { status: 'reviewing' } }); return d; },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions,
    },
  },
  {
    id: 'native.params',
    scope: 'action',
    severity: ERROR_BOTH,
    stage: 'graph',
    rule: 'Action params satisfy their operation: required ones present, literals of the right type and inside their enum, {{ … }} references only where allowed and pointing at fields of steps that run before.',
    check: fromNative('native.params'),
    example: {
      describe: 'a status outside the ticket statuses',
      build: (d) => { stepOf(d, 'set-done').nativeActions![0]!.params = { status: 'closed' }; return d; },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions![0],
    },
  },
  {
    id: 'native.reference_unverified',
    scope: 'action',
    severity: WARN_BOTH,
    stage: 'graph',
    rule: 'A {{ … }} reference whose value cannot be fully checked ahead of time — its step may be skipped, or its values are not limited to the param\'s enum (warning).',
    check: fromNative('native.reference_unverified'),
    example: {
      describe: 'a status taken from a free-text field',
      build: (d) => {
        stepOf(d, 'review').outputSchema!.properties.next = { type: 'string' };
        stepOf(d, 'set-done').nativeActions![0]!.params = { status: '{{ steps.review.next }}' };
        return d;
      },
      excerpt: (d) => stepOf(d, 'set-done').nativeActions![0],
    },
  },
];

function duplicates(ids: string[]): { index: number; first: number }[] {
  const firstSeen = new Map<string, number>();
  const out: { index: number; first: number }[] = [];
  ids.forEach((id, index) => {
    const first = firstSeen.get(id);
    if (first === undefined) firstSeen.set(id, index);
    else out.push({ index, first });
  });
  return out;
}

/** Natural order on paths: `$.steps[2]` before `$.steps[10]`. */
function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * Run every invariant of the registry and return ALL violations at once,
 * sorted by path, split by the severity the profile gives them.
 *
 * Graph rules assume a well-formed document; when `schema.shape` reports
 * anything they are skipped, and `skipped` says so explicitly.
 */
export function validateWorkflow(
  doc: unknown,
  env: ValidationEnv,
  profile: ValidationProfile,
  invariants: readonly WorkflowInvariant[] = INVARIANTS,
): WorkflowValidationResult {
  const ctx = new CheckContext(doc, env);
  const errors: Violation[] = [];
  const warnings: Violation[] = [];
  let skipped: string | undefined;

  const run = (inv: WorkflowInvariant) => {
    const severity = inv.severity[profile];
    if (severity === 'off') return;
    for (const finding of inv.check(doc, ctx)) {
      (severity === 'error' ? errors : warnings).push({ invariant: inv.id, severity, ...finding });
    }
  };

  for (const inv of invariants) if (inv.stage === 'shape') run(inv);
  if (errors.some((e) => e.invariant === 'schema.shape')) {
    skipped = 'graph rules (edges, gates, executors, native steps) were not evaluated because the document shape is invalid — fix the schema.shape errors, then validate again';
  } else {
    for (const inv of invariants) if (inv.stage === 'graph') run(inv);
  }

  const byPath = (a: Violation, b: Violation) => comparePaths(a.path, b.path) || a.invariant.localeCompare(b.invariant);
  errors.sort(byPath);
  warnings.sort(byPath);
  return skipped ? { errors, warnings, skipped } : { errors, warnings };
}

/** Fake capabilities matching `EXAMPLE_REFS`, for the examples and their tests. */
export const EXAMPLE_CAPABILITIES: WorkflowCapabilities = {
  agents: [{ name: EXAMPLE_REFS.agent }],
  skills: [{ name: EXAMPLE_REFS.skill }],
  panels: [],
  workflows: [
    { name: EXAMPLE_WORKFLOW_SLUGS.qa, description: 'QA', enabled: true },
    { name: EXAMPLE_WORKFLOW_SLUGS.disabled, description: 'Legacy QA', enabled: false },
    { name: EXAMPLE_WORKFLOW_SLUGS.consumer, description: 'Release', enabled: true },
  ],
};

/**
 * The example workspace's templates: "qa" (a review declaring `verdict`), a
 * disabled copy of it, and "release", which includes the rich example's slug.
 */
const EXAMPLE_TEMPLATES: Record<string, SubworkflowSource> = (() => {
  const review = (slug: string, name: string, enabled: boolean): SubworkflowSource => ({
    slug, name, emoji: '🧪', enabled, entryStepId: 'check', edges: [],
    steps: [{
      id: 'check', name: 'Check', executorType: 'agent', executorRef: EXAMPLE_REFS.agent, position: { x: 0, y: 0 },
      outputSchema: { type: 'object', properties: { verdict: { type: 'string', enum: ['ok', 'ko'] } } },
    }],
  });
  return {
    [EXAMPLE_WORKFLOW_SLUGS.qa]: review(EXAMPLE_WORKFLOW_SLUGS.qa, 'QA', true),
    [EXAMPLE_WORKFLOW_SLUGS.disabled]: review(EXAMPLE_WORKFLOW_SLUGS.disabled, 'Legacy QA', false),
    [EXAMPLE_WORKFLOW_SLUGS.consumer]: {
      slug: EXAMPLE_WORKFLOW_SLUGS.consumer, name: 'Release', emoji: '🚆', enabled: true, entryStepId: 'run', edges: [],
      steps: [{ id: 'run', name: 'Run', executorType: 'workflow', executorRef: 'spec-review', position: { x: 0, y: 0 } }],
    },
  };
})();

export const resolveExampleWorkflow: SubworkflowResolver = (slug) => EXAMPLE_TEMPLATES[slug];

/** Build an invariant's violating example and the violations it produces. */
export function runInvariantExample(inv: WorkflowInvariant, profile: ValidationProfile = 'apply') {
  const violating = inv.example.build(clone(richExample(EXAMPLE_REFS))) as WorkflowDocument;
  const env: ValidationEnv = { caps: EXAMPLE_CAPABILITIES, resolveWorkflow: resolveExampleWorkflow, ...inv.example.env };
  const result = validateWorkflow(violating, env, profile);
  return { violating, excerpt: inv.example.excerpt(violating), result };
}
