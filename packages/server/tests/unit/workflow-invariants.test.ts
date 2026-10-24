import { describe, it, expect } from 'vitest';
import {
  INVARIANTS,
  EXAMPLE_CAPABILITIES,
  EXAMPLE_REFS,
  NATIVE_OPERATIONS,
  WORKFLOW_DOCUMENT_SCHEMA,
  buildApplyDocumentation,
  checkDocumentShape,
  minimalExample,
  renderApplyDocumentationMarkdown,
  richExample,
  runInvariantExample,
  validateWorkflow,
  type SchemaNode,
  type WorkflowInvariant,
} from '@fleex/shared';
import { SUPPORTED_SCHEMA_KEYWORDS } from '../../../shared/src/workflow/apply/schema.js';

/**
 * `fleex workflow apply --documentation` is the only thing an agent reads before
 * writing a workflow. These tests are what keeps it honest: every rule it
 * publishes is backed by an example that really triggers that rule — and only
 * that rule — so the doc can never describe a check the validator does not run,
 * nor show a message the validator does not produce.
 */

const env = { caps: EXAMPLE_CAPABILITIES };

describe('invariant registry — anti-drift', () => {
  it('declares each invariant id once', () => {
    const ids = INVARIANTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const inv of INVARIANTS) {
    const profile = inv.severity.apply !== 'off' ? 'apply' : 'save';
    it(`${inv.id}: its example violates it, and nothing else (${profile} profile)`, () => {
      const { result } = runInvariantExample(inv, profile);
      const hit = [...result.errors, ...result.warnings];
      expect(hit.length, `the example for ${inv.id} must trigger it`).toBeGreaterThan(0);
      expect([...new Set(hit.map((v) => v.invariant))]).toEqual([inv.id]);
      expect(hit.every((v) => v.severity === inv.severity[profile])).toBe(true);
    });
  }

  it('the minimal and rich examples pass the apply profile with zero errors and zero warnings', () => {
    for (const doc of [minimalExample(EXAMPLE_REFS), richExample(EXAMPLE_REFS)]) {
      expect(validateWorkflow(doc, env, 'apply')).toEqual({ errors: [], warnings: [] });
    }
  });

  it('the rich example covers what the recette gate asks for: ≥ 5 steps, a conditional branch, a gate, a native step', () => {
    const doc = richExample(EXAMPLE_REFS);
    expect(doc.steps.length).toBeGreaterThanOrEqual(5);
    expect(doc.edges.some((e) => e.conditionGroup)).toBe(true);
    expect(doc.steps.some((s) => s.executorType === 'human_gate')).toBe(true);
    expect(doc.steps.some((s) => s.executorType === 'native')).toBe(true);
  });
});

describe('documentation is generated from the registry', () => {
  const doc = buildApplyDocumentation({ caps: EXAMPLE_CAPABILITIES, workspace: 'test', generatedAt: 'now' });

  it('publishes every rule that is active on apply, with the message its check really produces', () => {
    const published = doc.rules.map((r) => r.id);
    expect(published).toEqual(INVARIANTS.filter((i) => i.severity.apply !== 'off').map((i) => i.id));
    for (const rule of doc.rules) {
      const inv = INVARIANTS.find((i) => i.id === rule.id)!;
      const own = [...runInvariantExample(inv).result.errors, ...runInvariantExample(inv).result.warnings]
        .find((v) => v.invariant === inv.id)!;
      expect(rule.example.message).toContain(own.message);
      expect(rule.example.message.startsWith(own.path)).toBe(true);
    }
  });

  it('a rule appended to the registry shows up in the doc with no other edit', () => {
    const extra: WorkflowInvariant = {
      id: 'test.always',
      scope: 'document',
      severity: { save: 'off', apply: 'warning' },
      stage: 'graph',
      rule: 'A rule that exists only in this test.',
      check: () => [{ path: '$.name', message: 'always reported' }],
      example: { describe: 'anything', build: (d) => d, excerpt: (d) => d.name },
    };
    const md = renderApplyDocumentationMarkdown(
      buildApplyDocumentation({ caps: EXAMPLE_CAPABILITIES }, [...INVARIANTS, extra]),
    );
    expect(md).toContain('### test.always (warning)');
    expect(md).toContain('A rule that exists only in this test.');
  });

  it('lists every native operation with its params', () => {
    expect(doc.capabilities.nativeOperations.map((o) => o.operationId)).toEqual(NATIVE_OPERATIONS.map((o) => o.id));
    const setStatus = doc.capabilities.nativeOperations.find((o) => o.operationId === 'ticket.set_status')!;
    expect(setStatus.params[0]).toMatchObject({ name: 'status', type: 'enum', required: true });
  });

  it('lists the agents and skills of the workspace it is given, and uses them in the examples', () => {
    const caps = { agents: [{ name: 'qa-bot' }], skills: [{ name: 'triage' }], panels: [] };
    const local = buildApplyDocumentation({ caps });
    expect(local.capabilities.agents).toEqual([{ name: 'qa-bot' }]);
    const rich = local.examples.find((e) => e.name === 'rich')!.document!;
    expect(rich.steps.find((s) => s.executorType === 'agent')!.executorRef).toBe('qa-bot');
    expect(rich.steps.find((s) => s.executorType === 'skill')!.executorRef).toBe('triage');
  });

  it('still serves a valid rich example in a workspace with an agent but no skill', () => {
    const caps = { agents: [{ name: 'claude-code' }], skills: [], panels: [] };
    const rich = buildApplyDocumentation({ caps }).examples.find((e) => e.name === 'rich')!.document!;
    expect(rich.steps.find((s) => s.id === 'review')).toMatchObject({ executorType: 'agent', executorRef: 'claude-code' });
    expect(validateWorkflow(rich, { caps }, 'apply')).toEqual({ errors: [], warnings: [] });
  });

  it('says so explicitly instead of serving a broken example in a workspace with no agent', () => {
    const empty = buildApplyDocumentation({ caps: { agents: [], skills: [], panels: [] } });
    expect(empty.examples.every((e) => e.document === null && e.unavailable?.includes('no agent'))).toBe(true);
  });
});

describe('document schema', () => {
  it('only uses keywords the interpreter understands', () => {
    const unknown: string[] = [];
    const walk = (node: SchemaNode, path: string) => {
      for (const key of Object.keys(node)) if (!SUPPORTED_SCHEMA_KEYWORDS.includes(key)) unknown.push(`${path}.${key}`);
      for (const [k, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.properties.${k}`);
      for (const [k, child] of Object.entries(node.$defs ?? {})) walk(child, `${path}.$defs.${k}`);
      if (node.items) walk(node.items, `${path}.items`);
      if (typeof node.additionalProperties === 'object') walk(node.additionalProperties, `${path}.additionalProperties`);
    };
    walk(WORKFLOW_DOCUMENT_SCHEMA, '$');
    expect(unknown).toEqual([]);
  });

  it('reports every shape problem at once, unknown fields at any depth included', () => {
    const doc = richExample(EXAMPLE_REFS) as unknown as Record<string, any>;
    doc.steps[2].foo = 1;
    doc.edges[1].conditionGroup.clauses[0].bar = true;
    doc.steps[0].executorType = 'bot';
    doc.edges[0].isDefault = 'yes';
    const issues = checkDocumentShape(doc);
    expect(issues.map((i) => [i.kind, i.path])).toEqual([
      ['shape', '$.steps[0].executorType'],
      ['unknown_field', '$.steps[2].foo'],
      ['shape', '$.edges[0].isDefault'],
      ['unknown_field', '$.edges[1].conditionGroup.clauses[0].bar'],
    ]);
  });
});

describe('validateWorkflow', () => {
  it('returns five independent mistakes in a single call, each naming where and what was expected', () => {
    const doc = richExample(EXAMPLE_REFS) as any;
    doc.steps[0].timeout = 300;                                                 // unknown field
    doc.steps[0].executorRef = 'catalist';                                      // unknown agent
    doc.steps[2].humanGateOutcomes.push('later');                              // uncovered gate outcome
    doc.edges.find((e: { id: string }) => e.id === 'review-again').isDefault = true; // second default…
    delete doc.edges.find((e: { id: string }) => e.id === 'review-again').conditionGroup;
    doc.edges.find((e: { id: string }) => e.id === 'done-stop').target = 'deploy'; // missing target

    const { errors } = validateWorkflow(doc, env, 'apply');
    const ids = [...new Set(errors.map((e) => e.invariant))].sort();
    expect(ids).toEqual([
      'edge.endpoints_exist',
      'edge.single_default',
      'executor.ref_exists',
      'gate.outcomes_covered',
      'schema.unknown_field',
    ]);
    expect(errors.find((e) => e.invariant === 'executor.ref_exists')).toMatchObject({
      path: '$.steps[0].executorRef', stepId: 'spec',
    });
    expect(errors.find((e) => e.invariant === 'executor.ref_exists')!.message).toContain('did you mean "catalyst"');
  });

  it('skips graph rules — and says so — when the shape is broken', () => {
    const r = validateWorkflow({ slug: 'x', name: 'X', entryStepId: 'a', steps: 'nope', edges: [] }, env, 'apply');
    expect(r.errors.map((e) => e.invariant)).toEqual(['schema.shape']);
    expect(r.skipped).toMatch(/not evaluated/);
  });

  it('keeps the editor tolerant: unknown fields and undeclared condition fields only warn on save', () => {
    const doc = richExample(EXAMPLE_REFS) as any;
    doc.steps.forEach((s: any, i: number) => { s.position = { x: i, y: 0 }; });
    doc.steps[0].legacyFlag = true;
    doc.edges[1].conditionGroup.clauses[0].field = 'verdict';
    const save = validateWorkflow(doc, { caps: null }, 'save');
    expect(save.errors).toEqual([]);
    expect(save.warnings.map((w) => w.invariant).sort()).toEqual(['edge.clause_field_declared', 'schema.unknown_field']);
    const apply = validateWorkflow(doc, env, 'apply');
    expect(apply.errors.map((w) => w.invariant).sort()).toEqual(['edge.clause_field_declared', 'schema.unknown_field']);
  });

  it('gives the exact conditionGroup replacement for a legacy condition', () => {
    const doc = richExample(EXAMPLE_REFS) as any;
    const edge = doc.edges.find((e: { id: string }) => e.id === 'review-again');
    edge.condition = { field: 'decision', operator: 'eq', value: 'changes_requested' };
    delete edge.conditionGroup;
    const [violation] = validateWorkflow(doc, env, 'apply').errors;
    expect(violation!.invariant).toBe('edge.legacy_condition');
    const replacement = JSON.parse(violation!.message.split('"conditionGroup": ')[1]!);
    edge.conditionGroup = replacement;
    delete edge.condition;
    expect(validateWorkflow(doc, env, 'apply').errors).toEqual([]);
  });
});
