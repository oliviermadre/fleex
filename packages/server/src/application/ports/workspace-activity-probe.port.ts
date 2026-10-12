/**
 * What is still alive on the host, read once per cleanup run: tmux panes and
 * process working directories. A worktree something is still working in is
 * never cleaned up.
 */
export interface WorkspaceActivityProbe {
  /** `#{pane_current_path}` of every tmux pane (Fleex or not). No tmux server → []. */
  panePaths(): Promise<string[]>;
  /** Working directory of every process the user can see. Throws when the check cannot run. */
  processCwds(): Promise<{ pid: number; command?: string; cwd: string }[]>;
}
