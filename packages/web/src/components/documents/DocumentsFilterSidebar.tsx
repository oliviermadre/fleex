import type { TicketDeliverable } from '@fleex/shared';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { cn } from '../../lib/cn';
import { tint, tintClasses } from '../../lib/tints';

interface FacetItem {
  value: string;
  label: string;
  count: number;
}

function buildFacets(deliverables: TicketDeliverable[], key: keyof TicketDeliverable): FacetItem[] {
  const counts = new Map<string, number>();
  for (const d of deliverables) {
    const val = String(d[key] ?? 'unknown');
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count);
}

// Theme-accent fallback used when a type has no configured colour.
const ACCENT_BADGE = 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)] ring-[var(--theme-accent)]/20';

const STATUS_COLORS: Record<string, string> = {
  final: `${tintClasses('green').text} ${tintClasses('green').bg} ${tintClasses('green').ring}`,
  draft: `${tintClasses('yellow').text} ${tintClasses('yellow').bg} ${tintClasses('yellow').ring}`,
};

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

function FacetSection({
  title,
  facets,
  activeValues,
  onToggle,
  renderLabel,
}: {
  title: string;
  facets: FacetItem[];
  activeValues: Set<string>;
  onToggle: (value: string) => void;
  renderLabel?: (facet: FacetItem) => React.ReactNode;
}) {
  if (facets.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {facets.map((f) => {
          const isActive = activeValues.has(f.value);
          return (
            <button
              key={f.value}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-1.5 text-left text-xs transition-colors',
                isActive
                  ? 'bg-[var(--theme-bg-hover)] ring-1 ring-[hsl(261,75%,62%)]'
                  : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
              )}
              onClick={() => onToggle(f.value)}
            >
              <span className="flex items-center gap-1.5 truncate">
                {renderLabel ? renderLabel(f) : f.label}
              </span>
              <span
                className={cn(
                  'ml-2 shrink-0 text-[10px] font-medium',
                  isActive ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-faint)]'
                )}
              >
                {f.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DocumentsFilterSidebar() {
  const deliverables = useDocumentsStore((s) => s.deliverables);
  const filterTypes = useDocumentsStore((s) => s.filterTypes);
  const filterAgentNames = useDocumentsStore((s) => s.filterAgentNames);
  const filterStatuses = useDocumentsStore((s) => s.filterStatuses);
  const toggleFilter = useDocumentsStore((s) => s.toggleFilter);
  const clearFilters = useDocumentsStore((s) => s.clearFilters);
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const colorForType = useDeliverableTypesStore((s) => s.colorFor);

  const typeFacets = buildFacets(deliverables, 'type');
  const agentFacets = buildFacets(deliverables, 'agentName');
  const statusFacets = buildFacets(deliverables, 'status');

  const hasActiveFilters = filterTypes.size > 0 || filterAgentNames.size > 0 || filterStatuses.size > 0;

  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-3">
      {hasActiveFilters && (
        <div className="mb-3 px-3">
          <button
            className="w-full rounded-md px-2 py-1 text-[10px] font-medium text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            onClick={clearFilters}
          >
            Clear all filters
          </button>
        </div>
      )}

      <FacetSection
        title="Type"
        facets={typeFacets}
        activeValues={filterTypes}
        onToggle={(v) => toggleFilter('filterTypes', v)}
        renderLabel={(f) => {
          const c = colorForType(f.value);
          return (
            <span
              className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', !c && ACCENT_BADGE)}
              style={c ? { backgroundColor: c.bg, color: c.text, boxShadow: `0 0 0 1px ${c.border}` } : undefined}
            >
              {labelForType(f.value)}
            </span>
          );
        }}
      />
      <FacetSection
        title="Agent"
        facets={agentFacets}
        activeValues={filterAgentNames}
        onToggle={(v) => toggleFilter('filterAgentNames', v)}
        renderLabel={(f) => (
          <>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${tintClasses('purple').bg} ${tintClasses('purple').text}`}>
              {getInitials(f.label)}
            </span>
            <span className="truncate">{f.label}</span>
          </>
        )}
      />
      <FacetSection
        title="Status"
        facets={statusFacets}
        activeValues={filterStatuses}
        onToggle={(v) => toggleFilter('filterStatuses', v)}
        renderLabel={(f) => {
          const color = STATUS_COLORS[f.value] ?? `${tintClasses('gray').text} ${tintClasses('gray').bg} ${tintClasses('gray').ring}`;
          return (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', color)}>
              {f.label}
            </span>
          );
        }}
      />
    </div>
  );
}
