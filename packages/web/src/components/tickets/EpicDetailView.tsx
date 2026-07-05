import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TicketGroup, Ticket, TicketStatus } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import type { DomainEventLog } from '@fleex/shared';
import type { BoardWithCounts } from '@fleex/shared';
import { useTicketGroupStore } from '../../stores/ticketGroupStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { fetchEvents } from '../../services/api';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { EpicProgressBar } from './EpicProgressBar';
import { NanoRoadmap } from './NanoRoadmap';
import { PriorityIndicator } from './PriorityIndicator';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { STATUS_COLORS } from '../../lib/statusColors';
import { formatRelativeTime } from '../../lib/relativeTime';

export function EpicDetailView() {
  const epicId = useTicketGroupStore((s) => s.selectedEpicDetailId);
  const groups = useTicketGroupStore((s) => s.groups);
  const updateGroup = useTicketGroupStore((s) => s.updateGroup);
  const deleteGroup = useTicketGroupStore((s) => s.deleteGroup);
  const archiveGroup = useTicketGroupStore((s) => s.archiveGroup);
  const unarchiveGroup = useTicketGroupStore((s) => s.unarchiveGroup);
  const setSelectedEpicDetail = useTicketGroupStore((s) => s.setSelectedEpicDetail);
  const activeTab = useTicketGroupStore((s) => s.epicDetailTab);
  const setActiveTab = useTicketGroupStore((s) => s.setEpicDetailTab);
  const fetchGroupTickets = useTicketGroupStore((s) => s.fetchGroupTickets);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const addBoardToGroup = useTicketGroupStore((s) => s.addBoardToGroup);
  const removeBoardFromGroup = useTicketGroupStore((s) => s.removeBoardFromGroup);
  const allTickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);

  const group = groups.find((g) => g.id === epicId) ?? null;

  useEffect(() => {
    if (epicId && !groupTicketIds[epicId]) {
      fetchGroupTickets(epicId);
    }
  }, [epicId, groupTicketIds, fetchGroupTickets]);

  const ticketMap = useMemo(() => new Map(allTickets.map((t) => [t.id, t])), [allTickets]);
  const epicTickets = useMemo(() => {
    if (!epicId) return [];
    const ids = groupTicketIds[epicId] ?? [];
    return ids.map((id) => ticketMap.get(id)).filter(Boolean) as Ticket[];
  }, [epicId, groupTicketIds, ticketMap]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const handleBack = useCallback(() => setSelectedEpicDetail(null), [setSelectedEpicDetail]);

  if (!group) return null;

  const handleRoadmapChange = async (newStatus: 'active' | 'done' | 'cancelled' | 'archived', newTimeframe: 'now' | 'next' | 'later') => {
    await updateGroup(group.id, { groupStatus: newStatus, timeframe: newTimeframe });
  };

  const handleDelete = async () => {
    if (!confirm(`Delete epic "${group.name}"? Tickets will not be deleted.`)) return;
    await deleteGroup(group.id);
    setSelectedEpicDetail(null);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
          onClick={handleBack}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="10,3 5,8 10,13" />
          </svg>
          Back
        </button>
        <EditableEmoji value={group.emoji} onSave={(emoji) => updateGroup(group.id, { emoji })} />
        <EditableName value={group.name} onSave={(name) => updateGroup(group.id, { name })} />
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[var(--theme-border)]">
            {(['description', 'tickets', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                className={cn(
                  'border-b-2 px-4 py-2 text-xs font-medium transition-colors',
                  activeTab === tab
                    ? 'border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                    : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'tickets' && ` (${epicTickets.length})`}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab === 'description' && (
              <EpicDescriptionEditor
                groupId={group.id}
                description={group.description}
              />
            )}

            {activeTab === 'tickets' && (
              <TicketsTab epicId={epicId!} boardIds={group.boardIds} epicTickets={epicTickets} />
            )}

            {activeTab === 'deliverables' && (
              <div className="flex items-center justify-center p-8 text-xs text-[var(--theme-text-muted)]">
                Deliverables will appear here.
              </div>
            )}

            {activeTab === 'activity' && (
              <EpicActivityLog groupId={epicId!} />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className={cn('flex flex-shrink-0 flex-col border-l border-[var(--theme-border)]', sidebarCollapsed ? 'w-10' : 'w-[280px]')}>
          {/* Toggle button */}
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="flex w-full shrink-0 items-center justify-center border-b border-[var(--theme-border)] py-2 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="10" y1="1.5" x2="10" y2="14.5" />
            </svg>
          </button>

          {/* Sidebar content */}
          {!sidebarCollapsed && (
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              {/* Status (NanoRoadmap) */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Status</label>
                <NanoRoadmap
                  groupStatus={group.groupStatus}
                  timeframe={group.timeframe}
                  onChange={handleRoadmapChange}
                />
              </div>

              {/* Progress */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Progress</label>
                <EpicProgressBar tickets={epicTickets} />
              </div>

              {/* Boards */}
              {group && (
                <EpicBoardsPicker
                  group={group}
                  boards={boards}
                  onAdd={(boardId) => addBoardToGroup(group.id, boardId)}
                  onRemove={(boardId) => removeBoardFromGroup(group.id, boardId)}
                />
              )}

              {/* Actions */}
              <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-[var(--theme-border)]">
                {/* Archive / Unarchive */}
                {(group.groupStatus === 'done' || group.groupStatus === 'cancelled') && (
                  <button
                    className="w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                    onClick={() => archiveGroup(group.id)}
                  >
                    Archive
                  </button>
                )}
                {group.groupStatus === 'archived' && (
                  <button
                    className="w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                    onClick={() => unarchiveGroup(group.id)}
                  >
                    Unarchive
                  </button>
                )}

                {/* Delete */}
                <button
                  className={cn('w-full rounded-md border border-[var(--theme-danger)]/30 px-3 py-1.5 text-xs text-[var(--theme-danger)] transition-colors', tintClasses('red').hoverBg)}
                  onClick={handleDelete}
                >
                  Delete Epic
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity Log ──

const EVENT_LABELS: Record<string, string> = {
  'ticketGroup.created': 'Epic created',
  'ticketGroup.updated': 'Epic updated',
  'ticketGroup.deleted': 'Epic deleted',
  'ticketGroup.memberAdded': 'Ticket added to epic',
  'ticketGroup.memberRemoved': 'Ticket removed from epic',
  'ticketRelationship.created': 'Ticket relationship created',
  'ticketRelationship.deleted': 'Ticket relationship removed',
};

function EpicActivityLog({ groupId }: { groupId: string }) {
  const [events, setEvents] = useState<DomainEventLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch both ticketGroup.* and ticketRelationship.* events, then filter client-side by groupId
    Promise.all([
      fetchEvents({ eventType: 'ticketGroup.', limit: 200 }),
      fetchEvents({ eventType: 'ticketRelationship.', limit: 200 }),
    ]).then(([groupEvents, relEvents]) => {
      const all = [...groupEvents, ...relEvents]
        .filter((e) => e.payload.groupId === groupId || e.payload.parentId === groupId)
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      setEvents(all);
    }).finally(() => setLoading(false));
  }, [groupId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-xs text-[var(--theme-text-muted)]">
        Loading activity...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-xs text-[var(--theme-text-muted)]">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto epic-picker-scroll">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 border-b border-[var(--theme-border)] px-4 py-3">
          <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--theme-accent)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[var(--theme-text-primary)]">
              {EVENT_LABELS[event.eventType] ?? event.eventType}
            </div>
            {event.payload['changes'] != null && typeof event.payload['changes'] === 'object' && (
              <div className="mt-0.5 text-xs text-[var(--theme-text-muted)]">
                {Object.keys(event.payload['changes'] as Record<string, unknown>).join(', ')}
              </div>
            )}
            {event.payload['ticketId'] != null && (
              <div className="mt-0.5 text-xs text-[var(--theme-text-muted)]">
                Ticket: {String(event.payload['ticketId']).slice(0, 8)}...
              </div>
            )}
          </div>
          <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">
            {formatRelativeTime(event.occurredAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Tickets Tab ──

const COLUMN_TITLE_COLOR: Record<string, string> = {
  backlog: STATUS_COLORS.backlog!.text,
  todo: STATUS_COLORS.todo!.text,
  doing: STATUS_COLORS.doing!.text,
  reviewing: STATUS_COLORS.reviewing!.text,
  done: STATUS_COLORS.done!.text,
  cancelled: STATUS_COLORS.cancelled!.text,
};

// ── Editable Name / Emoji ──

function EditableName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        className="text-sm font-semibold text-[var(--theme-text-primary)] hover:text-[var(--theme-accent)] transition-colors"
        onClick={() => setEditing(true)}
        title="Click to rename"
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="rounded border border-[var(--theme-accent)] bg-transparent px-1 py-0.5 text-sm font-semibold text-[var(--theme-text-primary)] focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      onBlur={commit}
    />
  );
}

function EditableEmoji({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        className="text-lg hover:scale-125 transition-transform"
        onClick={() => setEditing(true)}
        title="Click to change emoji"
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="w-10 rounded border border-[var(--theme-accent)] bg-transparent px-1 py-0.5 text-center text-lg focus:outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      onBlur={commit}
    />
  );
}

// ── Description Editor ──

function EpicDescriptionEditor({ groupId, description }: { groupId: string; description: string }) {
  const updateGroup = useTicketGroupStore((s) => s.updateGroup);
  const [text, setText] = useState(description);
  const textRef = useRef(description);
  const [mode, setMode] = useState<'write' | 'preview' | 'split'>('split');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(description); textRef.current = description; }, [description]);

  const flushDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      updateGroup(groupId, { description: textRef.current });
    }
  }, [groupId, updateGroup]);

  const handleChange = useCallback((value: string) => {
    setText(value);
    textRef.current = value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      updateGroup(groupId, { description: value });
    }, 600);
  }, [groupId, updateGroup]);

  useEffect(() => () => { clearTimeout(debounceRef.current); }, []);

  const fileUpload = useFileUpload({
    textareaRef,
    value: text,
    onChange: handleChange,
    onFlushDebounce: flushDebounce,
  });

  const handleToggleCheckbox = useCallback((lineIndex: number) => {
    const lines = textRef.current.split('\n');
    const line = lines[lineIndex];
    if (!line) return;
    if (line.includes('[ ]')) {
      lines[lineIndex] = line.replace('[ ]', '[x]');
    } else if (/\[[xX]\]/.test(line)) {
      lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]');
    }
    const next = lines.join('\n');
    handleChange(next);
  }, [handleChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Mode toggle */}
      <div className="flex items-center gap-0.5 border-b border-[var(--theme-border)] px-4 py-1">
        {(['write', 'preview', 'split'] as const).map((m) => (
          <button
            key={m}
            className={cn(
              'px-2 py-1 text-[11px] transition-colors',
              mode === m
                ? 'text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-text-muted)]',
            )}
            onClick={() => setMode(m)}
          >
            {m === 'write' ? 'Write' : m === 'preview' ? 'Preview' : 'Split'}
          </button>
        ))}
      </div>

      {/* Editor / Preview */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        {mode !== 'preview' && (
          <div
            className={cn('relative', mode === 'split' ? 'w-1/2' : 'w-full')}
            {...fileUpload.dragProps}
          >
            <textarea
              ref={textareaRef}
              className={cn(
                'h-full w-full resize-none rounded-md border bg-[var(--theme-bg-surface)] p-3 text-sm font-mono text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none',
                fileUpload.isDragOver
                  ? 'border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/30'
                  : 'border-[var(--theme-border)]',
              )}
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              onPaste={fileUpload.pasteHandler}
              placeholder="Add a description (markdown supported)..."
            />
            <button
              type="button"
              onClick={fileUpload.openFilePicker}
              className="absolute bottom-2 right-2 rounded p-1 text-[var(--theme-text-muted)] opacity-50 transition-opacity hover:text-[var(--theme-accent)] hover:opacity-100"
              title="Attach file"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            {fileUpload.isUploading && (
              <div className="absolute bottom-2 left-3 text-xs text-[var(--theme-text-muted)]">
                Uploading...
              </div>
            )}
          </div>
        )}
        {mode !== 'write' && (
          <div className={cn(
            'overflow-y-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3',
            mode === 'split' ? 'w-1/2' : 'w-full',
          )}>
            {text.trim() ? (
              <MarkdownRenderer content={text} onToggleCheckbox={handleToggleCheckbox} />
            ) : (
              <p className="text-sm italic text-[var(--theme-text-muted)]">Nothing to preview</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tickets Tab ──

function TicketsTab({ epicId, boardIds, epicTickets }: { epicId: string; boardIds: string[]; epicTickets: Ticket[] }) {
  const [showPicker, setShowPicker] = useState(false);
  const removeTicketFromGroup = useTicketGroupStore((s) => s.removeTicketFromGroup);
  const setSelectedEpicDetail = useTicketGroupStore((s) => s.setSelectedEpicDetail);
  const boards = useTicketStore((s) => s.boards);
  const navigate = useNavigate();

  const boardMap = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  const groupedByBoard = useMemo(() => {
    const sorted = [...epicTickets].sort((a, b) => {
      const statusDiff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      return a.title.localeCompare(b.title);
    });
    const groups: { boardId: string; boardLabel: string; tickets: Ticket[] }[] = [];
    const map = new Map<string, Ticket[]>();
    const order: string[] = [];
    for (const t of sorted) {
      if (!map.has(t.boardId)) {
        map.set(t.boardId, []);
        order.push(t.boardId);
      }
      map.get(t.boardId)!.push(t);
    }
    for (const bid of order) {
      const board = boardMap.get(bid);
      groups.push({
        boardId: bid,
        boardLabel: board ? `${board.emoji} ${board.name}` : bid,
        tickets: map.get(bid)!,
      });
    }
    return groups;
  }, [epicTickets, boardMap]);

  const handleClickTicket = (ticket: Ticket) => {
    setSelectedEpicDetail(null);
    navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Manage tickets button */}
      <div className="px-3 py-1.5">
        <button
          className="w-full rounded-md px-3 py-2 text-left text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setShowPicker(true)}
        >
          + Manage tickets
        </button>
      </div>

      {/* Ticket list grouped by board */}
      <div className="min-h-0 flex-1 overflow-y-auto epic-picker-scroll">
        {groupedByBoard.map((group) => (
          <div key={group.boardId}>
            {groupedByBoard.length > 1 && (
              <div className="sticky top-0 z-[1] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                {group.boardLabel}
              </div>
            )}
            {group.tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="group flex items-center border-b border-[var(--theme-border)] px-4 py-2 transition-colors hover:bg-[var(--theme-bg-hover)]"
              >
                <PriorityIndicator priority={ticket.priority} />
                <button
                  className="ml-2 min-w-0 flex-1 truncate text-left text-sm text-[var(--theme-text-primary)] transition-colors hover:text-[var(--theme-accent)]"
                  onClick={() => handleClickTicket(ticket)}
                  title={ticket.title}
                >
                  {ticket.title}
                </button>
                {groupedByBoard.length === 1 && (
                  <span className="ml-3 flex-shrink-0 truncate text-[10px] text-[var(--theme-text-muted)]">
                    {group.boardLabel}
                  </span>
                )}
                <span className={cn('ml-3 flex-shrink-0 text-xs font-medium', COLUMN_TITLE_COLOR[ticket.status])}>
                  {TICKET_STATUS_LABELS[ticket.status]}
                </span>
                <button
                  className="ml-3 flex-shrink-0 rounded p-0.5 text-[var(--theme-text-faint)] opacity-0 transition-opacity hover:text-[var(--theme-danger)] group-hover:opacity-100"
                  onClick={() => removeTicketFromGroup(epicId, ticket.id)}
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
        ))}
        {epicTickets.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--theme-text-muted)]">
            No tickets in this epic yet.
          </div>
        )}
      </div>

      {/* Ticket Picker Modal */}
      {showPicker && (
        <TicketPickerModal
          epicId={epicId}
          boardIds={boardIds}
          epicTicketIds={new Set(epicTickets.map((t) => t.id))}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ── Ticket Picker Modal ──

const STATUS_SORT_ORDER: Record<string, number> = {
  backlog: 0, todo: 1, doing: 2, reviewing: 3, done: 4, cancelled: 5,
};

function TicketPickerModal({ epicId, boardIds, epicTicketIds, onClose }: {
  epicId: string;
  boardIds: string[];
  epicTicketIds: Set<string>;
  onClose: () => void;
}) {
  const allTickets = useTicketStore((s) => s.tickets);
  const groups = useTicketGroupStore((s) => s.groups);
  const groupTicketIds = useTicketGroupStore((s) => s.groupTicketIds);
  const addTicketToGroup = useTicketGroupStore((s) => s.addTicketToGroup);
  const removeTicketFromGroup = useTicketGroupStore((s) => s.removeTicketFromGroup);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  // Filter by boards, unarchived, search; sort by status then title
  const boardTickets = useMemo(() => {
    const boardIdSet = new Set(boardIds);
    return allTickets
      .filter((t) => boardIdSet.has(t.boardId) && !t.archivedAt)
      .filter((t) => !search || t.title.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const statusDiff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return a.title.localeCompare(b.title);
      });
  }, [allTickets, boardIds, search]);

  const ticketEpicLabels = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) {
      const ids = groupTicketIds[g.id] ?? [];
      for (const id of ids) {
        if (!map[id]) map[id] = [];
        map[id].push(`${g.emoji} ${g.name}`);
      }
    }
    return map;
  }, [groups, groupTicketIds]);

  const handleToggle = async (ticketId: string) => {
    if (toggling.has(ticketId)) return;
    setToggling((s) => new Set([...s, ticketId]));
    try {
      if (epicTicketIds.has(ticketId)) {
        await removeTicketFromGroup(epicId, ticketId);
      } else {
        await addTicketToGroup(epicId, ticketId);
      }
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(ticketId); return n; });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--theme-border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Manage tickets</span>
          <div className="flex-1" />
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]">
              <circle cx="7" cy="7" r="5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input
              type="text"
              autoFocus
              className="h-8 w-64 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] pl-8 pr-3 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Column headers (fixed, not scrollable) */}
        <div className="flex flex-shrink-0 items-center border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          <span className="flex-1">Ticket</span>
          <span className="w-24 flex-shrink-0">Status</span>
          <span className="w-40 flex-shrink-0">Epics</span>
          <span className="w-16 flex-shrink-0 text-center">In epic</span>
        </div>

        {/* Scrollable rows */}
        <div className="min-h-0 flex-1 overflow-y-auto epic-picker-scroll">
          {boardTickets.map((ticket) => {
            const isIn = epicTicketIds.has(ticket.id);
            const isLoading = toggling.has(ticket.id);
            return (
              <div
                key={ticket.id}
                className="flex items-center border-b border-[var(--theme-border)] px-4 py-2 transition-colors hover:bg-[var(--theme-bg-hover)]"
              >
                {/* Ticket name */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <PriorityIndicator priority={ticket.priority} />
                  <span className="truncate text-sm text-[var(--theme-text-primary)]">{ticket.title}</span>
                </div>
                {/* Status */}
                <div className="w-24 flex-shrink-0">
                  <span className={cn('text-xs font-medium', COLUMN_TITLE_COLOR[ticket.status])}>
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </span>
                </div>
                {/* Epics */}
                <div className="flex w-40 flex-shrink-0 flex-wrap gap-1">
                  {(ticketEpicLabels[ticket.id] ?? []).map((label) => (
                    <span key={label} className="truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-secondary)]">
                      {label}
                    </span>
                  ))}
                </div>
                {/* Toggle */}
                <div className="flex w-16 flex-shrink-0 items-center justify-center">
                  <button
                    className={cn(
                      'relative h-5 w-9 rounded-full transition-colors',
                      isIn ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]',
                      isLoading && 'opacity-50',
                    )}
                    onClick={() => handleToggle(ticket.id)}
                    disabled={isLoading}
                  >
                    <span className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                      isIn ? 'left-[18px]' : 'left-0.5',
                    )} />
                  </button>
                </div>
              </div>
            );
          })}
          {boardTickets.length === 0 && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--theme-text-muted)]">
              No tickets found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Epic Boards Picker (sidebar) ──

function EpicBoardsPicker({
  group,
  boards,
  onAdd,
  onRemove,
}: {
  group: TicketGroup;
  boards: BoardWithCounts[];
  onAdd: (boardId: string) => void;
  onRemove: (boardId: string) => void;
}) {
  const { open: showDropdown, setOpen: setShowDropdown, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-start' });

  const associatedBoards = boards.filter((b) => group.boardIds.includes(b.id));
  const unassociatedBoards = boards.filter((b) => !group.boardIds.includes(b.id));

  return (
    <div className="mb-4">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Boards</label>
      <div className="space-y-1">
        {associatedBoards.map((board) => (
          <div key={board.id} className="group flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-[var(--theme-bg-hover)]">
            <span className="text-xs">{board.emoji}</span>
            <span className="flex-1 truncate text-xs text-[var(--theme-text-primary)]">{board.name}</span>
            {associatedBoards.length > 1 && (
              <button
                className="flex-shrink-0 rounded p-0.5 text-[var(--theme-text-faint)] opacity-0 transition-opacity hover:text-[var(--theme-danger)] group-hover:opacity-100"
                onClick={() => onRemove(board.id)}
                title="Remove board from epic"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      {unassociatedBoards.length > 0 && (
        <div className="relative mt-1">
          <button
            ref={refs.setReference}
            className="text-[10px] text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-accent)]"
            {...getReferenceProps()}
          >
            + Add board
          </button>
          {showDropdown && (
            <FloatingPortal>
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="z-[100] min-w-[180px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
              >
                {unassociatedBoards.map((board) => (
                  <button
                    key={board.id}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                    onClick={() => {
                      onAdd(board.id);
                      setShowDropdown(false);
                    }}
                  >
                    <span>{board.emoji}</span>
                    <span className="truncate">{board.name}</span>
                  </button>
                ))}
              </div>
            </FloatingPortal>
          )}
        </div>
      )}
    </div>
  );
}
