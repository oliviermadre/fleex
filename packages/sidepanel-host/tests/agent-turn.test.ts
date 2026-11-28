import { describe, it, expect } from 'vitest';
import { agentActorEnv, buildSdkOptions } from '@fleex/shared';
import { assistantSdkOptions, capOutput, toolTarget, MAX_OUTPUT_BYTES } from '../src/agent-turn.ts';

const ctx = {
  prompt: 'hi',
  workDir: '/w/workspaces/assistant-1',
  model: 'claude-opus-5',
  workspace: 'qa',
  systemAppend: 'APPEND',
  guardHook: async () => ({}),
};

describe('Assistant SDK options: the same agent as a persona (D1, D5)', () => {
  const opts = assistantSdkOptions(ctx);

  it('runs in bypassPermissions with the user\'s and project\'s MCP and skills', () => {
    const persona = buildSdkOptions('edit', { model: 'm', systemPrompt: 's' });
    expect(opts.permissionMode).toBe(persona.permissionMode);
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
    expect(opts.settingSources).toEqual(persona.settingSources);
    expect(opts.cwd).toBe(ctx.workDir);
  });

  it('has the whole toolset, AskUserQuestion aside (RG4, P3)', () => {
    expect(opts).not.toHaveProperty('allowedTools');
    expect(opts.disallowedTools).toEqual(['AskUserQuestion']);
  });

  it('carries the persona env, signed Assistant, on the conversation\'s workspace (CA6)', () => {
    const env = opts.env as Record<string, string>;
    // Whatever agentActorEnv exports reaches the Assistant with no companion change.
    expect(env).toMatchObject(agentActorEnv('Assistant'));
    expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
    expect(env.FLEEX_WORKSPACE).toBe('qa');
    expect(env.FLEEX_ACTOR_PERSONA).toBeUndefined();
  });

  it('uses Claude Code\'s login first, the API key only when asked to (T1, P5)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-inherited';
    try {
      expect((assistantSdkOptions(ctx).env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined();
      expect((assistantSdkOptions({ ...ctx, apiKey: 'sk-fallback' }).env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-fallback');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('appends the Fleex prompt to the claude_code preset (P4)', () => {
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'APPEND' });
  });

  it('guards Write/Edit/NotebookEdit with a hook that may wait for days', () => {
    const pre = (opts.hooks as { PreToolUse: Array<{ matcher: string; timeout: number }> }).PreToolUse[0]!;
    expect(pre.matcher).toBe('Write|Edit|NotebookEdit');
    expect(pre.timeout).toBeGreaterThan(24 * 3600);
  });
});

describe('tool lines', () => {
  it('shows paths relative inside the folder, absolute outside (P22)', () => {
    expect(toolTarget('Write', { file_path: '/w/workspaces/assistant-1/export.ts' }, ctx.workDir)).toBe('export.ts');
    expect(toolTarget('Edit', { file_path: '/Users/x/.zshrc' }, ctx.workDir)).toBe('/Users/x/.zshrc');
    expect(toolTarget('mcp__notion__search', {}, ctx.workDir)).toBe('notion · search');
    expect(toolTarget('Bash', { command: 'x'.repeat(200) }, ctx.workDir)).toHaveLength(120);
  });

  it('keeps the end of an output beyond 200 KB (P11)', () => {
    const { text, truncated } = capOutput('a'.repeat(MAX_OUTPUT_BYTES) + 'END');
    expect(truncated).toBe(true);
    expect(text).toContain('END');
    expect(text).toContain('tronquée à 200 Ko');
  });
});
