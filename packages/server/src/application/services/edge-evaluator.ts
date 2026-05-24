import type { WorkflowEdge, StepOutput, EdgeOperator } from '@fleex/shared';

export const EdgeEvaluator = {
  resolve(output: StepOutput, edges: WorkflowEdge[]): WorkflowEdge | null {
    const conditional = edges.filter((e) => e.condition && !e.isDefault).sort((a, b) => a.id.localeCompare(b.id));
    const defaults = edges.filter((e) => e.isDefault).sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of conditional) {
      if (!edge.condition) continue;
      const actual = getByPath(output, edge.condition.field);
      if (matches(actual, edge.condition.operator, edge.condition.value)) {
        return edge;
      }
    }
    return defaults[0] ?? null;
  },
};

function getByPath(output: StepOutput, path: string): unknown {
  // Merged view: schemaFields at top-level, plus standard fields
  const merged: Record<string, unknown> = {
    ...output.schemaFields,
    deliverable: output.deliverable,
    comment: output.comment,
    mentionStatus: output.mentionStatus,
    outcome: output.outcome,
    result: output.result,
  };
  const parts = path.split('.');
  let cur: unknown = merged;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as object)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function matches(actual: unknown, op: EdgeOperator, value: string | string[]): boolean {
  switch (op) {
    // eq/neq coerce actual to string to match the always-string `value`
    // (mirrors `in` and `gt`/`lt` behavior — agents may emit numbers/bools that
    // routing edges compare against string literals like `"high"` or `"10"`)
    case 'eq':       return typeof value === 'string' && String(actual) === value;
    case 'neq':      return typeof value === 'string' && String(actual) !== value;
    case 'in':       return Array.isArray(value) && value.includes(String(actual));
    case 'gt': {
      const a = Number(actual), v = Number(value as string);
      return Number.isFinite(a) && Number.isFinite(v) && a > v;
    }
    case 'lt': {
      const a = Number(actual), v = Number(value as string);
      return Number.isFinite(a) && Number.isFinite(v) && a < v;
    }
    case 'contains': return typeof actual === 'string' && typeof value === 'string' && actual.includes(value);
  }
}
