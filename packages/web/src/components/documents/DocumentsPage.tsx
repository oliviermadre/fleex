import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DeliverableListItem } from '@fleex/shared';
import { DOCUMENTS_PAGE_SIZE, useDocumentsStore } from '../../stores/documentsStore';
import { DocumentsFilterSidebar } from './DocumentsFilterSidebar';
import { CompileMemoryPanel } from './CompileMemoryPanel';
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
  docs: DeliverableListItem[];
}

function groupByRecency(docs: DeliverableListItem[]): DocGroup[] {
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
  { label: 'Agentique', flex: 'flex-[1.5]' },
  { label: 'Origine', flex: 'flex-[2]' },
  { label: 'Type', flex: 'flex-[0.8]' },
  { label: 'Status', flex: 'flex-[0.6]' },
  { label: 'Updated', flex: 'w-16 shrink-0 text-right' },
  { label: '', flex: 'w-16 shrink-0' }, // CTA column
];

export function DocumentsPage() {
  // The store holds the loaded pages only; `total` is the DB-side count.
  const deliverables = useDocumentsStore((s) => s.deliverables);
  const total = useDocumentsStore((s) => s.total);
  const loading = useDocumentsStore((s) => s.loading);
  const loadingMore = useDocumentsStore((s) => s.loadingMore);
  const fetchAll = useDocumentsStore((s) => s.fetchAll);
  const loadMore = useDocumentsStore((s) => s.loadMore);

  // Distinguishes "nothing here" from "nothing matched" in the empty state.
  const hasQuery = useDocumentsStore(
    (s) =>
      s.search.trim().length > 0 ||
      s.filterTypes.size > 0 ||
      s.filterAgentNames.size > 0 ||
      s.filterStatuses.size > 0,
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filtering and ordering are server-side; only keep the sort as a tiebreaker
  // for pages appended by "load more".
  const sorted = useMemo(
    () => [...deliverables].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [deliverables],
  );

  const groups = useMemo(() => groupByRecency(sorted), [sorted]);

  const hasMore = deliverables.length < total;

  // Infinite scroll: the sentinel below the last row pulls the next page in.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node;
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, sorted.length]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-[var(--theme-text-primary)]">Documents</h1>
          <span className="text-xs text-[var(--theme-text-faint)]">
            ({deliverables.length} of {total})
          </span>
        </div>
      </div>

      {/* Its own row: collapsed it is one button, expanded it is a full panel with
          a document in it, which would be squeezed inside the header line. */}
      <div className="border-b border-[var(--theme-border)] px-6 py-2">
        <CompileMemoryPanel />
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
            ) : sorted.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-xs text-[var(--theme-text-faint)]">
                  {hasQuery ? 'No documents match your search or filters' : 'No documents yet'}
                </span>
              </div>
            ) : (
              <>
                {groups.map((group) => (
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
                ))}

                {/* Load more — auto-triggered on scroll, clickable as a fallback */}
                {hasMore && (
                  <div ref={setSentinel} className="flex justify-center px-4 py-4">
                    <button
                      className="rounded-md px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-60"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore
                        ? 'Loading…'
                        : `Load ${Math.min(DOCUMENTS_PAGE_SIZE, total - deliverables.length)} more`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Deliverable overlay (same as ticket view — supports detach) */}
      <DeliverableReadingOverlay />
    </div>
  );
}
