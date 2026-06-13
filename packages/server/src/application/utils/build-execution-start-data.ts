import type { ExecutionKind, ExecutionStartData, MentionExecutionMode } from '@fleex/shared';

export interface BuildExecutionStartArgs {
  executionId: string;
  personaId: string;
  personaName: string;
  ticketId: string;
  mentionId?: string;
  model: string;
  effectiveMode: MentionExecutionMode;
  worktreePath?: string | null;
  resumeSessionId?: string | null;
  kind: ExecutionKind;
  label?: string;
  skillId?: string;
  skillName?: string;
  systemPromptSections: string[];
  systemPromptLength: number;
  userPromptLength: number;
  ticketTitle: string;
  ticketStatus: string;
  commentsCount: number;
  deliverablesCount: number;
}

/**
 * Single source of truth for the `execution_start` event payload.
 *
 * The Execution Log header (`AgentEventStream`) is entirely data-driven: it
 * shows the mode badge only when `effectiveMode` is present and the
 * `ticket:` / `context:` lines only when `context` is present. Previously each
 * emit-site built its own payload, so skill/panel runs emitted a bare header
 * and the workflow step only a partial one. Routing every site through this
 * builder guarantees identical richness — and always includes `ticketId`, which
 * the comments-tab "xxx is working" indicator keys on.
 */
export function buildExecutionStartData(args: BuildExecutionStartArgs): ExecutionStartData {
  return {
    executionId: args.executionId,
    personaId: args.personaId,
    personaName: args.personaName,
    ticketId: args.ticketId,
    mentionId: args.mentionId,
    model: args.model,
    effectiveMode: args.effectiveMode,
    worktreePath: args.worktreePath ?? null,
    resumeSessionId: args.resumeSessionId ?? null,
    kind: args.kind,
    label: args.label,
    skillId: args.skillId,
    skillName: args.skillName,
    context: {
      systemPromptSections: args.systemPromptSections,
      systemPromptLength: args.systemPromptLength,
      userPromptLength: args.userPromptLength,
      ticketTitle: args.ticketTitle,
      ticketStatus: args.ticketStatus,
      commentsCount: args.commentsCount,
      deliverablesCount: args.deliverablesCount,
    },
  };
}
