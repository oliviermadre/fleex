import { randomUUID } from 'node:crypto';
import {
  diffTemplates,
  isEmptyDiff,
  layoutSteps,
  validateWorkflow,
  type TemplateDiff,
  type Violation,
  type WorkflowCapabilities,
  type WorkflowDocument,
  type WorkflowRunStatus,
  type SubworkflowResolver,
  type SubworkflowSource,
} from '@fleex/shared';
import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';

/**
 * `fleex workflow apply`: create or REPLACE a whole template from one document.
 *
 * Atomic by construction: every rule runs before anything is written, and the
 * write is a single `save` of one row. There is no partial edit — the decision
 * taken on #403 stands.
 */

export interface ApplyDeps {
  templateStore: WorkflowTemplateStorePort;
  runStore?: WorkflowRunStorePort;
  personaStore?: PersonaStorePort;
  skillStore?: SkillStorePort;
  panelStore?: PanelStorePort;
}

export type ApplyAction = 'created' | 'replaced' | 'unchanged' | 'would_create' | 'would_replace';

export type ApplyResponse =
  | { ok: false; errors: Violation[]; warnings: Violation[]; skipped?: string }
  | {
    ok: true;
    action: ApplyAction;
    dryRun: boolean;
    slug: string;
    diff: TemplateDiff;
    warnings: Violation[];
    /** Runs in progress on the replaced template — they keep their snapshot. */
    activeRuns: number;
    /** Steps whose position was computed. */
    layout: { computed: string[] };
    template?: ReturnType<WorkflowTemplateEntity['toDTO']>;
  };

/** Statuses of a run that has not finished — it still reads its templateSnapshot. */
const ACTIVE_RUN_STATUSES: WorkflowRunStatus[] = ['running', 'blocked', 'needs_review'];

/**
 * Introspected on every call: agents, skills, panels and workflow templates
 * differ per workspace.
 */
export async function loadWorkflowCapabilities(deps: Partial<ApplyDeps>): Promise<WorkflowCapabilities> {
  const [personas, skills, panels, templates] = await Promise.all([
    deps.personaStore?.getAll() ?? [],
    deps.skillStore?.getAll() ?? [],
    deps.panelStore?.getAll() ?? [],
    deps.templateStore?.getAll() ?? [],
  ]);
  return {
    workflows: templates.map((t) => ({ name: t.slug, description: t.name, enabled: t.enabled })),
    agents: personas.map((p) => ({ name: p.name, description: p.displayName !== p.name ? p.displayName : undefined })),
    skills: skills.map((s) => ({ name: s.commandName, description: s.displayName || undefined })),
    panels: panels.map((p) => ({ name: p.name, description: p.description || p.displayName || undefined })),
  };
}

async function countActiveRuns(runStore: WorkflowRunStorePort | undefined, templateId: string): Promise<number> {
  if (!runStore) return 0;
  const lists = await Promise.all(ACTIVE_RUN_STATUSES.map((s) => runStore.getByStatus(s)));
  return lists.flat().filter((r) => r.templateId === templateId).length;
}

export async function applyWorkflowDocument(
  body: unknown,
  deps: ApplyDeps,
  opts: { dryRun: boolean },
): Promise<{ status: number; body: ApplyResponse }> {
  const slug = typeof body === 'object' && body !== null && typeof (body as { slug?: unknown }).slug === 'string'
    ? (body as { slug: string }).slug
    : undefined;
  const existing = slug ? await deps.templateStore.getBySlug(slug) : null;
  const caps = await loadWorkflowCapabilities(deps);
  // Sub-workflow rules (inclusion cycles, depth, size, disabled children, the
  // fields an edge may read after a workflow step) need the templates' content.
  const bySlug = new Map<string, SubworkflowSource>((await deps.templateStore.getAll()).map((t) => [t.slug, t]));
  const resolveWorkflow: SubworkflowResolver = (s) => bySlug.get(s);

  const { errors, warnings, skipped } = validateWorkflow(
    body,
    { caps, existingTemplateId: existing?.id ?? null, resolveWorkflow },
    'apply',
  );
  if (errors.length > 0) {
    return { status: 422, body: { ok: false, errors, warnings, ...(skipped ? { skipped } : {}) } };
  }

  const doc = body as WorkflowDocument;
  const { steps, computed } = layoutSteps(doc.steps, doc.edges, doc.entryStepId, existing?.steps);
  const next = {
    name: doc.name,
    emoji: doc.emoji ?? '',
    description: doc.description ?? '',
    // Absent on a replace = unchanged: leaving the field out never disables a workflow.
    enabled: doc.enabled ?? existing?.enabled ?? true,
    entryStepId: doc.entryStepId,
    steps,
    edges: doc.edges,
  };
  const diff = diffTemplates(existing, next);
  const activeRuns = existing ? await countActiveRuns(deps.runStore, existing.id) : 0;
  const common = { ok: true as const, slug: doc.slug, diff, warnings, activeRuns, layout: { computed } };

  if (opts.dryRun) {
    const action: ApplyAction = !existing ? 'would_create' : isEmptyDiff(diff) ? 'unchanged' : 'would_replace';
    return { status: 200, body: { ...common, action, dryRun: true } };
  }
  if (existing && isEmptyDiff(diff)) {
    return { status: 200, body: { ...common, action: 'unchanged', dryRun: false, template: existing.toDTO() } };
  }

  // The entity re-checks with the `save` profile, which `apply` is strictly
  // stronger than — so this cannot throw on a document that passed above.
  const template = existing ?? WorkflowTemplateEntity.create({ id: randomUUID(), slug: doc.slug, ...next });
  if (existing) existing.update(next);
  await deps.templateStore.save(template);
  return {
    status: existing ? 200 : 201,
    body: { ...common, action: existing ? 'replaced' : 'created', dryRun: false, template: template.toDTO() },
  };
}
