/**
 * The assistant asked the user to change the agents' execution mode (talk /
 * plan / edit). Changing it is the user's decision, so the card carries the real
 * action: the grant button patches the ticket's conversation mode, then tells the
 * assistant so it relaunches the agent. Nothing happens until the click.
 */
import { useState } from 'react';
import type { TicketComment } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { MessageMarkdown } from './MessageMarkdown';
import { stripModeRequest, type ModeRequest } from '../selectors';

const MODE_LABEL: Record<ModeRequest['mode'], string> = {
  talk: 'Talk (no tools)',
  plan: 'Plan (read-only)',
  edit: 'Edit (Write / Edit / Bash)',
};

interface Props {
  comment: TicketComment;
  request: ModeRequest;
  /** The ticket's current mode; when it already matches, the request is shown as granted. */
  currentMode: string;
  /** Only the latest request is actionable; older ones render as history. */
  actionable: boolean;
  onGrant: (request: ModeRequest) => void | Promise<void>;
  onDecline: (request: ModeRequest) => void | Promise<void>;
}

export function ModeRequestCard({ comment, request, currentMode, actionable, onGrant, onDecline }: Props) {
  const [busy, setBusy] = useState<'grant' | 'decline' | null>(null);
  const granted = currentMode === request.mode;
  const showButtons = actionable && !granted && busy === null;

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent-muted)] text-[12px] text-[var(--theme-accent)]" aria-hidden>◆</div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)]">{comment.authorName || 'Assistant'}</div>
        <div
          className={cn(
            'rounded-xl border px-3 py-2',
            granted || !actionable
              ? 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)]'
              : 'border-[var(--tint-yellow-border)] bg-[var(--tint-yellow-bg)]',
          )}
        >
          <div className="mb-1 text-[10px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">
            EXECUTION MODE REQUEST · {MODE_LABEL[request.mode]}
          </div>
          <div className="min-w-0 text-[13px] text-[var(--theme-text-primary)]">
            <MessageMarkdown body={stripModeRequest(comment.body)} />
          </div>
          {granted ? (
            <div className="mt-2 text-[11.5px] text-[var(--tint-green-text)]">Agents now run in {request.mode} mode.</div>
          ) : showButtons ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={async () => { setBusy('grant'); try { await onGrant(request); } finally { setBusy(null); } }}
                className="rounded-md border border-[var(--theme-accent)] bg-[var(--theme-accent)] px-2.5 py-1 text-[12px] text-[var(--theme-accent-fg)] hover:opacity-90"
              >
                Switch agents to {request.mode} and continue
              </button>
              <button
                type="button"
                onClick={async () => { setBusy('decline'); try { await onDecline(request); } finally { setBusy(null); } }}
                className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2.5 py-1 text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
              >
                Keep {currentMode}
              </button>
            </div>
          ) : busy ? (
            <div className="mt-2 text-[11.5px] text-[var(--theme-text-muted)]">{busy === 'grant' ? 'Switching…' : 'Answering…'}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
