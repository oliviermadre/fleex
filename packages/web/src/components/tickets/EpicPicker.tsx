import { useEffect, useMemo } from 'react';
import type { TicketGroup } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';

/**
 * Picker for assigning/removing a ticket from epics.
 * Follows the same visual pattern as RepoWorktreePicker in TicketMetaSidebar.
 */
export function EpicPicker({ ticketId }: { ticketId: string }) {
  const groups = useTicketGroupStore((s) => s.groups);
  const ticketGroupIds = useTicketGroupStore((s) => s.ticketGroupIds);
  const addTicketToGroup = useTicketGroupStore((s) => s.addTicketToGroup);
  const removeTicketFromGroup = useTicketGroupStore((s) => s.removeTicketFromGroup);
  const fetchGroups = useTicketGroupStore((s) => s.fetchGroups);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);

  useEffect(() => {
    if (groups.length === 0) fetchGroups(selectedBoardId ?? undefined);
  }, [groups.length, fetchGroups, selectedBoardId]);

  // Load this ticket's group memberships if not cached
  const fetchMemberships = useTicketGroupStore((s) => s.fetchTicketMemberships);
  useEffect(() => {
    if (!ticketGroupIds[ticketId]) {
      fetchMemberships(ticketId);
    }
  }, [ticketId, ticketGroupIds, fetchMemberships]);

  const assignedGroupIds = ticketGroupIds[ticketId] ?? [];

  const assignedGroups = useMemo(
    () => groups.filter((g) => assignedGroupIds.includes(g.id)),
    [groups, assignedGroupIds],
  );

  const availableGroups = useMemo(
    () => groups.filter((g) => g.groupStatus !== 'archived' && !assignedGroupIds.includes(g.id)),
    [groups, assignedGroupIds],
  );

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Epics
      </label>
      {/* Assigned epics */}
      {assignedGroups.length > 0 && (
        <div className="mb-1.5 space-y-1">
          {assignedGroups.map((group) => (
            <div key={group.id} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1">
                <span className="flex-shrink-0 text-xs">{group.emoji}</span>
                <span className="truncate text-xs text-[var(--theme-text-secondary)]">{group.name}</span>
              </div>
              <button
                className="rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)]"
                onClick={() => removeTicketFromGroup(group.id, ticketId)}
                title="Remove from epic"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Add to epic */}
      {availableGroups.length > 0 && (
        <select
          className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
          value=""
          onChange={async (e) => {
            const groupId = e.target.value;
            if (groupId) {
              await addTicketToGroup(groupId, ticketId);
            }
          }}
        >
          <option value="" disabled>+ Add to epic...</option>
          {availableGroups.map((g) => (
            <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>
          ))}
        </select>
      )}
      {groups.length === 0 && (
        <span className="text-[10px] text-[var(--theme-text-muted)]">No epics yet</span>
      )}
    </div>
  );
}
