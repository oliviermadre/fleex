import type {
  WorkflowStep, WorkflowEdge, WorkflowTemplateSnapshot, SubworkflowInfo, NativeAction, JsonSchema, JsonSchemaProperty,
} from '../types/workflow.js';
import { REFERENCE_PATTERN } from '../native-operations/references.js';

/**
 * Sub-workflows: a step of `executorType: 'workflow'` stands for a whole other
 * template (`executorRef` = its slug).
 *
 * Nothing in the engine knows about them. When a run is created, every such
 * step is *expanded* in the snapshot: the child's steps are copied in under a
 * prefixed id, the parent's incoming edges are redirected to the child's entry,
 * and the original step stays in place as the child's exit. The run is then a
 * plain DAG — HITL pauses, gates, retries and cancel work unchanged, and the
 * child's steps see what the parent's earlier steps produced.
 *
 * The same walk is what refuses inclusion cycles, so a cycle can never reach a
 * run: it is checked when a template is saved and again when a run starts (the
 * included templates may have changed in between).
 */

/** Separates the including step's id from the child step's id: `build::implement`. */
export const SUBWORKFLOW_ID_SEPARATOR = '::';
/** Separates the child's name from the child step's name: `Build › Implement`. */
export const SUBWORKFLOW_NAME_SEPARATOR = ' › ';

/**
 * How many workflows deep an inclusion may go. Aligned on `MAX_WORKFLOW_RUN_DEPTH`
 * (`workflow.trigger` hops): one level of delegation, plus one more, plus one.
 */
export const MAX_SUBWORKFLOW_DEPTH = 3;

/** Upper bound on a run's step count once every sub-workflow is expanded. */
export const MAX_EXPANDED_STEPS = 100;

/**
 * Runtime loop guard: how many times a run may enter the same step by following
 * an edge before it parks for a human. Applies to every run, sub-workflows or
 * not — composition only makes the existing `ko → retry` loops more expensive.
 */
export const MAX_STEP_VISITS_PER_RUN = 5;

/** What the expansion needs to know about an included template. */
export interface SubworkflowSource {
  slug: string;
  name: string;
  emoji: string;
  enabled: boolean;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
}

export type SubworkflowResolver = (slug: string) => SubworkflowSource | undefined;

/** Why an expansion failed — lets `workflow apply` file it under the right invariant. */
export type SubworkflowExpansionCode = 'not_found' | 'disabled' | 'cycle' | 'depth' | 'size';

export class SubworkflowExpansionError extends Error {
  constructor(
    message: string,
    readonly code: SubworkflowExpansionCode,
    /** Slugs from the root to the failing inclusion (`[root, child, …]`); empty for `size`. */
    readonly chain: string[] = [],
  ) {
    super(message);
    this.name = 'SubworkflowExpansionError';
  }
}

export interface ExpandOptions {
  /**
   * Refuse a disabled child. True when a run starts ("disabled" must mean
   * "runs nowhere"); false when a template is saved, where the editor only
   * warns — re-enabling the child is enough to make the parent launchable.
   */
  requireEnabled: boolean;
}

/** Templates included by these steps, deduplicated, in order of appearance. */
export function includedWorkflowSlugs(steps: WorkflowStep[]): string[] {
  return [...new Set(
    steps.filter((s) => s.executorType === 'workflow' && s.executorRef).map((s) => s.executorRef),
  )];
}

export function hasSubworkflows(steps: WorkflowStep[]): boolean {
  return steps.some((s) => s.executorType === 'workflow');
}

/**
 * Expands every `workflow` step of `snapshot`, recursively.
 *
 * `rootSlug` is the slug of the template being expanded (null for a synthetic
 * run, which has none): it seeds the inclusion stack so a template including
 * itself is caught on the first hop.
 *
 * Throws `SubworkflowExpansionError` on an unknown / disabled child, an
 * inclusion cycle (G1/G2), a nesting deeper than `MAX_SUBWORKFLOW_DEPTH` (G3)
 * or more than `MAX_EXPANDED_STEPS` steps once expanded (G4).
 */
