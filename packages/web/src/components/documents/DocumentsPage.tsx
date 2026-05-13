import { useEffect, useMemo } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useDocumentsStore } from '../../stores/documentsStore';
import { DocumentsFilterSidebar } from './DocumentsFilterSidebar';
import { DocumentRow } from './DocumentRow';
import { DeliverableReadingOverlay } from '../tickets/DeliverableReadingOverlay';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface DocGroup {
  label: string;
  docs: TicketDeliverable[];
}

function groupByRecency(docs: TicketDeliverable[]): DocGroup[] {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);

  const groups: DocGroup[] = [
    { label: 'Today', docs: docs.filter((d) => new Date(d.updatedAt) >= todayStart) },
    { label: 'This week', docs: docs.filter((d) => { const dt = new Date(d.updatedAt); return dt >= weekStart && dt < todayStart; }) },
    { label: 'Older', docs: docs.filter((d) => new Date(d.updatedAt) < weekStart) },
  ].filter((g) => g.docs.length > 0);

  return groups;
}

const COLUMN_HEADERS = [
  { label: 'Title', flex: 'flex-[3]' },
  { label: 'Agent', flex: 'flex-[1.5]' },
  { label: 'Ticket', flex: 'flex-[2]' },
  { label: 'Type', flex: 'flex-[0.8]' },
  { label: 'Status', flex: 'flex-[0.6]' },
  { label: 'Updated', flex: 'w-16 shrink-0 text-right' },
  { label: '', flex: 'w-16 shrink-0' }, // CTA column
];

export function DocumentsPage() {
  const deliverables = useDocumentsStore((s) => s.deliverables);
  const loading = useDocumentsStore((s) => s.loading);
  const fetchAll = useDocumentsStore((s) => s.fetchAll);

  const filterTypes = useDocumentsStore((s) => s.filterTypes);
  const filterAgentNames = useDocumentsStore((s) => s.filterAgentNames);
  const filterStatuses = useDocumentsStore((s) => s.filterStatuses);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    let result = deliverables;
    if (filterTypes.size > 0) result = result.filter((d) => filterTypes.has(d.type));
    if (filterAgentNames.size > 0) result = result.filter((d) => filterAgentNames.has(d.agentName));
    if (filterStatuses.size > 0) result = result.filter((d) => filterStatuses.has(d.status));
    // Sort by updatedAt desc
    return [...result].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [deliverables, filterTypes, filterAgentNames, filterStatuses]);

  const groups = useMemo(() => groupByRecency(filtered), [filtered]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-[var(--theme-text-primary)]">Documents</h1>
          <span className="text-xs text-[var(--theme-text-faint)]">
            ({filtered.length} of {deliverables.length})
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Filter sidebar */}
        <DocumentsFilterSidebar />

        {/* Main table */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center gap-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-2">
            {COLUMN_HEADERS.map((col) => (
              <div
                key={col.label || 'cta'}
                className={`${col.flex} text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]`}
              >
                {col.label}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {loading && deliverables.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-xs text-[var(--theme-text-faint)]">Loading documents...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-xs text-[var(--theme-text-faint)]">
                  {deliverables.length === 0 ? 'No documents yet' : 'No documents match your filters'}
                </span>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  {/* Group header */}
                  <div className="sticky top-0 z-10 border-b border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
                      {group.label}
                    </span>
                  </div>
                  {/* Rows */}
                  {group.docs.map((doc) => (
                    <DocumentRow key={doc.id} deliverable={doc} />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Deliverable overlay (same as ticket view — supports detach) */}
      <DeliverableReadingOverlay />
    </div>
  );
}
