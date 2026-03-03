import { describe, it, expect } from 'vitest';
import { parseAgentOutput } from '../../src/application/utils/parse-agent-output.js';

describe('parseAgentOutput', () => {
  it('parses clean JSON with both fields', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Analysis Report', markdown: '# Report\n\nFindings...', type: 'report', status: 'final' },
      comment: 'Done! @agent:reviewer please take a look.',
    });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: { title: 'Analysis Report', markdown: '# Report\n\nFindings...', type: 'report', status: 'final' },
      comment: 'Done! @agent:reviewer please take a look.',
    });
  });

  it('parses JSON from markdown code fence', () => {
    const input = `Here is my output:

\`\`\`json
{
  "deliverable": { "title": "Fix", "markdown": "Changed X to Y", "type": "code", "status": "final" },
  "comment": "Fixed the bug"
}
\`\`\``;
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: { title: 'Fix', markdown: 'Changed X to Y', type: 'code', status: 'final' },
      comment: 'Fixed the bug',
    });
  });

  it('parses JSON from code fence without json language tag', () => {
    const input = `\`\`\`
{ "deliverable": null, "comment": "No work needed" }
\`\`\``;
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: null,
      comment: 'No work needed',
    });
  });

  it('parses JSON with surrounding prose (last braces strategy)', () => {
    const input = `I've completed the analysis. Here's the result:

{"deliverable": {"title": "Code Review", "markdown": "Looks good", "type": "report", "status": "final"}, "comment": null}

Hope that helps!`;
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: { title: 'Code Review', markdown: 'Looks good', type: 'report', status: 'final' },
      comment: null,
    });
  });

  it('handles deliverable-only output (comment is null)', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Implementation', markdown: '```ts\nconst x = 1;\n```', type: 'code', status: 'draft' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: { title: 'Implementation', markdown: '```ts\nconst x = 1;\n```', type: 'code', status: 'draft' },
      comment: null,
    });
  });

  it('handles comment-only output (deliverable is null)', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 'I need more context. @agent:pm can you clarify?',
    });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: null,
      comment: 'I need more context. @agent:pm can you clarify?',
    });
  });

  it('handles both-null (silent completion)', () => {
    const input = JSON.stringify({ deliverable: null, comment: null });
    const result = parseAgentOutput(input);
    expect(result).toEqual({ deliverable: null, comment: null });
  });

  it('accepts missing comment key (defaults to null)', () => {
    const input = JSON.stringify({
      deliverable: { title: 'T', markdown: 'M' },
    });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: { title: 'T', markdown: 'M', type: 'report', status: 'draft' },
      comment: null,
    });
  });

  it('accepts missing deliverable key (defaults to null)', () => {
    const input = JSON.stringify({ comment: 'Hello' });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: null,
      comment: 'Hello',
    });
  });

  it('returns null for malformed deliverable shape (missing title)', () => {
    const input = JSON.stringify({
      deliverable: { markdown: 'content but no title' },
      comment: 'hi',
    });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('returns null for malformed deliverable shape (wrong types)', () => {
    const input = JSON.stringify({
      deliverable: { title: 123, markdown: true },
      comment: 'hi',
    });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('returns null for comment with wrong type', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 42,
    });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('returns null for object without deliverable or comment keys', () => {
    const input = JSON.stringify({ foo: 'bar', baz: 123 });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('returns null for plain text (not JSON at all)', () => {
    expect(parseAgentOutput('I completed the task successfully.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseAgentOutput('')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(parseAgentOutput('[1, 2, 3]')).toBeNull();
  });

  it('returns null for a JSON string primitive', () => {
    expect(parseAgentOutput('"just a string"')).toBeNull();
  });

  it('handles deliverable as array (invalid)', () => {
    const input = JSON.stringify({
      deliverable: ['not', 'valid'],
      comment: 'hi',
    });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('handles nested braces in deliverable markdown', () => {
    const input = JSON.stringify({
      deliverable: {
        title: 'Code',
        markdown: 'function foo() { return { a: 1 }; }',
      },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result).toEqual({
      deliverable: {
        title: 'Code',
        markdown: 'function foo() { return { a: 1 }; }',
        type: 'report',
        status: 'draft',
      },
      comment: null,
    });
  });

  it('handles prose + JSON with escaped quotes in markdown (last-braces strategy)', () => {
    const json = {
      deliverable: {
        title: 'PRD',
        markdown: 'Gérer le cas "path introuvable" en deux temps',
      },
      comment: 'Voilà le PRD',
    };
    const input = `I need to spec this out.\n\n${JSON.stringify(json)}`;
    expect(parseAgentOutput(input)).toEqual({
      ...json,
      deliverable: { ...json.deliverable, type: 'report', status: 'draft' },
    });
  });

  it('prefers whole-string parse over code fence', () => {
    // If the entire string is valid JSON, code fence extraction shouldn't matter
    const json = { deliverable: null, comment: 'test' };
    const result = parseAgentOutput(JSON.stringify(json));
    expect(result).toEqual(json);
  });

  it('defaults deliverable status to draft when missing', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Report', markdown: '# Content' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result?.deliverable?.status).toBe('draft');
  });

  it('defaults deliverable type to report when missing', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Report', markdown: '# Content', status: 'final' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result?.deliverable?.type).toBe('report');
  });

  it('preserves explicit type', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Spec', markdown: '# Spec', type: 'prd', status: 'final' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result?.deliverable?.type).toBe('prd');
  });

  it('preserves explicit draft status', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Report', markdown: '# Content', status: 'draft' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result?.deliverable?.status).toBe('draft');
  });

  it('preserves explicit final status', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Report', markdown: '# Content', status: 'final' },
      comment: null,
    });
    const result = parseAgentOutput(input);
    expect(result?.deliverable?.status).toBe('final');
  });

  it('rejects invalid deliverable status value', () => {
    const input = JSON.stringify({
      deliverable: { title: 'Report', markdown: '# Content', status: 'invalid' },
      comment: null,
    });
    expect(parseAgentOutput(input)).toBeNull();
  });

  it('parses mentionStatus: resolved', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 'All done.',
      mentionStatus: 'resolved',
    });
    const result = parseAgentOutput(input);
    expect(result?.mentionStatus).toBe('resolved');
  });

  it('parses mentionStatus: waiting_for_info', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 'I need more details about X.',
      mentionStatus: 'waiting_for_info',
    });
    const result = parseAgentOutput(input);
    expect(result?.mentionStatus).toBe('waiting_for_info');
  });

  it('omits mentionStatus when not provided', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 'Done.',
    });
    const result = parseAgentOutput(input);
    expect(result?.mentionStatus).toBeUndefined();
  });

  it('ignores invalid mentionStatus value', () => {
    const input = JSON.stringify({
      deliverable: null,
      comment: 'Done.',
      mentionStatus: 'invalid',
    });
    const result = parseAgentOutput(input);
    expect(result?.mentionStatus).toBeUndefined();
  });
});
