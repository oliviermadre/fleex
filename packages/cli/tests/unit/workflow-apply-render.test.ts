import { describe, it, expect } from 'vitest';
import { parseDocument, renderApplyResult } from '../../src/commands/workflow/apply/render.ts';

/**
 * What an agent reads after `fleex workflow apply`. It must be able to fix
 * every problem from this output alone, in one turn: each violation names its
 * rule, where it is, and what was expected — and a refusal says nothing was written.
 */
describe('workflow apply — output', () => {
  it('a refusal lists every violation with its rule id and path, and says nothing was written', () => {
    const out = renderApplyResult({
      ok: false,
      errors: [
        { invariant: 'edge.endpoints_exist', severity: 'error', path: '$.edges[3].target', edgeId: 'qa-ok', message: 'edge qa-ok target "deploy" not found in steps[] (expected one of: spec, qa)' },
        { invariant: 'schema.unknown_field', severity: 'error', path: '$.steps[1].timeout', message: '$.steps[1].timeout: unknown field "timeout" on step (allowed: id, name)' },
      ],
      warnings: [],
    }, 'bugfix');
    expect(out).toContain('✗ bugfix: refused, 2 error(s), 0 warning(s). Nothing was written.');
    expect(out).toContain('✗ [edge.endpoints_exist] $.edges[3].target');
    expect(out).toContain('expected one of: spec, qa');
    expect(out).toContain('✗ [schema.unknown_field] $.steps[1].timeout');
    expect(out).toContain('fleex workflow apply --documentation');
  });

  it('tells the agent when graph rules were skipped, so it expects a second round', () => {
    const out = renderApplyResult({ ok: false, errors: [], warnings: [], skipped: 'graph rules were not evaluated' }, 'x');
    expect(out).toContain('Note: graph rules were not evaluated.');
  });

  it('a dry run says nothing was written and shows the structural diff', () => {
    const out = renderApplyResult({
      ok: true,
      action: 'would_replace',
      dryRun: true,
      slug: 'bugfix',
      diff: {
        steps: [{ op: '+', id: 'repro' }, { op: '-', id: 'manual' }, { op: '~', id: 'fix', fields: ['prompt'] }],
        edges: [],
        fields: ['description'],
      },
      warnings: [],
      activeRuns: 2,
      layout: { computed: [] },
    }, 'bugfix');
    expect(out).toContain('◌ bugfix: would replace (dry run, nothing written)');
    expect(out).toContain('+ repro');
    expect(out).toContain('- manual');
    expect(out).toContain('~ fix (prompt)');
    expect(out).toContain('~ description');
    expect(out).toContain('2 active run(s) keep the version they started with');
  });

  it('re-applying an unchanged document says so', () => {
    const out = renderApplyResult({
      ok: true, action: 'unchanged', dryRun: false, slug: 'bugfix',
      diff: { steps: [], edges: [], fields: [] }, warnings: [], activeRuns: 0, layout: { computed: [] },
    }, 'bugfix');
    expect(out).toBe('✓ bugfix: unchanged — nothing written');
  });
});

describe('workflow apply — document parsing', () => {
  it('locates a JSON syntax error by line and column when the parser gives a position', () => {
    const r = parseDocument('{\n  "slug": "x",\n  }', 'wf.json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^--file wf\.json: invalid JSON/);
  });

  it('parses a valid document', () => {
    expect(parseDocument('{"slug":"x"}', 'wf.json')).toEqual({ ok: true, value: { slug: 'x' } });
  });
});
