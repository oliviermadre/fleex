import { describe, it, expect } from 'vitest';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../src/application/utils/merge-output-schemas.js';

describe('mergeOutputSchemas', () => {
  it('returns standard when custom is undefined', () => {
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, undefined);
    expect(merged).toEqual(STANDARD_OUTPUT_SCHEMA);
  });

  it('merges custom properties at top-level', () => {
    const custom = {
      type: 'object' as const,
      properties: { path: { type: 'string' as const, enum: ['standard','hotfix'] } },
      required: ['path'],
    };
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, custom);
    expect((merged.schema.properties as Record<string, unknown>).path).toEqual({ type: 'string', enum: ['standard','hotfix'] });
    expect((merged.schema.properties as Record<string, unknown>).deliverable).toBeDefined();
    expect(merged.schema.required).toContain('path');
    expect(merged.schema.required).toContain('deliverable');
  });

  it('custom required is added without removing standard required', () => {
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, {
      type: 'object', properties: { x: { type: 'string' } }, required: ['x'],
    });
    expect(merged.schema.required).toEqual(expect.arrayContaining(['x', 'deliverable', 'comment']));
  });
  it('requires questions in the standard schema, null allowed, so the agent decides every time', () => {
    const props = STANDARD_OUTPUT_SCHEMA.schema.properties as Record<string, { oneOf?: { type: string }[] }>;
    expect(props.questions!.oneOf!.map((o) => o.type)).toEqual(['array', 'null']);
    expect(STANDARD_OUTPUT_SCHEMA.schema.required).toEqual(['deliverable', 'comment', 'questions']);
  });

  it('keeps questions when merging a custom schema', () => {
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, { type: 'object', properties: { x: { type: 'string' } } });
    expect((merged.schema.properties as Record<string, unknown>).questions).toBeDefined();
  });
});