export function expandSubworkflows(
  snapshot: WorkflowTemplateSnapshot,
  rootSlug: string | null,
  resolve: SubworkflowResolver,
  options: ExpandOptions,
): WorkflowTemplateSnapshot {
  if (!hasSubworkflows(snapshot.steps)) return snapshot;
  const expanded = expandGraph(
    { steps: snapshot.steps, edges: snapshot.edges, entryStepId: snapshot.entryStepId },
    rootSlug ? [rootSlug] : [],
    0,
    resolve,
    options,
  );
  if (expanded.steps.length > MAX_EXPANDED_STEPS) {
    throw new SubworkflowExpansionError(
      `${expanded.steps.length} steps once sub-workflows are expanded (max ${MAX_EXPANDED_STEPS})`,
      'size',
    );
  }
  return {
    ...snapshot,
    steps: expanded.steps,
    edges: expanded.edges,
    entryStepId: expanded.entryStepId,
    subworkflows: expanded.subworkflows,
  };
}

/**
 * Save-time check (G1–G4) for a template about to be stored. Returns the
 * problems as messages rather than throwing, so the caller decides how to
 * surface them. `resolve` must already reflect the candidate (its new steps,
 * under its new slug), otherwise a cycle closing through it goes unseen.
 */
export function validateSubworkflows(
  candidate: { slug: string; steps: WorkflowStep[]; edges: WorkflowEdge[]; entryStepId: string },
  resolve: SubworkflowResolver,
): string[] {
  const errors: string[] = [];
  for (const step of candidate.steps) {
    if (step.executorType !== 'workflow') continue;
    if (!step.executorRef) {
      errors.push(`step "${step.name || step.id}": choose the workflow to include`);
    } else if (step.executorRef === candidate.slug) {
      errors.push(`step "${step.name || step.id}": a workflow cannot include itself`);
    }
  }
  if (errors.length > 0) return errors;
  try {
    expandSubworkflows(
      { name: candidate.slug, emoji: '', ...candidate },
      candidate.slug,
      resolve,
      { requireEnabled: false },
    );
  } catch (err) {
    if (!(err instanceof SubworkflowExpansionError)) throw err;
    errors.push(err.message);
  }
  return errors;
}

/**
 * Whether `stepId` was copied in from the sub-workflow whose exit step is
 * `exitStepId` (at any depth). Shared so the server and the UI agree on what
 * belongs to a sub-workflow.
 */
export function isInsideSubworkflow(stepId: string, exitStepId: string): boolean {
  return stepId.startsWith(`${exitStepId}${SUBWORKFLOW_ID_SEPARATOR}`);
}

/**
 * The output fields an edge leaving a `workflow` step can read: at run time the
 * exit relays the `schemaFields` of the sub-workflow's last completed step, so
 * any field declared by one of its steps (nested sub-workflows included) may
 * show up. Same-named fields are merged; their enums too, unless one side
 * declares none (then any value is possible). Unknown children contribute
 * nothing — `executor.ref_exists` reports them.
 */
export function subworkflowOutputSchema(slug: string, resolve: SubworkflowResolver): JsonSchema | undefined {
  const properties: Record<string, JsonSchemaProperty> = {};
  const seen = new Set<string>();
  const visit = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    for (const step of resolve(s)?.steps ?? []) {
      if (step.executorType === 'workflow') { visit(step.executorRef); continue; }
      for (const [field, prop] of Object.entries(step.outputSchema?.properties ?? {})) {
        const prev = properties[field];
        if (!prev) { properties[field] = { ...prop }; continue; }
        if (prev.enum && prop.enum) prev.enum = [...new Set([...prev.enum, ...prop.enum])];
        else delete prev.enum;
      }
    }
  };
  visit(slug);
  return Object.keys(properties).length > 0 ? { type: 'object', properties } : undefined;
}

