import type { MentionExecutionMode, EffortLevel } from '@fleex/shared';
import { DEFAULT_AGENT_MAX_TURNS, AGENT_MAX_TURNS_MIN, AGENT_MAX_TURNS_MAX } from '@fleex/shared';

interface SdkOptionsContext {
  model: string;
  systemPrompt: string;
  cwd?: string | null;
  outputFormat?: Record<string, unknown>;
  resume?: string;
  /**
   * Reasoning effort override. MUST already be resolved against `model` via
   * `resolveEffortLevel` — this is a passthrough, not a gate, and a level the
   * model doesn't accept (e.g. `xhigh` on Sonnet 4.6) is a hard 400.
   */
  effort?: EffortLevel;
  /** Fast-mode toggle, applied via SDK settings only when the model supports it. */
  fast?: boolean;
  /**
   * Talk mode only: the prompt references an image attachment materialized to a
   * file. Talk is normally tool-free, but an image can only be viewed via the
   * Read tool, so we enable just Read (+ a few turns) when one is present.
   */
  talkCanReadImages?: boolean;
  /**
   * Agentic loop cap for plan/edit modes (Settings › General → `agentMaxTurns`).
   * Falls back to DEFAULT_AGENT_MAX_TURNS when unset, and is clamped to a sane
   * range so a bad config value can't disable the loop or unbound it.
   * Talk mode ignores this — its 0/4 caps are permission guards, not budgets.
   *
   * NB: this is the SDK's own `maxTurns` — "a turn consists of a user message
   * and assistant response" (one API round-trip), not a per-tool-call count.
   * A single turn can bundle several parallel tool calls (e.g. reading many
   * files at once), so the number of tool actions visible in the Execution Log
   * can exceed this value without indicating the cap was ignored.
   */
  maxTurns?: number;
}

/** Clamp a configured turn budget, falling back to the default when unusable. */
function resolveMaxTurns(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AGENT_MAX_TURNS;
  return Math.min(AGENT_MAX_TURNS_MAX, Math.max(AGENT_MAX_TURNS_MIN, Math.floor(value)));
}

/**
 * The turn budget a run will actually get, for reporting purposes (execution
 * header + `execution_end`). Mirrors what `buildSdkOptions` hands the SDK, so
 * the number shown in the Execution Log is the real, clamped cap rather than
 * the raw config value. Returns undefined for talk mode, whose 0/4 caps are
 * permission guards rather than a user-facing budget.
 */
export function effectiveMaxTurns(
  effectiveMode: MentionExecutionMode,
  configured: number | undefined,
): number | undefined {
  if (effectiveMode === 'talk') return undefined;
  return resolveMaxTurns(configured);
}

export function buildSdkOptions(
  effectiveMode: MentionExecutionMode,
  ctx: SdkOptionsContext,
): Record<string, unknown> {
  const cliPath = process.env['CLAUDE_CLI_PATH'];
  const maxTurns = resolveMaxTurns(ctx.maxTurns);
  const base: Record<string, unknown> = {
    model: ctx.model,
    systemPrompt: ctx.systemPrompt,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
  };

  // Reasoning effort is a direct query() option; fast mode goes through settings.
  if (ctx.effort) base.effort = ctx.effort;
  if (ctx.fast) base.settings = { ...(base.settings as Record<string, unknown> | undefined), fastMode: true };

  if (ctx.outputFormat) base.outputFormat = ctx.outputFormat;

  switch (effectiveMode) {
    case 'talk':
      // One-shot: no agentic loop, no tools. dontAsk denies all unlisted tools.
      // maxTurns: 0 is a defense-in-depth guard against any tool round-trip.
      //
      // Exception: when the prompt carries an image attachment, the only way to
      // show it (talk has no worktree, images aren't inlined) is to let the
      // agent Read the materialized file. Enable ONLY Read, with a few turns so
      // the Read result can feed back before the final answer.
      if (ctx.talkCanReadImages) {
        return {
          ...base,
          allowedTools: ['Read'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 4,
        };
      }
      return { ...base, allowedTools: [], permissionMode: 'dontAsk', maxTurns: 0 };

    case 'plan':
      return {
        ...base,
        allowedTools: ['Read', 'Glob', 'Grep', 'Skill'],
        permissionMode: 'dontAsk',
        settingSources: ['user', 'project'],
        maxTurns,
        ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
      };

    case 'edit':
      return {
        ...base,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Skill'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project'],
        maxTurns,
        ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
        ...(ctx.resume ? { resume: ctx.resume } : {}),
      };
  }
}
