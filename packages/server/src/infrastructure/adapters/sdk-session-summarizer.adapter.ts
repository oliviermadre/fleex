import type { SessionSummarizerPort } from '../../application/ports/session-summarizer.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import { buildSdkOptions } from '../../application/utils/build-sdk-options.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You summarize a finished coding session for a ticket's record.
Write a concise markdown brief (no preamble, no title heading) capturing:
- the key decisions made and why,
- what was changed or produced,
- anything left open / follow-ups.
Be specific and factual; omit small talk and tool mechanics. Aim for under 250 words.`;

/**
 * Summarizes a session transcript with a lightweight model via the Claude Agent
 * SDK in tool-free one-shot ("talk") mode — reuses the user's local Claude Code
 * auth like the rest of the agentic stack, so no separate API key is required.
 */
export class SdkSessionSummarizer implements SessionSummarizerPort {
  constructor(
    private readonly logger: LoggerPort,
    private readonly model: string = process.env['FLEEX_SESSION_SUMMARY_MODEL'] ?? DEFAULT_MODEL,
  ) {}

  async summarize(params: {
    conversationText: string;
    ticketTitle: string | null;
    cwd?: string | null;
  }): Promise<string | null> {
    const text = params.conversationText.trim();
    if (!text) return null;

    const prompt = [
      params.ticketTitle ? `Ticket: ${params.ticketTitle}\n` : '',
      'Session transcript (most recent activity):\n',
      text,
    ].join('');

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const options = buildSdkOptions('talk', {
        model: this.model,
        systemPrompt: SYSTEM_PROMPT,
        cwd: params.cwd ?? null,
      });

      let result = '';
      for await (const message of query({
        prompt,
        options: options as Parameters<typeof query>[0]['options'],
      })) {
        if ('result' in message) {
          result = (message as { result: string }).result;
        }
      }

      const trimmed = result.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (err) {
      this.logger.warn('Session summarization failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
