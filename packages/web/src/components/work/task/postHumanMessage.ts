/**
 * Where a message typed by the human in a ticket composer goes — one rule for
 * every surface (Tasks view, Focus popup, mobile).
 *
 * « Assistant & threads » on: the message goes to the assistant
 * (`POST /tickets/:id/assistant/messages`). A `@type:slug` in it is then an
 * order for the assistant to delegate in a thread, not a direct mention. When
 * the server reports no assistant persona, it falls back to a plain comment.
 *
 * Switch off: a plain comment, mentions launched directly — unchanged.
 */
import type { TicketComment } from '@fleex/shared';
import * as api from '../../../services/api';
import { useSettingsStore } from '../../../stores/settingsStore';

export interface HumanMessageResult {
  comment: TicketComment;
  /** The assistant received it (and answers in the stream). */
  viaAssistant: boolean;
  /** The switch is on but no assistant persona is configured: posted as a plain comment. */
  assistantMissing: boolean;
}

export function assistantRouteEnabled(): boolean {
  return useSettingsStore.getState().settings.workThreadsEnabled === true;
}

export async function postHumanMessage(
  ticketId: string,
  body: string,
  /** Only used on the plain-comment path: how re-mentions of busy / waiting agents were disambiguated. */
  mentionConflicts?: api.MentionConflictResolution[],
): Promise<HumanMessageResult> {
  const plain = () => (mentionConflicts?.length
    ? api.postTicketComment(ticketId, body, undefined, mentionConflicts)
    : api.postTicketComment(ticketId, body));
  if (assistantRouteEnabled()) {
    const res = await api.postAssistantMessage(ticketId, body);
    if (res.assistant !== null && res.comment) return { comment: res.comment, viaAssistant: true, assistantMissing: false };
    return { comment: await plain(), viaAssistant: false, assistantMissing: true };
  }
  return { comment: await plain(), viaAssistant: false, assistantMissing: false };
}
