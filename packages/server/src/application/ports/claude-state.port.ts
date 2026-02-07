export interface ClaudeProcessInfo {
  readonly pid: number;
  readonly cpuPercent: number;
  readonly cwd: string;
}

export interface ClaudeSessionFileInfo {
  readonly path: string;
  readonly ageSeconds: number;
}

export interface ClaudeStatePort {
  /** Discover all running Claude processes with their PID, CPU%, and CWD. */
  discoverClaudeProcesses(): Promise<ClaudeProcessInfo[]>;

  /** Find the most recent non-agent JSONL session file for a given CWD. */
  findSessionFile(cwd: string): Promise<ClaudeSessionFileInfo | null>;

  /** Read the last N lines from a JSONL file (efficient tail-read). */
  readLastMessages(filePath: string, count: number): Promise<string[]>;

  /** Check if the most recent subagent has unpaired tool_use blocks. */
  checkPendingToolApproval(sessionFilePath: string): Promise<boolean>;
}
