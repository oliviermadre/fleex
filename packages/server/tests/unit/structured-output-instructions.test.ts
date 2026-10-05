import { describe, it, expect } from 'vitest';
import { buildStructuredOutputInstructions } from '../../src/application/use-cases/execute-agent.js';

describe('buildStructuredOutputInstructions — questions', () => {
  const out = buildStructuredOutputInstructions([]);

  it('puts the closed-choice rule inside the waiting_for_info contract', () => {
    const waiting = out.slice(out.indexOf('`"waiting_for_info"`'), out.indexOf('- **questions**'));
    expect(waiting).toContain('you MUST declare them in `questions`');
  });

  it('describes questions as a required key that is null when there is no closed choice', () => {
    const q = out.slice(out.indexOf('- **questions**'));
    expect(q).toContain('REQUIRED key');
    expect(q).toContain('`null`');
  });
});
