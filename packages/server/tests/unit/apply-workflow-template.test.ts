import { describe, it, expect, beforeEach } from 'vitest';
import { EXAMPLE_REFS, richExample, type WorkflowDocument } from '@fleex/shared';
import { applyWorkflowDocument, type ApplyDeps } from '../../src/application/use-cases/apply-workflow-template.js';
import type { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../src/application/ports/workflow-template-store.port.js';

/**
 * `workflow apply` is how an agent puts a workflow it designed into Fleex.
 * What matters: the same document applied twice changes nothing, a refused
 * document changes nothing, and a replace keeps the template's identity so the
 * runs, routines and @workflow: handles pointing at it keep working.
 */

class MemoryTemplateStore implements WorkflowTemplateStorePort {
  rows = new Map<string, WorkflowTemplateEntity>();
  saves = 0;
  async getAll() { return [...this.rows.values()]; }
  async getById(id: string) { return this.rows.get(id) ?? null; }
  async getBySlug(slug: string) { return [...this.rows.values()].find((t) => t.slug === slug) ?? null; }
  async getEnabled() { return [...this.rows.values()].filter((t) => t.enabled); }
  async save(t: WorkflowTemplateEntity) { this.saves++; this.rows.set(t.id, t); }
  async remove(id: string) { this.rows.delete(id); }
}

const named = (name: string) => ({ name, displayName: name, commandName: name, description: '' });

let store: MemoryTemplateStore;
let deps: ApplyDeps;
let activeRuns: { templateId: string }[];

beforeEach(() => {
  store = new MemoryTemplateStore();
  activeRuns = [];
  deps = {
    templateStore: store,
    personaStore: { getAll: async () => [named(EXAMPLE_REFS.agent)] } as never,
    skillStore: { getAll: async () => [named(EXAMPLE_REFS.skill)] } as never,
    panelStore: { getAll: async () => [] } as never,
    runStore: { getByStatus: async (s: string) => (s === 'running' ? activeRuns : []) } as never,
  };
});

const doc = (): WorkflowDocument => richExample(EXAMPLE_REFS);
const apply = (body: unknown, dryRun = false) => applyWorkflowDocument(body, deps, { dryRun });

describe('applyWorkflowDocument', () => {
  it('creates a template on an unknown slug, with computed positions', async () => {
    const r = await apply(doc());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, action: 'created' });
    const saved = await store.getBySlug('spec-review');
    expect(saved?.steps.every((s) => typeof s.position?.x === 'number')).toBe(true);
    if (r.body.ok) expect(r.body.layout.computed).toHaveLength(5);
  });

  it('re-applying its own export changes nothing and writes nothing', async () => {
    await apply(doc());
    const exported = JSON.parse(JSON.stringify((await store.getBySlug('spec-review'))!.toDTO()));
    const savesBefore = store.saves;
    const r = await apply(exported);
    expect(r.body).toMatchObject({ ok: true, action: 'unchanged', warnings: [] });
    expect(store.saves).toBe(savesBefore);
  });

  it('replaces in full on an existing slug, keeping id and createdAt', async () => {
    await apply(doc());
    const before = (await store.getBySlug('spec-review'))!;
    const { id, createdAt } = before;
    const next = doc();
    next.steps = next.steps.filter((s) => s.id !== 'approve');
    next.edges = next.edges
      .filter((e) => e.source !== 'approve')
      .map((e) => (e.id === 'review-approve' ? { ...e, target: 'set-done' } : e));
    const r = await apply(next);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, action: 'replaced' });
    if (r.body.ok) {
      expect(r.body.diff.steps).toContainEqual({ op: '-', id: 'approve' });
      expect(r.body.diff.edges).toContainEqual({ op: '~', id: 'review-approve', fields: ['target'] });
    }
    const after = (await store.getBySlug('spec-review'))!;
    expect(after.id).toBe(id);
    expect(after.createdAt).toEqual(createdAt);
    expect(after.steps.map((s) => s.id)).not.toContain('approve');
  });

  it('keeps the human-arranged positions of steps that still exist when the document has none', async () => {
    await apply(doc());
    const t = (await store.getBySlug('spec-review'))!;
    t.steps = t.steps.map((s) => (s.id === 'spec' ? { ...s, position: { x: 999, y: 7 } } : s));
    await apply({ ...doc(), name: 'Renamed' });
    expect((await store.getBySlug('spec-review'))!.steps.find((s) => s.id === 'spec')!.position).toEqual({ x: 999, y: 7 });
  });

  it('a dry run reports the diff and never writes', async () => {
    const r = await apply(doc(), true);
    expect(r.body).toMatchObject({ ok: true, action: 'would_create', dryRun: true });
    expect(store.saves).toBe(0);
  });

  it('a refused document leaves the existing template untouched (atomic)', async () => {
    await apply(doc());
    const before = JSON.stringify((await store.getBySlug('spec-review'))!.toDTO());
    const broken = doc() as any;
    broken.name = 'Changed';
    broken.edges[0].target = 'nowhere';
    const r = await apply(broken);
    expect(r.status).toBe(422);
    expect(r.body.ok).toBe(false);
    expect(JSON.stringify((await store.getBySlug('spec-review'))!.toDTO())).toBe(before);
  });

  it('never refuses because of active runs — it reports how many keep the previous version', async () => {
    await apply(doc());
    const t = (await store.getBySlug('spec-review'))!;
    activeRuns = [{ templateId: t.id }, { templateId: 'other' }];
    const r = await apply({ ...doc(), description: 'v2' });
    expect(r.body).toMatchObject({ ok: true, action: 'replaced', activeRuns: 1 });
  });

  it('leaving "enabled" out of a replace keeps the current value', async () => {
    await apply({ ...doc(), enabled: false });
    await apply({ ...doc(), description: 'v2' });
    expect((await store.getBySlug('spec-review'))!.enabled).toBe(false);
  });

  it('refuses an agent that is not installed in this workspace, naming the closest one', async () => {
    const d = doc();
    d.steps[0]!.executorRef = 'catalist';
    const r = await apply(d);
    expect(r.status).toBe(422);
    if (!r.body.ok) expect(r.body.errors[0]!.message).toContain('did you mean "catalyst"');
  });
});