// ── Internals ──────────────────────────────────────────────────────────────

interface Graph {
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
}

interface ExpandedGraph extends Graph {
  subworkflows: SubworkflowInfo[];
}

function expandGraph(
  graph: Graph,
  stack: string[],
  depth: number,
  resolve: SubworkflowResolver,
  options: ExpandOptions,
): ExpandedGraph {
  const steps: WorkflowStep[] = [];
  let edges: WorkflowEdge[] = graph.edges.map((e) => ({ ...e }));
  let entryStepId = graph.entryStepId;
  const subworkflows: SubworkflowInfo[] = [];

  for (const step of graph.steps) {
    steps.push(step);
    if (step.executorType !== 'workflow') continue;

    const slug = step.executorRef;
    const where = `step "${step.name || step.id}"`;
    if (stack.includes(slug)) {
      const path = [...stack.slice(stack.indexOf(slug)), slug];
      throw new SubworkflowExpansionError(
        path.length === 2
          ? `${where}: workflow "${slug}" cannot include itself`
          : `${where}: inclusion cycle ${path.join(' → ')}`,
        'cycle',
        [...stack, slug],
      );
    }
    if (depth + 1 > MAX_SUBWORKFLOW_DEPTH) {
      throw new SubworkflowExpansionError(
        `${where}: sub-workflows nested more than ${MAX_SUBWORKFLOW_DEPTH} levels deep (${[...stack, slug].join(' → ')})`,
        'depth',
        [...stack, slug],
      );
    }
    const child = resolve(slug);
    if (!child) throw new SubworkflowExpansionError(`${where}: sub-workflow "${slug}" not found`, 'not_found', [...stack, slug]);
    if (options.requireEnabled && !child.enabled) {
      throw new SubworkflowExpansionError(`${where}: sub-workflow "${slug}" is disabled`, 'disabled', [...stack, slug]);
    }

    const inner = expandGraph(
      { steps: child.steps, edges: child.edges, entryStepId: child.entryStepId },
      [...stack, slug],
      depth + 1,
      resolve,
      options,
    );

    const prefix = `${step.id}${SUBWORKFLOW_ID_SEPARATOR}`;
    const innerIds = new Set(inner.steps.map((s) => s.id));
    const p = (id: string): string => (innerIds.has(id) ? prefix + id : id);

    // E1 + E7: copy the child's steps under a prefixed id and name, laid out
    // relative to the step they replace.
    for (const c of inner.steps) {
      steps.push({
        ...c,
        id: prefix + c.id,
        name: `${child.name}${SUBWORKFLOW_NAME_SEPARATOR}${c.name}`,
        position: { x: (step.position?.x ?? 0) + (c.position?.x ?? 0), y: (step.position?.y ?? 0) + (c.position?.y ?? 0) },
        ...(c.nativeActions ? { nativeActions: c.nativeActions.map((a) => rewriteAction(a, innerIds, prefix)) } : {}),
        ...(c.forEach !== undefined ? { forEach: rewriteReferences(c.forEach, innerIds, prefix) } : {}),
        origin: { subworkflowStepId: c.origin ? p(c.origin.subworkflowStepId) : step.id },
      });
    }

    // E2: the child's own edges, prefixed — clause `stepId`s included.
    for (const e of inner.edges) {
      edges.push({
        ...e,
        id: prefix + e.id,
        source: p(e.source),
        target: p(e.target),
        ...(e.conditionGroup ? {
          conditionGroup: {
            ...e.conditionGroup,
            clauses: e.conditionGroup.clauses.map((cl) => (cl.stepId ? { ...cl, stepId: p(cl.stepId) } : cl)),
          },
        } : {}),
      });
    }

    // E5: inside the child, "no edge matched" ended the run. Expanded, it means
    // "the sub-workflow is over": rejoin the exit step.
    for (const c of inner.steps) {
      const exit = exitEdge(c, inner.edges, prefix, step.id);
      if (exit) edges.push(exit);
    }

    // E3: whatever entered the workflow step now enters the child's entry. The
    // edges added above for this very child (they target `step.id` as its exit)
    // must be left alone.
    const childEntry = prefix + inner.entryStepId;
    edges = edges.map((e) => (
      e.target === step.id && !isInsideSubworkflow(e.source, step.id) ? { ...e, target: childEntry } : e
    ));
    if (entryStepId === step.id) entryStepId = childEntry;

    // E8
    subworkflows.push({ stepId: step.id, templateSlug: slug, name: child.name, emoji: child.emoji });
    for (const sw of inner.subworkflows) {
      subworkflows.push({
        ...sw,
        stepId: prefix + sw.stepId,
        parentStepId: sw.parentStepId ? prefix + sw.parentStepId : step.id,
      });
    }
  }

  return { steps, edges, entryStepId, subworkflows };
}

