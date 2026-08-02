import { describe, it, expect } from 'vitest';
import {
  mentionLineageKey,
  skillLineageKey,
  lineageKeyForExecution,
} from '../../src/application/utils/session-lineage.js';
import {
  resolveSessionDefault,
  buildLineageState,
} from '../../src/application/utils/resolve-session-default.js';

describe('session lineage keys', () => {
  // WHY: the product guarantee is "a direct mention never inherits a skill's or
  // a workflow step's transcript" — ticket #454. That used to hold only because
  // the workflow path never read the session map at all. These assertions make
  // the isolation structural: if the key shapes ever collapse into one another,
  // the guarantee breaks silently and this test is what catches it.
  it('never lets a mention and a skill on the same ticket share a key', () => {
    // Worst case: the skill id happens to equal the persona id.
    expect(mentionLineageKey('same-id', 't-1')).not.toBe(skillLineageKey('same-id', 't-1'));
  });

  it('separates the same persona across two tickets', () => {
    expect(mentionLineageKey('p-1', 't-1')).not.toBe(mentionLineageKey('p-1', 't-2'));
  });
});

describe('lineageKeyForExecution', () => {
  // WHY: `agent_event_executions.mention_id` is overloaded — a bare uuid for
  // mentions, `skill:<id>` for skills, `workflow:<execId>` for steps. Restoring
  // every row under `personaId:ticketId` (the pre-#454 behaviour) let the most
  // recent execution of ANY kind win, so after a server restart a mention could
  // resume a skill's session. Classification must happen from the row itself.
  it('classifies a bare mention row as a mention lineage', () => {
    expect(lineageKeyForExecution({
      personaId: 'p-1', ticketId: 't-1', mentionId: '11111111-2222-3333-4444-555555555555',
    })).toBe(mentionLineageKey('p-1', 't-1'));
  });

  it('classifies a skill row under the skill lineage, not the persona that ran it', () => {
    const key = lineageKeyForExecution({ personaId: 'p-1', ticketId: 't-1', mentionId: 'skill:sk-9' });
    expect(key).toBe(skillLineageKey('sk-9', 't-1'));
    expect(key).not.toBe(mentionLineageKey('p-1', 't-1'));
  });

  // WHY: a workflow step resumes through `step_run.executionId`, scoped to one
  // run. Seeding the shared map from a step row would let the NEXT mention on
  // that ticket resume the step's transcript.
  it('refuses to seed any lineage from a workflow-step row', () => {
    expect(lineageKeyForExecution({
      personaId: 'p-1', ticketId: 't-1', mentionId: 'workflow:exec-42',
    })).toBeNull();
  });

  it('refuses a malformed skill row rather than falling back to the persona lineage', () => {
    expect(lineageKeyForExecution({ personaId: 'p-1', ticketId: 't-1', mentionId: 'skill:' })).toBeNull();
  });
});

describe('resolveSessionDefault', () => {
  // WHY: the whole rule in one phrase — "on ne reprend que là où la machine
  // s'est arrêtée sans avoir fini". A run that ended cleanly is done; picking
  // its transcript back up drags a finished conversation into a new request.
  it('resumes only where the machine stopped without having finished', () => {
    expect(resolveSessionDefault('failed')).toBe('resume');
    expect(resolveSessionDefault('interrupted')).toBe('resume');

    expect(resolveSessionDefault('completed')).toBe('fresh');
    expect(resolveSessionDefault('cancelled')).toBe('fresh');
    expect(resolveSessionDefault('none')).toBe('fresh');
  });

  // WHY: `cancelled` is NOT "a human hit Terminate" — a Terminate on a mention
  // or a skill records `interrupted` (see `cancelExecution`), and must resume:
  // the usual reason to kill a mention by hand is a wrong conversation mode
  // spotted after launch, and the user wants the transcript back once fixed.
  // `cancelled` only ever comes from a workflow step run (Retry-while-running,
  // or cancelling the run), where the attempt itself is what's being thrown
  // away. Do not "harmonise" these two: they encode opposite intents.
  it('keeps a killed workflow attempt and a stopped mention on opposite defaults', () => {
    expect(resolveSessionDefault('cancelled')).toBe('fresh');
    expect(resolveSessionDefault('interrupted')).toBe('resume');
  });
});

describe('buildLineageState', () => {
  it('exposes the contextual default for a crashed run', () => {
    expect(buildLineageState({ sdkSessionId: 'abcdef01-2345', lastRunStatus: 'failed' })).toEqual({
      canResume: true,
      lastRunStatus: 'failed',
      defaultMode: 'resume',
      sessionIdPreview: 'abcdef01…',
    });
  });

  // WHY: `canResume` hangs off an actual session id, not off the run status. A
  // run can fail before the SDK ever hands one back (subprocess crash at
  // startup) — offering "Continuer" there would preselect an impossible action.
  it('forces fresh when there is no session to resume, whatever the last status', () => {
    const state = buildLineageState({ sdkSessionId: null, lastRunStatus: 'failed' });
    expect(state.canResume).toBe(false);
    expect(state.defaultMode).toBe('fresh');
    expect(state.sessionIdPreview).toBeNull();
  });

  it('keeps a completed run resumable on demand while defaulting to fresh', () => {
    const state = buildLineageState({ sdkSessionId: 'sess-1234-abcd', lastRunStatus: 'completed' });
    expect(state.canResume).toBe(true);
    expect(state.defaultMode).toBe('fresh');
  });
});
