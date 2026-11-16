import { describe, it, expect } from 'vitest';
import { checkDocumentShape, minimalExample, richExample, EXAMPLE_REFS } from '@fleex/shared';
import {
  applyImportedDocument, parseWorkflowJson, serializeWorkflowDocument, toWorkflowDocument, workflowJsonFileName,
  type EditorWorkflowState,
} from './workflowJson';

function editorState(): EditorWorkflowState {
  return {
    slug: 'spec-dev-pr',
    name: 'Spec Dev PR',
    emoji: '📦',
    description: 'spec then PR',
    enabled: false,
    entryStepId: 'spec',
    steps: [
      { id: 'spec', name: 'Spec', executorType: 'agent', executorRef: 'catalyst', prompt: 'Write it', position: { x: 10, y: 20 } },
      { id: 'gate', name: 'Check', executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['approve', 'reject'], position: { x: 300, y: 20 } },
    ],
    edges: [{ id: 'e1', source: 'spec', target: 'gate', isDefault: true }],
  };
}

describe('toWorkflowDocument', () => {
  it('exports only portable fields, in a fixed order — never workspace ids or dates', () => {
    // A template object straight from the store carries id/createdAt/updatedAt.
    const fromStore = { ...editorState(), id: 'wf_1', createdAt: '2026-01-01', updatedAt: '2026-01-02' };
    const doc = toWorkflowDocument(fromStore);
    expect(Object.keys(doc)).toEqual(['slug', 'name', 'emoji', 'description', 'enabled', 'entryStepId', 'steps', 'edges']);
  });

  it('produces a document `fleex workflow apply` accepts as is', () => {
    expect(checkDocumentShape(JSON.parse(serializeWorkflowDocument(toWorkflowDocument(editorState()))))).toEqual([]);
  });

  it('serializes with a 2-space indent and a trailing newline', () => {
    const json = serializeWorkflowDocument(toWorkflowDocument(editorState()));
    expect(json.endsWith('}\n')).toBe(true);
    expect(json.split('\n')[1]).toBe('  "slug": "spec-dev-pr",');
  });

  it('names the file after the slug', () => {
    expect(workflowJsonFileName('spec-dev-pr')).toBe('spec-dev-pr.workflow.json');
  });
});

describe('parseWorkflowJson', () => {
  it('reports the parser message on invalid JSON', () => {
    const r = parseWorkflowJson('{ "slug": ');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.parseError).toBeTruthy();
  });

  it('reports every shape issue with its path', () => {
    const doc = minimalExample(EXAMPLE_REFS) as unknown as Record<string, unknown>;
    delete doc.edges;
    (doc.steps as { executorType: string }[])[0]!.executorType = 'llm';
    const r = parseWorkflowJson(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    const paths = !r.ok ? r.shapeIssues.map((i) => i.path) : [];
    expect(paths).toContain('$.edges');
    expect(paths).toContain('$.steps[0].executorType');
  });

  it('accepts a valid document', () => {
    expect(parseWorkflowJson(JSON.stringify(richExample(EXAMPLE_REFS))).ok).toBe(true);
  });
});

describe('applyImportedDocument', () => {
  it('round-trips: export then import leaves steps, edges, entry and positions identical', () => {
    const state = editorState();
    const parsed = parseWorkflowJson(serializeWorkflowDocument(toWorkflowDocument(state)));
    if (!parsed.ok) throw new Error('export did not parse back');
    expect(applyImportedDocument(state, parsed.doc)).toEqual(state);
  });

  it('replaces content but keeps the editor slug (included sub-workflows reference it) and enabled', () => {
    const doc = { ...richExample(EXAMPLE_REFS), enabled: true };
    const next = applyImportedDocument(editorState(), doc);
    expect(next.slug).toBe('spec-dev-pr');
    expect(next.enabled).toBe(false);
    expect(next.name).toBe(doc.name);
    expect(next.entryStepId).toBe(doc.entryStepId);
    expect(next.edges).toEqual(doc.edges);
    expect(next.steps.map((s) => s.id)).toEqual(doc.steps.map((s) => s.id));
  });

  it('empties emoji and description the document leaves out', () => {
    const next = applyImportedDocument(editorState(), minimalExample(EXAMPLE_REFS));
    expect(next.emoji).toBe('');
    expect(next.description).toBe('');
  });

  it('lays out steps without a position instead of piling them at (0,0)', () => {
    const next = applyImportedDocument(editorState(), minimalExample(EXAMPLE_REFS));
    const positions = next.steps.map((s) => `${s.position.x},${s.position.y}`);
    expect(next.steps.every((s) => s.position)).toBe(true);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
