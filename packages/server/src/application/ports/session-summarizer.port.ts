/**
 * Summarizes a finished Claude Code session into a short markdown brief that can
 * be stored as a ticket deliverable. Implemented with a lightweight model so it
 * stays cheap to run on every `SessionEnd`.
 */
export interface SessionSummarizerPort {
  summarize(params: {
    /** Human-readable conversation text extracted from the transcript. */
    conversationText: string;
    /** Ticket title for context, when known. */
    ticketTitle: string | null;
    /** Working directory to run the model in (used for tool-free SDK runs). */
    cwd?: string | null;
  }): Promise<string | null>;
}
