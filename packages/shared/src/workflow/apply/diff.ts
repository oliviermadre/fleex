import type { WorkflowEdge, WorkflowStep } from '../../types/workflow.js';

/**
 * Structural diff between two versions of a template, keyed by step / edge id.
 * Small enough to read in a terminal, unlike a dump of both JSON documents.
 */

export interface DiffEntry {
  op: '+' | '-' | '~';
  id: string;
  /** For `~`: the fields that differ. */
  fields?: string[];
}

export interface TemplateDiff {
  steps: DiffEntry[];
  edges: DiffEntry[];
  /** Top-level fields that differ: name, emoji, description, enabled, entryStepId. */
  fields: string[];
}

export interface DiffableTemplate {
  name: string;
  emoji: string;
  description: string;
  enabled: boolean;
  entryStepId: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

const TOP_LEVEL_FIELDS = ['name', 'emoji', 'description', 'enabled', 'entryStepId'] as const;

/** JSON with sorted keys and `undefined` dropped, so key order never shows up as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  }) ?? 'undefined';
}

function diffById<T extends { id: string }>(before: T[], after: T[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const old = new Map(before.map((x) => [x.id, x]));
  const next = new Map(after.map((x) => [x.id, x]));
  for (const item of after) {
    const prev = old.get(item.id);
    if (!prev) {
      out.push({ op: '+', id: item.id });
      continue;
    }
    const keys = new Set([...Object.keys(prev), ...Object.keys(item)]);
    const fields = [...keys]
      .filter((k) => canonical((prev as Record<string, unknown>)[k]) !== canonical((item as Record<string, unknown>)[k]))
      .sort();
    if (fields.length > 0) out.push({ op: '~', id: item.id, fields });
  }
  for (const item of before) if (!next.has(item.id)) out.push({ op: '-', id: item.id });
  return out;
}

export function diffTemplates(before: DiffableTemplate | null, after: DiffableTemplate): TemplateDiff {
  if (!before) {
    return {
      steps: after.steps.map((s) => ({ op: '+', id: s.id })),
      edges: after.edges.map((e) => ({ op: '+', id: e.id })),
      fields: [],
    };
  }
  return {
    steps: diffById(before.steps, after.steps),
    edges: diffById(before.edges, after.edges),
    fields: TOP_LEVEL_FIELDS.filter((f) => canonical(before[f]) !== canonical(after[f])),
  };
}

export function isEmptyDiff(diff: TemplateDiff): boolean {
  return diff.steps.length === 0 && diff.edges.length === 0 && diff.fields.length === 0;
}
