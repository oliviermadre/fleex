import { describe, it, expect } from 'vitest';
import type { WorkMode } from '../../stores/workStore';
import { activeMode, cycleMode } from './modes';

/** Every mode visited by pressing the shortcut `steps` times from `start`. */
function walk(start: WorkMode, dir: 1 | -1, hasWorkflowRuns: boolean, steps: number): WorkMode[] {
  const seen: WorkMode[] = [];
  let mode = start;
  for (let i = 0; i < steps; i++) {
    mode = cycleMode(mode, dir, hasWorkflowRuns);
    seen.push(mode);
  }
  return seen;
}

describe('cycleMode', () => {
  it('goes Chat → Shell → Code → Workflow → Chat when the ticket has workflow runs', () => {
    expect(walk('chat', 1, true, 4)).toEqual(['shell', 'code', 'workflow', 'chat']);
  });

  it('skips Workflow when the ticket has no runs', () => {
    expect(walk('chat', 1, false, 3)).toEqual(['shell', 'code', 'chat']);
  });

  it('walks the same loop backwards', () => {
    expect(walk('chat', -1, true, 4)).toEqual(['workflow', 'code', 'shell', 'chat']);
    expect(walk('chat', -1, false, 3)).toEqual(['code', 'shell', 'chat']);
  });

  it('leaves a remembered Workflow for the next mode even after its runs are gone', () => {
    expect(cycleMode('workflow', 1, false)).toBe('shell');
  });
});

describe('activeMode', () => {
  it('reads the takeover flags, with Workflow shown only when the ticket has runs', () => {
    const none = { shellMode: false, codeMode: false, workflowMode: false };
    expect(activeMode(none, true)).toBe('chat');
    expect(activeMode({ ...none, shellMode: true }, false)).toBe('shell');
    expect(activeMode({ ...none, codeMode: true }, false)).toBe('code');
    expect(activeMode({ ...none, workflowMode: true }, true)).toBe('workflow');
    expect(activeMode({ ...none, workflowMode: true }, false)).toBe('chat');
  });
});
