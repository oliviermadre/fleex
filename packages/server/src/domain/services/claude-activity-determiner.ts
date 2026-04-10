import type { ClaudeActivityStatus } from '@fleex/shared';
import type { ClaudeMessage, ClaudeContentBlock } from '../types/claude-message.js';

export interface ActivityInput {
  readonly messages: ClaudeMessage[];
  readonly fileAgeSeconds: number;
  readonly cpuPercent: number;
  readonly hasPendingToolApproval: boolean;
  readonly isClaudeRunning: boolean;
}

/**
 * Pure function state machine. Determines Claude activity status from JSONL messages,
 * file age, CPU usage, and pending tool approval flags.
 *
 * Key insight about Claude's JSONL format:
 *   assistant → tool_use blocks (Claude wants to call tools)
 *   user → tool_result blocks (the tool output sent back to Claude)
 *   assistant → text (Claude's response after seeing tool output)
 *
 * A "user" message containing tool_result is NOT human input — it's automated
 * tool feedback. We must distinguish this from actual human messages.
 */
const CPU_ACTIVE_THRESHOLD = 3;

export function determineClaudeActivity(input: ActivityInput): ClaudeActivityStatus {
  const { messages, fileAgeSeconds, cpuPercent, hasPendingToolApproval, isClaudeRunning } = input;

  // Filter out progress/system noise — only care about user/assistant turns
  const meaningful = messages.filter(
    (m) => m.type === 'user' || m.type === 'assistant',
  );

  if (meaningful.length === 0) {
    // No meaningful messages visible — but a pending tool approval from
    // subagents still indicates the session is waiting for input.
    if (hasPendingToolApproval) {
      return 'waiting_tool_approval';
    }
    // File recently modified + CPU active → likely working (progress msgs only)
    if (fileAgeSeconds <= 10 && cpuPercent > CPU_ACTIVE_THRESHOLD) {
      return 'working';
    }
    return 'unknown';
  }

  const last = meaningful[meaningful.length - 1]!;
  const prev = meaningful.length >= 2 ? meaningful[meaningful.length - 2] : undefined;

  if (last.type === 'user') {
    if (hasToolResult(last)) {
      // Tool result sent back to Claude → Claude is processing the result
      if (fileAgeSeconds <= 10) return 'working';
      if (cpuPercent > CPU_ACTIVE_THRESHOLD) return 'working';
      // Claude process is alive but JSONL is stale → waiting for user input
      // (e.g. ExitPlanMode not written to JSONL yet)
      if (isClaudeRunning && fileAgeSeconds > 30) return 'waiting_tool_approval';
      return 'idle';
    }
    // Actual human message
    if (fileAgeSeconds <= 5) return 'working';
    if (cpuPercent > CPU_ACTIVE_THRESHOLD) return 'working';
    if (isClaudeRunning && fileAgeSeconds > 30) return 'waiting_tool_approval';
    return 'idle';
  }

  // last.type === 'assistant'
  const tools = extractToolUseBlocks(last);

  if (tools.length > 0) {
    // Check if the previous message was a tool_result for these tools.
    // If so, this assistant message with tool_use came AFTER getting results —
    // it's a new round of tool calls, not a stale one.
    if (prev && prev.type === 'user' && hasToolResult(prev)) {
      // Claude got tool results and is now calling more tools — actively working
      return determineFromTools(tools, fileAgeSeconds, cpuPercent, hasPendingToolApproval);
    }

    return determineFromTools(tools, fileAgeSeconds, cpuPercent, hasPendingToolApproval);
  }

  // Assistant message with no tool_use blocks (pure text response)
  // If preceded by a tool_result, Claude just finished processing tools
  if (fileAgeSeconds <= 2) return 'working';
  return 'idle';
}

function hasToolResult(msg: ClaudeMessage): boolean {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => block.type === 'tool_result');
}

function extractToolUseBlocks(msg: ClaudeMessage): ClaudeContentBlock[] {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use');
}

function determineFromTools(
  tools: ClaudeContentBlock[],
  fileAgeSeconds: number,
  cpuPercent: number,
  hasPendingToolApproval: boolean,
): ClaudeActivityStatus {
  const toolNames = new Set(tools.map((t) => t.name).filter(Boolean));

  // Interactive tools — always waiting for human regardless of timing
  if (toolNames.has('AskUserQuestion')) {
    return 'waiting_user_choice';
  }

  if (toolNames.has('EnterPlanMode') || toolNames.has('ExitPlanMode')) {
    return 'waiting_plan_approval';
  }

  // Task tool — subagents run for a long time
  if (toolNames.has('Task')) {
    if (hasPendingToolApproval) {
      return 'waiting_tool_approval';
    }
    if (cpuPercent < 1 && fileAgeSeconds > 5) {
      return 'waiting_tool_approval';
    }
    if (fileAgeSeconds <= 600) {
      return 'executing';
    }
    return 'waiting_tool_approval';
  }

  // Other tools (Bash, Read, Write, Edit, etc.)
  // These tools execute then write a tool_result "user" message.
  // If we're still seeing the assistant tool_use as the last message,
  // the tool hasn't finished yet → it's executing or waiting for approval.
  if (fileAgeSeconds <= 30) {
    return 'executing';
  }
  return 'waiting_tool_approval';
}
