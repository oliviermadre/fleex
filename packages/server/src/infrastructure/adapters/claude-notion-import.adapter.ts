import type { ParsedNotionUrl } from '@fleex/shared';
import type { NotionImportPort, NotionImportResult } from '../../application/ports/notion-import.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SdkConcurrencyLimiter } from '../../application/services/sdk-concurrency-limiter.js';

/**
 * Model used for the Notion synthesis. Haiku is fast and more than capable of the
 * read-page-then-summarize task; speed matters here because the import is on the
 * critical path of the user seeing their ticket fill in.
 */
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Upper bound on agentic turns. Reading a page + a few child blocks needs only a
 * couple of tool round-trips; 10 leaves headroom for a paginated page while still
 * guarding against runaway loops (and keeping latency low).
 */
const MAX_TURNS = 10;

const SYSTEM_PROMPT = `You read a Notion page through the user's connected Notion integration and write a faithful synthesis. Optimize for SPEED: use the fewest tool calls possible.

Input: a Notion page URL (and its page id).

Steps:
1. Fetch the page content in as FEW tool calls as possible (use the Notion fetch tool with the given URL or page id). Read the page body and its inline / child blocks. Do NOT recursively crawl every linked sub-page — only mention that sub-pages exist and summarize their titles if relevant. Do NOT explore unrelated pages.
2. Write a faithful, well-structured Markdown synthesis: purpose, key points, decisions, open questions, action items. Preserve structure (headings / lists) when meaningful. No padding.
3. Derive a short descriptive title (max ~80 chars, no trailing period) — prefer the Notion page title when it is meaningful.

RULES:
- NEVER invent or hallucinate. Only report what you actually read.
- If NO Notion tool is available (integration not connected), return status "integration_unavailable".
- If the page can't be read (private/forbidden, deleted, not found), return status "inaccessible" with a brief "detail".
- If reached but there is nothing useful to summarize, return status "empty".
- Otherwise return status "ok" with both "title" and "synthesis".
- Output ONLY via the structured output schema.`;

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

interface NotionSynthesisStructuredOutput {
  status?: string;
  title?: string;
  synthesis?: string;
  detail?: string;
}

/**
 * {@link NotionImportPort} implementation backed by Claude's Agent SDK.
 *
 * It loads the user's native integrations via `settingSources: ['user']` so the
 * connected Notion MCP tools become available, and lets the agent call them
 * (`bypassPermissions`) since the exact Notion tool names are not known ahead of
 * time. Fleex itself never authenticates to Notion and only ever sees the
 * synthesized result — raw Notion content is never persisted.
 */
export class ClaudeNotionImportAdapter implements NotionImportPort {
  constructor(
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly logger: LoggerPort,
  ) {}

  async synthesizePage(parsed: ParsedNotionUrl): Promise<NotionImportResult> {
    const userPrompt = this.buildPrompt(parsed);

    const release = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const cliPath = process.env['CLAUDE_CLI_PATH'];

      let structuredOutput: NotionSynthesisStructuredOutput | null = null;
      let resultText = '';

      const options: Record<string, unknown> = {
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        // Load the user's native integrations (incl. the connected Notion MCP).
        settingSources: ['user'],
        // The exact Notion tool names are not known ahead of time, so we cannot
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
            structuredOutput = msg['structured_output'] as NotionSynthesisStructuredOutput;
          }
        }
      }

      return this.interpret(structuredOutput, resultText, parsed);
    } catch (err) {
      this.logger.error('Claude Agent SDK call failed for Notion import', {
        pageId: parsed.pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Treat an SDK-level failure as the page being unreadable rather than
      // fabricating content.
      return { status: 'inaccessible', detail: 'Claude Agent SDK call failed' };
    } finally {
      release();
    }
  }

  private interpret(
    structured: NotionSynthesisStructuredOutput | null,
    resultText: string,
    parsed: ParsedNotionUrl,
  ): NotionImportResult {
    if (!structured || typeof structured.status !== 'string') {
      this.logger.warn('Notion import returned no structured output', {
        pageId: parsed.pageId,
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
        this.logger.warn('Notion import returned unknown status', {
          status: structured.status,
          pageId: parsed.pageId,
        });
        return { status: 'inaccessible', detail: `Unknown synthesis status: ${structured.status}` };
    }
  }

  private buildPrompt(parsed: ParsedNotionUrl): string {
    const lines: string[] = [];
    lines.push('Retrieve and synthesize the following Notion page.');
    lines.push('');
    lines.push(`- URL: ${parsed.url}`);
    lines.push(`- Page id: ${parsed.pageId}`);
    if (parsed.workspace) {
      lines.push(`- Workspace: ${parsed.workspace}`);
    }
    if (parsed.isDatabaseView) {
      lines.push(
        '  This link points to a database view — summarize the database\'s purpose and the items it lists, not each row in detail.',
      );
    }
    lines.push('');
    lines.push('Return the result strictly via the structured output schema.');
    return lines.join('\n');
  }
}
