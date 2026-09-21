import { parseSlackMessageUrl } from '../slack.js';
import type { ImportSourceDescriptor, SourceMatch } from './types.js';

/**
 * Detect a Slack message permalink. Delegates to {@link parseSlackMessageUrl}
 * (the single source of truth for the `p<digits>` → `ts` decoding and the
 * thread_ts handling), then shapes the result into a {@link SourceMatch}. The
 * ref is `channelId/ts` — the exact key existing tickets are indexed by.
 */
function detect(input: string): SourceMatch | null {
  const parsed = parseSlackMessageUrl(input);
  if (!parsed) return null;

  const { channelId, ts, threadTs, workspace, url } = parsed;
  const params: Record<string, string> = { channelId, ts, workspace };
  if (threadTs) params.threadTs = threadTs;

  return {
    sourceId: 'slack_message',
    ref: `${channelId}/${ts}`,
    // The whole (trimmed) URL is kept: its `thread_ts` query param decides
    // whether we synthesize a reply or the message alone.
    url,
    label: threadTs ? 'Slack thread' : 'Slack message',
    display: `#${channelId} · ${threadTs ? 'thread' : 'message'}`,
    params,
  };
}

export const slackMessageSource: ImportSourceDescriptor = {
  id: 'slack_message',
  name: 'Slack message',
  resolution: 'slow',
  detect,
};
