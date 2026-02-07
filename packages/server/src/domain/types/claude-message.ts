/**
 * Minimal types for parsing Claude Code JSONL session messages.
 * Only the fields we actually inspect are modeled.
 */

export interface ClaudeContentBlock {
  readonly type: string;
  readonly name?: string;
  readonly id?: string;
  readonly tool_use_id?: string;
}

export interface ClaudeMessage {
  readonly type: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | readonly ClaudeContentBlock[];
    readonly stop_reason?: string;
  };
}
