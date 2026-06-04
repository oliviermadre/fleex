import type { ParsedSlackMessageUrl } from '@fleex/shared';
import type { SlackImportPort, SlackImportResult } from '../../application/ports/slack-import.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SdkConcurrencyLimiter } from '../../application/services/sdk-concurrency-limiter.js';

/**
 * Model used for the Slack synthesis. Needs tool use (to drive the native Slack
 * integration) plus solid summarization, hence a Sonnet-class model rather than
 * the Haiku used for offline ticket summaries.
 */
const MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Upper bound on agentic turns. The agent typically needs a couple of tool
 * round-trips (read the message, read the thread) before producing the
 * synthesis; this guards against runaway loops.
 */
const MAX_TURNS = 20;

const SYSTEM_PROMPT = `You retrieve a Slack conversation through the user's connected Slack integration and write a faithful synthesis of it.

You will be given a Slack message permalink (channel id + message timestamp, and possibly a parent thread timestamp). Your job:

1. Use the available Slack tools to read the target message. If it is the root of a thread, read ALL replies in that thread. If a parent thread timestamp is provided, read the full parent thread.
2. Produce a faithful, well-structured Markdown synthesis of the conversation: what is being discussed, the key points, decisions, questions, and any concrete action items or requests. Preserve who said what when it matters. Do not pad.
3. Derive a short, descriptive title (max ~80 chars, no trailing period) that captures the subject. Slack messages have no title, so infer it from the content.

ABSOLUTE RULES:
- NEVER invent, assume, or hallucinate content. Only report what you actually read from Slack.
- If NO Slack tool is available to you (the integration is not connected), return status "integration_unavailable" and nothing else.
- If the conversation cannot be read (private/forbidden channel, deleted message, not found), return status "inaccessible" with a brief "detail".
- If you reach the message/thread but there is no useful content to summarize, return status "empty".
- Otherwise return status "ok" with both "title" and "synthesis" filled.
- Output ONLY via the structured output schema. Do not write conversational prose outside it.`;

const OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['ok', 'integration_unavailable', 'inaccessible', 'empty'],
      },
      title: { type: 'string' },
      synthesis: { type: 'string' },
      detail: { type: 'string' },
    },
    required: ['status'],
  },
};

interface SlackSynthesisStructuredOutput {
  status?: string;
  title?: string;
  synthesis?: string;
  detail?: string;
}

/**
 * {@link SlackImportPort} implementation backed by Claude's Agent SDK.
 *
 * It loads the user's native integrations via `settingSources: ['user']` so the
 * connected Slack MCP tools become available, and lets the agent call them
 * (`bypassPermissions`) since the exact Slack tool names are not known ahead of
 * time. Fleex itself never authenticates to Slack and only ever sees the
 * synthesized result — raw Slack content is never persisted.
 */
export class ClaudeSlackImportAdapter implements SlackImportPort {
  constructor(
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly logger: LoggerPort,
  ) {}

  async synthesizeThread(parsed: ParsedSlackMessageUrl): Promise<SlackImportResult> {
    const userPrompt = this.buildPrompt(parsed);

    const release = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const cliPath = process.env['CLAUDE_CLI_PATH'];

      let structuredOutput: SlackSynthesisStructuredOutput | null = null;
      let resultText = '';

      const options: Record<string, unknown> = {
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        // Load the user's native integrations (incl. the connected Slack MCP).
        settingSources: ['user'],
        // The exact Slack tool names are not known ahead of time, so we cannot
        // enumerate allowedTools; bypass the prompt for this trusted one-shot.
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: MAX_TURNS,
        outputFormat: OUTPUT_FORMAT,
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      };

      for await (const message of query({
        prompt: userPrompt,
        options: options as Parameters<typeof query>[0]['options'],
      })) {
        const msg = message as Record<string, unknown>;
        if ('result' in message) {
          resultText = (message as { result: string }).result;
          if (msg['structured_output']) {
            structuredOutput = msg['structured_output'] as SlackSynthesisStructuredOutput;
          }
        }
      }

      return this.interpret(structuredOutput, resultText, parsed);
    } catch (err) {
      this.logger.error('Claude Agent SDK call failed for Slack import', {
        channelId: parsed.channelId,
        ts: parsed.ts,
        error: err instanceof Error ? err.message : String(err),
      });
      // Treat an SDK-level failure as the conversation being unreadable rather
      // than fabricating content.
      return { status: 'inaccessible', detail: 'Claude Agent SDK call failed' };
    } finally {
      release();
    }
  }

  private interpret(
    structured: SlackSynthesisStructuredOutput | null,
    resultText: string,
    parsed: ParsedSlackMessageUrl,
  ): SlackImportResult {
    if (!structured || typeof structured.status !== 'string') {
      this.logger.warn('Slack import returned no structured output', {
        channelId: parsed.channelId,
        ts: parsed.ts,
        hasText: resultText.length > 0,
      });
      return { status: 'inaccessible', detail: 'No structured response from synthesis' };
    }

    switch (structured.status) {
      case 'ok': {
        const synthesis = (structured.synthesis ?? '').trim();
        const title = (structured.title ?? '').trim();
        if (!synthesis || !title) {
          return { status: 'empty' };
        }
        return { status: 'ok', title, synthesis };
      }
      case 'integration_unavailable':
        return { status: 'integration_unavailable' };
      case 'inaccessible':
        return { status: 'inaccessible', detail: structured.detail?.trim() || undefined };
      case 'empty':
        return { status: 'empty' };
      default:
        this.logger.warn('Slack import returned unknown status', {
          status: structured.status,
          channelId: parsed.channelId,
        });
        return { status: 'inaccessible', detail: `Unknown synthesis status: ${structured.status}` };
    }
  }

  private buildPrompt(parsed: ParsedSlackMessageUrl): string {
    const lines: string[] = [];
    lines.push('Retrieve and synthesize the following Slack conversation.');
    lines.push('');
    lines.push(`- Permalink: ${parsed.url}`);
    lines.push(`- Workspace: ${parsed.workspace}`);
    lines.push(`- Channel id: ${parsed.channelId}`);
    lines.push(`- Message timestamp (ts): ${parsed.ts}`);
    if (parsed.threadTs) {
      lines.push(`- Parent thread timestamp (thread_ts): ${parsed.threadTs}`);
      lines.push('  This link points to a reply inside a thread — read the whole thread.');
    } else {
      lines.push('  If this message starts a thread, read all of its replies too.');
    }
    lines.push('');
    lines.push('Return the result strictly via the structured output schema.');
    return lines.join('\n');
  }
}
