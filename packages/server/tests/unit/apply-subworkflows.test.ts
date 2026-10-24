import { describe, it, expect, beforeEach } from 'vitest';
import {
  EXAMPLE_REFS, buildApplyDocumentation, renderApplyDocumentationMarkdown, type WorkflowDocument,
} from '@fleex/shared';
import {
  applyWorkflowDocument, loadWorkflowCapabilities, type ApplyDeps,
} from '../../src/application/use-cases/apply-workflow-template.js';
import type { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../src/application/ports/workflow-template-store.port.js';

/**
 * `workflow apply` is how an LLM composes workflows. It has no editor greying
 * out bad choices: everything the editor and the template routes prevent must
 * come back as a precise, actionable violation — above all an inclusion cycle,
 * which would otherwise only be caught when a run fails to start.
 */

class MemoryTemplateStore implements WorkflowTemplateStorePort {
  rows = new Map<string, WorkflowTemplateEntity>();
  async getAll() { return [...this.rows.values()]; }
  async getById(id: string) { return this.rows.get(id) ?? null; }
  async getBySlug(slug: string) { return [...this.rows.values()].find((t) => t.slug === slug) ?? null; }
  async getEnabled() { return [...this.rows.values()].filter((t) => t.enabled); }
  async save(t: WorkflowTemplateEntity) { this.rows.set(t.id, t); }
  async remove(id: string) { this.rows.delete(id); }
}

const named = (name: string) => ({ name, displayName: name, commandName: name, description: '' });

let store: MemoryTemplateStore;
let deps: ApplyDeps;

beforeEach(() => {
  store = new MemoryTemplateStore();
  deps = {
    templateStore: store,
    personaStore: { getAll: async () => [named(EXAMPLE_REFS.agent)] } as never,
    skillStore: { getAll: async () => [] } as never,
    panelStore: { getAll: async () => [] } as never,
    runStore: { getByStatus: async () => [] } as never,
  };
});

const apply = (body: unknown, dryRun = false) => applyWorkflowDocument(body, deps, { dryRun });

/** A QA workflow whose review declares `verdict: ok | ko`. */
const qa = (over: Partial<WorkflowDocument> = {}): WorkflowDocument => ({
  slug: 'qa',
  name: 'QA',
  entryStepId: 'review',
  steps: [{
    id: 'review', name: 'Review', executorType: 'agent', executorRef: EXAMPLE_REFS.agent,
    outputSchema: { type: 'object', properties: { verdict: { type: 'string', enum: ['ok', 'ko'] } } },
  }],
  edges: [],
  ...over,
});

/** Build → QA (sub-workflow) → back to Build on ko. */
const delivery = (over: Partial<WorkflowDocument> = {}): WorkflowDocument => ({
  slug: 'delivery',
  name: 'Delivery',
  entryStepId: 'build',
  steps: [
    { id: 'build', name: 'Build', executorType: 'agent', executorRef: EXAMPLE_REFS.agent },
    { id: 'qa', name: 'QA', executorType: 'workflow', executorRef: 'qa' },
    { id: 'done', name: 'Done', executorType: 'route', executorRef: '' },
  ],
  edges: [
    { id: 'build-qa', source: 'build', target: 'qa', isDefault: true },
    {
      id: 'qa-ko', source: 'qa', target: 'build', isDefault: false,
      conditionGroup: { match: 'all', clauses: [{ field: 'verdict', operator: 'eq', value: 'ko' }] },
    },
    { id: 'qa-done', source: 'qa', target: 'done', isDefault: true },
  ],
  ...over,
});

const invariantsOf = (r: Awaited<ReturnType<typeof apply>>) =>
  r.body.ok ? r.body.warnings.map((w) => w.invariant) : r.body.errors.map((e) => e.invariant);

describe('workflow apply with sub-workflows', () => {
  it('accepts a workflow step, and an edge branching on a field the sub-workflow declares', async () => {
    await apply(qa());
    const r = await apply(delivery());
    expect(r.body).toMatchObject({ ok: true, action: 'created', warnings: [] });
  });

  it('refuses an inclusion cycle closed by the applied document, and writes nothing', async () => {
    await apply(qa());
    await apply(delivery());
    // qa now includes delivery, which includes qa.
    const looped = qa({
      steps: [...qa().steps, { id: 'again', name: 'Again', executorType: 'workflow', executorRef: 'delivery' }],
      edges: [{ id: 'review-again', source: 'review', target: 'again', isDefault: true }],
    });
    const r = await apply(looped);
    expect(r.status).toBe(422);
    expect(invariantsOf(r)).toEqual(['subworkflow.inclusion']);
    if (!r.body.ok) {
      expect(r.body.errors[0]).toMatchObject({ path: '$.steps[1].executorRef', stepId: 'again' });
      expect(r.body.errors[0]!.message).toContain('qa → delivery → qa');
    }
    expect((await store.getBySlug('qa'))!.steps).toHaveLength(1);
  });

  it('refuses a workflow including itself', async () => {
    const self = qa({
      steps: [...qa().steps, { id: 'me', name: 'Me', executorType: 'workflow', executorRef: 'qa' }],
      edges: [{ id: 'review-me', source: 'review', target: 'me', isDefault: true }],
    });
    const r = await apply(self, true);
    expect(invariantsOf(r)).toEqual(['subworkflow.inclusion']);
    if (!r.body.ok) expect(r.body.errors[0]!.message).toContain('cannot include itself');
  });

  it('refuses nesting deeper than the limit, naming the whole chain', async () => {
    // l4 is a leaf; l3 ⊃ l4; l2 ⊃ l3; l1 ⊃ l2 — then top ⊃ l1 is four levels deep.
    await apply(qa({ slug: 'l4' }));
    for (const [slug, child] of [['l3', 'l4'], ['l2', 'l3'], ['l1', 'l2']]) {
      const r = await apply({
        slug, name: slug, entryStepId: 'in', edges: [],
        steps: [{ id: 'in', name: 'In', executorType: 'workflow', executorRef: child }],
      });
      expect(r.body.ok).toBe(true);
    }
    const r = await apply({
      slug: 'top', name: 'Top', entryStepId: 'in', edges: [],
      steps: [{ id: 'in', name: 'In', executorType: 'workflow', executorRef: 'l1' }],
    }, true);
    expect(invariantsOf(r)).toEqual(['subworkflow.inclusion']);
    if (!r.body.ok) expect(r.body.errors[0]!.message).toContain('top → l1 → l2 → l3 → l4');
  });

  it('names the closest existing slug when the included workflow does not exist', async () => {
    await apply(qa());
    const r = await apply(delivery({
      steps: delivery().steps.map((s) => (s.id === 'qa' ? { ...s, executorRef: 'qaa' } : s)),
      edges: delivery().edges.filter((e) => e.id !== 'qa-ko'),
    }));
    expect(invariantsOf(r)).toEqual(['executor.ref_exists']);
    if (!r.body.ok) expect(r.body.errors[0]!.message).toMatch(/no workflow "qaa".*did you mean "qa"\?/);
  });

  it('refuses an outputSchema on a workflow step: it relays the sub-workflow\'s output instead', async () => {
    await apply(qa());
    const r = await apply(delivery({
      steps: delivery().steps.map((s) => (s.id === 'qa'
        ? { ...s, outputSchema: { type: 'object', properties: { verdict: { type: 'string' } } } }
        : s)),
    }), true);
    expect(invariantsOf(r)).toEqual(['executor.type_ref_coherent']);
  });

  it('refuses an edge after a workflow step on a field none of its steps declares', async () => {
    await apply(qa());
    const r = await apply(delivery({
      edges: delivery().edges.map((e) => (e.id === 'qa-ko'
        ? { ...e, conditionGroup: { match: 'all', clauses: [{ field: 'decision', operator: 'eq', value: 'ko' }] } }
        : e)),
    }), true);
    expect(invariantsOf(r)).toEqual(['edge.clause_field_declared']);
    if (!r.body.ok) expect(r.body.errors[0]!.message).toContain('(declared: verdict)');
  });

  it('refuses a value the sub-workflow never produces', async () => {
    await apply(qa());
    const r = await apply(delivery({
      edges: delivery().edges.map((e) => (e.id === 'qa-ko'
        ? { ...e, conditionGroup: { match: 'all', clauses: [{ field: 'verdict', operator: 'eq', value: 'rejected' }] } }
        : e)),
    }), true);
    expect(invariantsOf(r)).toEqual(['edge.clause_value_in_enum']);
  });

  it('refuses a branch on deliverable.status after a workflow step, which is never relayed', async () => {
    await apply(qa());
    const r = await apply(delivery({
      edges: delivery().edges.map((e) => (e.id === 'qa-ko'
        ? { ...e, conditionGroup: { match: 'all', clauses: [{ field: 'deliverable.status', operator: 'eq', value: 'draft' }] } }
        : e)),
    }), true);
    expect(invariantsOf(r)).toEqual(['subworkflow.exit_fields']);
  });

  it('warns, without refusing, when the included workflow is disabled', async () => {
    await apply(qa({ enabled: false }));
    const r = await apply(delivery(), true);
    expect(r.body.ok).toBe(true);
    expect(invariantsOf(r)).toEqual(['subworkflow.enabled']);
  });

  it('warns when disabling a workflow another enabled workflow includes', async () => {
    await apply(qa());
    await apply(delivery());
    const r = await apply(qa({ enabled: false }), true);
    expect(r.body.ok).toBe(true);
    expect(invariantsOf(r)).toEqual(['subworkflow.disable_in_use']);
    if (r.body.ok) expect(r.body.warnings[0]!.message).toContain('"delivery"');
  });

  it('refuses a step id containing "::"', async () => {
    const r = await apply(qa({
      entryStepId: 'qa::review',
      steps: qa().steps.map((s) => ({ ...s, id: 'qa::review' })),
    }), true);
    expect(invariantsOf(r)).toEqual(['step.id_no_separator']);
  });
});

describe('workflow apply --documentation', () => {
  it('lists the workspace\'s workflows as executorRefs, and explains what a workflow step does', async () => {
    await apply(qa({ enabled: false }));
    const md = renderApplyDocumentationMarkdown(buildApplyDocumentation({ caps: await loadWorkflowCapabilities(deps) }));
    expect(md).toContain('`workflow` → the slug of another workflow template');
    expect(md).toContain('- `qa` — QA (disabled');
    expect(md).toContain('### sub-workflows (workflow steps)');
    expect(md).toContain('LAST COMPLETED step');
    for (const id of ['subworkflow.inclusion', 'subworkflow.enabled', 'subworkflow.disable_in_use', 'subworkflow.exit_fields', 'step.id_no_separator']) {
      expect(md).toContain(`### ${id}`);
    }
  });
});
