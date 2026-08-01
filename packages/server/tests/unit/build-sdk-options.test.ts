import { describe, it, expect } from 'vitest';
import { buildSdkOptions } from '../../src/application/utils/build-sdk-options.js';

const ctx = { model: 'sonnet', systemPrompt: 'sp', resume: 'sess-1' };

describe('buildSdkOptions — resume', () => {
  // WHY (ticket #454, root cause): the resume spread used to live inside
  // `case 'edit'`. `plan` is the DEFAULT conversation mode, so the overwhelming
  // majority of mentions asked for a resume and silently got a cold start —
  // resuming "worked" only for the minority of runs in edit mode. Resuming is
  // orthogonal to the permission profile: it restores a transcript, it does not
  // widen what the agent may do. Every mode must honour it.
  it.each(['talk', 'plan', 'edit'] as const)('passes resume through in %s mode', (mode) => {
    expect(buildSdkOptions(mode, ctx)['resume']).toBe('sess-1');
  });

  it('omits the key entirely when there is nothing to resume', () => {
    for (const mode of ['talk', 'plan', 'edit'] as const) {
      expect(buildSdkOptions(mode, { model: 'sonnet', systemPrompt: 'sp' })).not.toHaveProperty('resume');
    }
  });

  // WHY: resuming must not be a backdoor around the mode's permission profile.
  // A resumed `talk` run stays tool-free; a resumed `plan` run stays read-only.
  it('does not widen the permission profile of the mode it resumes into', () => {
    expect(buildSdkOptions('talk', ctx)['allowedTools']).toEqual([]);
    expect(buildSdkOptions('plan', ctx)['permissionMode']).toBe('dontAsk');
    expect(buildSdkOptions('edit', ctx)['permissionMode']).toBe('bypassPermissions');
  });
});
