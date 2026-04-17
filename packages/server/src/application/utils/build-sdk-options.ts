import type { MentionExecutionMode } from '@fleex/shared';

interface SdkOptionsContext {
  model: string;
  systemPrompt: string;
  cwd?: string | null;
  outputFormat?: Record<string, unknown>;
  resume?: string;
}

export function buildSdkOptions(
  effectiveMode: MentionExecutionMode,
  ctx: SdkOptionsContext,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: ctx.model,
    systemPrompt: ctx.systemPrompt,
  };

  if (ctx.outputFormat) base.outputFormat = ctx.outputFormat;

  switch (effectiveMode) {
    case 'talk':
      // One-shot: no agentic loop, no tools. dontAsk denies all unlisted tools.
      // maxTurns: 0 is a defense-in-depth guard against any tool round-trip.
      return { ...base, allowedTools: [], permissionMode: 'dontAsk', maxTurns: 0 };

    case 'plan':
      return {
        ...base,
        allowedTools: ['Read', 'Glob', 'Grep', 'Skill'],
        permissionMode: 'dontAsk',
        settingSources: ['user', 'project'],
        maxTurns: 150,
        ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
      };

    case 'edit':
      return {
        ...base,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Skill'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project'],
        maxTurns: 150,
        ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
        ...(ctx.resume ? { resume: ctx.resume } : {}),
      };
  }
}
