import { checkDocumentShape, layoutSteps } from '@fleex/shared';
import type { ShapeIssue, WorkflowDocument, WorkflowEdge, WorkflowStep } from '@fleex/shared';

/**
 * JSON import / export of the workflow editor. The format is the existing
 * `WorkflowDocument` — what `fleex workflow apply` reads and
 * `fleex workflow show --json` prints — so a copied workflow round-trips
 * through the CLI unchanged.
 */

/** What the editor holds in its local state (unsaved edits included). */
export interface EditorWorkflowState {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  enabled: boolean;
  entryStepId: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

/**
 * The document for what the editor shows right now. `id`, `createdAt` and
 * `updatedAt` are left out: they belong to one workspace and `apply` ignores
 * them anyway. Key order is fixed so two exports of the same graph diff cleanly.
 */
export function toWorkflowDocument(state: EditorWorkflowState): WorkflowDocument {
  return {
    slug: state.slug,
    name: state.name,
    emoji: state.emoji,
    description: state.description,
    enabled: state.enabled,
    entryStepId: state.entryStepId,
    steps: state.steps,
    edges: state.edges,
  };
}

/** 2-space indent and a trailing newline, like a file a human would commit. */
export function serializeWorkflowDocument(doc: WorkflowDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function workflowJsonFileName(slug: string): string {
  return `${slug || 'workflow'}.workflow.json`;
}

export type ParsedWorkflowJson =
  | { ok: true; doc: WorkflowDocument }
  | { ok: false; parseError: string; shapeIssues: [] }
  | { ok: false; parseError: null; shapeIssues: ShapeIssue[] };

/** Steps 1 and 2 of the import check — both block the import. */
export function parseWorkflowJson(text: string): ParsedWorkflowJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, parseError: err instanceof Error ? err.message : String(err), shapeIssues: [] };
  }
  const shapeIssues = checkDocumentShape(value);
  if (shapeIssues.length > 0) return { ok: false, parseError: null, shapeIssues };
  return { ok: true, doc: value as WorkflowDocument };
}

/**
 * The editor state once `doc` has replaced its content. The editor keeps its
 * own slug (renaming would break every workflow including this one by slug)
 * and `enabled` (an import never switches a workflow on or off). Steps without
 * a position are laid out instead of piling up at (0,0).
 */
export function applyImportedDocument(state: EditorWorkflowState, doc: WorkflowDocument): EditorWorkflowState {
  const { steps } = layoutSteps(doc.steps, doc.edges, doc.entryStepId);
  return {
    slug: state.slug,
    enabled: state.enabled,
    name: doc.name,
    emoji: doc.emoji ?? '',
    description: doc.description ?? '',
    entryStepId: doc.entryStepId,
    steps,
    edges: doc.edges,
  };
}
