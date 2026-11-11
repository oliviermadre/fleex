import type { ConversationMode, EffortLevel, ExecutionMode, MentionExecutionMode } from '@fleex/shared';
import { inferModelCapabilities, resolveEffortLevel } from '@fleex/shared';
import type { LoggerPort } from '../ports/logger.port.js';

export interface ResolvedExecutionConfig {
  mode: MentionExecutionMode;
  model: string;
  effort?: EffortLevel;
  fast: boolean;
}

/**
 * Conversation-scoped execution config: the ticket's mode/model/effort/fast
 * overrides applied over the persona defaults, for agent runs (ExecuteAgent).
 * The assistant's own turn does not go through it: it runs on its persona's
 * model, and only reads the resolved mode of the targets it delegates to.
 */
export function resolveExecutionConfig(
  persona: { executionMode: ExecutionMode; model: string },
  ticket: { conversationMode: ConversationMode; modelOverride: string | null; effortOverride: EffortLevel | null; fastMode: boolean } | null,
  logger?: Pick<LoggerPort, 'warn'>,
): ResolvedExecutionConfig {
  const conversationMode: MentionExecutionMode = ticket?.conversationMode ?? 'plan';
  const mode: MentionExecutionMode = persona.executionMode === 'message' ? 'talk' : conversationMode;

  const model = ticket?.modelOverride ?? persona.model;
  const caps = inferModelCapabilities(model);

  const requestedEffort = ticket?.effortOverride ?? null;
  const effort = resolveEffortLevel(model, requestedEffort);
  if (requestedEffort && effort !== requestedEffort) {
    logger?.warn('Effort override not supported by model — adjusted', {
      model,
      requested: requestedEffort,
      applied: effort ?? 'none',
      supported: caps.effortLevels,
    });
  }
  const fast = caps.supportsFastMode && (ticket?.fastMode ?? false);

  return { mode, model, effort, fast };
}
