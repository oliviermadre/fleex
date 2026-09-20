import { parseSlackMessageUrl, type ResolvedImport, type SourceMatch } from '@fleex/shared';
import { ImportError } from '../../../domain/errors.js';
import type { LoggerPort } from '../../ports/logger.port.js';
import type { SlackImportPort } from '../../ports/slack-import.port.js';
import type { ImportSourceAdapter } from '../../ports/import-source.port.js';
import { buildSlackDescription, slackResultToImportError } from './slack-description.js';

/**
 * Resolves a Slack message/thread into a draft — synchronously, in the resolving
 * screen (this is the slow source). Delegates the actual read/synthesis to the
 * {@link SlackImportPort} (Claude's native Slack integration) and forwards the
 * abort signal so a cancelled preview stops the read.
 */
export class SlackMessageImportAdapter implements ImportSourceAdapter {
  readonly id = 'slack_message' as const;

  constructor(
    private readonly slackImport: SlackImportPort,
    private readonly logger: LoggerPort,
  ) {}

  async resolve(match: SourceMatch, opts?: { signal?: AbortSignal }): Promise<ResolvedImport> {
    // Rebuild the parsed URL from the canonical URL — the single source of truth
    // for the p<digits> → ts decoding and thread_ts handling lives in @fleex/shared.
    const parsed = parseSlackMessageUrl(match.url);
    if (!parsed) {
      throw new ImportError('Not a valid Slack message link', 'IMPORT_INVALID_INPUT', 'slack_message');
    }

    const result = await this.slackImport.synthesizeThread(parsed, opts);
    if (result.status !== 'ok') {
      this.logger.info('Slack import resolution not ok', { channelId: parsed.channelId, status: result.status });
      throw slackResultToImportError(result);
    }

    return {
      title: result.title,
      description: buildSlackDescription(result.synthesis, match.url),
      tags: [],
      links: [{ type: 'slack_message', ref: match.ref, label: match.label, url: match.url }],
    };
  }
}