/**
 * E5 edge for one child step, or null when it needs none.
 *
 * A human gate is the exception: its outcomes are a human's decision, and a
 * "reject" that ended the run in the child alone must not hand over to the
 * parent's next step (that would spend tokens on what a human just refused).
 * Only the gate's *first* outcome — `approve` in the editor's default order —
 * rejoins the exit, and only if no edge of the gate already takes it. Every
 * other unhandled outcome still ends the run.
 */
function exitEdge(c: WorkflowStep, childEdges: WorkflowEdge[], prefix: string, exitId: string): WorkflowEdge | null {
  const outgoing = childEdges.filter((e) => e.source === c.id);
  if (outgoing.some((e) => e.isDefault)) return null;
  const id = `${prefix}${c.id}${SUBWORKFLOW_ID_SEPARATOR}exit`;
  if (c.executorType !== 'human_gate') {
    return { id, source: prefix + c.id, target: exitId, isDefault: true };
  }
  const proceed = c.humanGateOutcomes?.[0];
  if (!proceed || outgoing.some((e) => takesOutcome(e, c.id, proceed))) return null;
  return {
    id, source: prefix + c.id, target: exitId, isDefault: false,
    conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value: proceed }] },
  };
}

/** Whether an edge already routes `outcome == value` (simple, explicit clauses only). */
function takesOutcome(e: WorkflowEdge, sourceId: string, value: string): boolean {
  const clauses = e.conditionGroup?.clauses ?? (e.condition ? [e.condition] : []);
  return clauses.some((cl) => (
    cl.field === 'outcome'
    && (!('stepId' in cl) || !cl.stepId || cl.stepId === sourceId)
    && ((cl.operator === 'eq' && cl.value === value) || (cl.operator === 'in' && Array.isArray(cl.value) && cl.value.includes(value)))
  ));
}

function rewriteAction(action: NativeAction, ids: Set<string>, prefix: string): NativeAction {
  return { ...action, params: rewriteDeep(action.params, ids, prefix) as Record<string, unknown> };
}

function rewriteDeep(value: unknown, ids: Set<string>, prefix: string): unknown {
  if (typeof value === 'string') return rewriteReferences(value, ids, prefix);
  if (Array.isArray(value)) return value.map((v) => rewriteDeep(v, ids, prefix));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteDeep(v, ids, prefix)]));
  }
  return value;
}

/** `{{ steps.<id>.x }}` → `{{ steps.<prefix><id>.x }}` for the child's own steps only. */
function rewriteReferences(text: string, ids: Set<string>, prefix: string): string {
  return text.replace(new RegExp(REFERENCE_PATTERN.source, 'g'), (raw, inner: string) => {
    const parts = inner.trim().split('.');
    if (parts[0] !== 'steps' || !parts[1] || !ids.has(parts[1])) return raw;
    return raw.replace(`steps.${parts[1]}.`, `steps.${prefix}${parts[1]}.`);
  });
}
