import type { NotificationRendererRegistry } from './registry';
import type {
  PulseNotification,
  RendererContext,
  WsChannelMessage,
} from './types';

/**
 * Translate a raw WS channel message into a `PulseNotification`, or `null` when
 * the event is not actionable (no renderer, or the renderer opts out).
 *
 * Renderer failures are isolated: a throwing or malformed renderer yields
 * `null` and never breaks the stream of other notifications.
 */
export function toNotification(
  msg: WsChannelMessage,
  registry: NotificationRendererRegistry,
  ctx: RendererContext,
  now: () => string = () => new Date().toISOString(),
): PulseNotification | null {
  const renderer = registry.get(msg.type);
  if (!renderer) return null;

  let draft;
  try {
    draft = renderer(msg.data, ctx);
  } catch {
    return null;
  }
  if (!draft) return null;

  return {
    id: draft.dedupKey,
    emoji: draft.emoji,
    title: draft.title,
    body: draft.body,
    level: draft.level,
    link: draft.link,
    createdAt: now(),
    seen: false,
  };
}
