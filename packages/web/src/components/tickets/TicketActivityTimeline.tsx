import { useState, useEffect } from 'react';

import type { TicketActivity } from '@fleex/shared';

import * as api from '../../services/api';

function describeActivity(a: TicketActivity): string {
  switch (a.action) {
    case 'created':
      return a.source === 'api' ? 'Created via API' : 'Created';
    case 'moved': {
      const from = a.changes['status']?.from;
      const to = a.changes['status']?.to;
      return from && to ? `Moved from ${from} to ${to}` : 'Moved';
    }
    case 'updated': {
      const fields = Object.keys(a.changes);
      return `Updated ${fields.join(', ')}`;
    }
    case 'linked':
      return 'Link added';
    case 'unlinked':
      return 'Link removed';
    case 'assigned': {
      const to = a.changes['assignee']?.to;
      return to ? `Assigned to ${to}` : 'Unassigned';
    }
    default:
      return a.action;
  }
}

export function TicketActivityTimeline({ ticketId }: { ticketId: string }) {
  const [activities, setActivities] = useState<TicketActivity[]>([]);

  useEffect(() => {
    api
      .fetchTicketActivity(ticketId)
      .then(setActivities)
      .catch(() => {});
  }, [ticketId]);

  if (activities.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[var(--theme-text-muted)]">No activity yet</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-2">
        {activities.slice(0, 50).map((a) => (
          <div key={a.id} className="flex items-start gap-2 text-xs">
            <div className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--theme-text-muted)]" />
            <div className="flex-1">
              <span className="text-[var(--theme-text-secondary)]">{describeActivity(a)}</span>
              {a.actorName && (
                <span className="ml-1 text-[var(--theme-text-muted)]">by {a.actorName}</span>
              )}
            </div>
            <span className="flex-shrink-0 text-[var(--theme-text-faint)]">
              {new Date(a.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
