/**
 * Pure rendering + parsing helpers for `fleex workflow apply` — no API call,
 * no process exit, so vitest can lock the wording an agent reads.
 */
import type { TemplateDiff, Violation } from '@fleex/shared';

export type ApplyResult =
  | { ok: false; errors: Violation[]; warnings: Violation[]; skipped?: string }
  | {
    ok: true;
    action: 'created' | 'replaced' | 'unchanged' | 'would_create' | 'would_replace';
    dryRun: boolean;
    slug: string;
    diff: TemplateDiff;
    warnings: Violation[];
    activeRuns: number;
    layout: { computed: string[] };
  };

export interface Paint {
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
}

export const plain: Paint = { red: (s) => s, green: (s) => s, yellow: (s) => s, cyan: (s) => s, dim: (s) => s };

/** Parse the document, turning a JSON syntax error into "where + what" instead of a stack trace. */
export function parseDocument(text: string, source: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const before = text.slice(0, Number(pos[1]));
      const line = before.split('\n').length;
      const col = before.length - before.lastIndexOf('\n');
      return { ok: false, error: `--file ${source}: invalid JSON at line ${line} col ${col} (${message})` };
    }
    return { ok: false, error: `--file ${source}: invalid JSON (${message})` };
  }
}

function violationLines(v: Violation, p: Paint): string[] {
  const mark = v.severity === 'error' ? p.red(`✗ [${v.invariant}]`) : p.yellow(`⚠ [${v.invariant}]`);
  return [`${mark} ${v.path}`, `  ${v.message}`];
}

function diffLines(diff: TemplateDiff, p: Paint): string[] {
  const fmt = (entries: TemplateDiff['steps']) => entries.map((e) => {
    if (e.op === '+') return p.green(`+ ${e.id}`);
    if (e.op === '-') return p.red(`- ${e.id}`);
    return p.yellow(`~ ${e.id}`) + p.dim(` (${(e.fields ?? []).join(', ')})`);
  }).join('  ');
  const out: string[] = [];
  if (diff.steps.length) out.push(`  steps   ${fmt(diff.steps)}`);
  if (diff.edges.length) out.push(`  edges   ${fmt(diff.edges)}`);
  if (diff.fields.length) out.push(`  fields  ${diff.fields.map((f) => p.yellow(`~ ${f}`)).join('  ')}`);
  return out;
}

const ACTION_LABEL: Record<string, string> = {
  created: 'created',
  replaced: 'replaced',
  unchanged: 'unchanged',
  would_create: 'would create',
  would_replace: 'would replace',
};

export function renderApplyResult(result: ApplyResult, slug: string, p: Paint = plain): string {
  const out: string[] = [];
  if (!result.ok) {
    out.push(p.red(`✗ ${slug}: refused, ${result.errors.length} error(s), ${result.warnings.length} warning(s). Nothing was written.`), '');
    for (const v of result.errors) out.push(...violationLines(v, p), '');
    for (const v of result.warnings) out.push(...violationLines(v, p), '');
    if (result.skipped) out.push(p.yellow(`Note: ${result.skipped}.`), '');
    out.push(p.dim('Fix every error above, then run the same command again. Every rule, with examples: fleex workflow apply --documentation'));
    return out.join('\n');
  }

  const label = ACTION_LABEL[result.action] ?? result.action;
  const head = result.dryRun
    ? p.cyan(`◌ ${result.slug}: ${label} (dry run, nothing written)`)
    : result.action === 'unchanged'
      ? p.green(`✓ ${result.slug}: unchanged — nothing written`)
      : p.green(`✓ ${result.slug}: ${label}`);
  out.push(head);
  const lines = diffLines(result.diff, p);
  if (lines.length) out.push('', ...lines);
  if (result.layout.computed.length) {
    out.push('', p.dim(`  positions computed for ${result.layout.computed.length} step(s): ${result.layout.computed.join(', ')}`));
  }
  if (result.warnings.length) {
    out.push('');
    for (const v of result.warnings) out.push(...violationLines(v, p));
  }
  if (result.activeRuns > 0) {
    out.push('', p.cyan(`ℹ ${result.activeRuns} active run(s) keep the version they started with; new runs will use ${result.dryRun ? 'the applied one' : 'this one'}.`));
  }
  return out.join('\n');
}
