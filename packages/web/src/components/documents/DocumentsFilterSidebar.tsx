import type { DeliverableFacet } from '@fleex/shared';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import {
  PrimitiveIcon,
  PRIMITIVE_KINDS,
  PRIMITIVE_META,
  RoutineIcon,
  TicketIcon,
  type PrimitiveKind,
} from '../../lib/primitives';
import { parseEmitter } from '../../lib/emitter';
import { useDocumentsSidebarWidth } from './useDocumentsSidebarWidth';

interface FacetItem {
  value: string;
  label: string;
  count: number;
}

/**
 * Facets come from the database (distinct values + counts over every row), so a
 * type only used by today's documents still appears even though the list holds
 * just the most recent page. A selected value is kept visible even at count 0,
 * otherwise unselecting it would be impossible.
 */
function toFacetItems(facets: DeliverableFacet[], active: Set<string>): FacetItem[] {
  const items = facets.map((f) => ({ value: f.value || 'unknown', label: f.value || 'unknown', count: f.count }));
  const known = new Set(items.map((i) => i.value));
  for (const value of active) {
    if (!known.has(value)) items.push({ value, label: value, count: 0 });
  }
  return items;
}

/**
 * The origin dimension. `none` (deleted ticket / run without routine) is left
 * out of this map on purpose: it names nothing the reader can act on.
 */
const ORIGIN_META: Record<string, { label: string; Icon: typeof RoutineIcon }> = {
  ticket: { label: 'Ticket', Icon: TicketIcon },
  routine: { label: 'Routine', Icon: RoutineIcon },
};

// Theme-accent fallback used when a type has no configured colour.
const ACCENT_BADGE = 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)] ring-[var(--theme-accent)]/20';

const STATUS_COLORS: Record<string, string> = {
  final: `${tintClasses('green').text} ${tintClasses('green').bg} ${tintClasses('green').ring}`,
  draft: `${tintClasses('yellow').text} ${tintClasses('yellow').bg} ${tintClasses('yellow').ring}`,
};

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
  const facets = useDocumentsStore((s) => s.facets);
  const filterTypes = useDocumentsStore((s) => s.filterTypes);
  const filterAgentNames = useDocumentsStore((s) => s.filterAgentNames);
  const filterStatuses = useDocumentsStore((s) => s.filterStatuses);
  const filterOriginKinds = useDocumentsStore((s) => s.filterOriginKinds);
  const toggleFilter = useDocumentsStore((s) => s.toggleFilter);
  const clearFilters = useDocumentsStore((s) => s.clearFilters);
  const search = useDocumentsStore((s) => s.search);
  const setSearch = useDocumentsStore((s) => s.setSearch);
  const { width, resizing, startResize, nudge } = useDocumentsSidebarWidth();
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const colorForType = useDeliverableTypesStore((s) => s.colorFor);

  const typeFacets = toFacetItems(facets.types, filterTypes);
  const statusFacets = toFacetItems(facets.statuses, filterStatuses);
  const originFacets = toFacetItems(facets.originKinds, filterOriginKinds)
    .filter((f) => f.value in ORIGIN_META)
    .sort((a, b) => b.count - a.count);

  // One section per primitive rather than a single "Agentique" list: personas,
  // skills, panels and workflows are different things, and mixing them made the
  // list unscannable once a workflow contributed a dozen entries.
  const emitterFacets = toFacetItems(facets.agentNames, filterAgentNames).map((f) => ({
    facet: f,
    emitter: parseEmitter(f.label),
  }));
  const facetsByKind = (kind: PrimitiveKind) =>
    emitterFacets.filter((e) => e.emitter.kind === kind).map((e) => ({ ...e.facet, label: e.emitter.name }));

  const hasActiveFilters =
    filterTypes.size > 0 ||
    filterAgentNames.size > 0 ||
    filterStatuses.size > 0 ||
    filterOriginKinds.size > 0 ||
    search.trim().length > 0;

  return (
    <div className="relative flex h-full shrink-0" style={{ width }}>
      <div className="flex h-full w-full flex-col overflow-y-auto border-r border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-3">
      {/* Full-text search — document title, ticket title or routine name */}
      <div className="mb-3 px-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)]"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.stopPropagation();
                setSearch('');
              }
            }}
            placeholder="Search documents…"
            aria-label="Search documents by title, ticket or routine"
            className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] py-1.5 pl-7 pr-6 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          {search && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-primary)]"
              onClick={() => setSearch('')}
              title="Clear search"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

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
        title="Origine"
        facets={originFacets}
        activeValues={filterOriginKinds}
        onToggle={(v) => toggleFilter('filterOriginKinds', v)}
        renderLabel={(f) => {
          const meta = ORIGIN_META[f.value]!;
          return (
            <>
              <meta.Icon size={14} className="shrink-0" />
              <span className="truncate">{meta.label}</span>
            </>
          );
        }}
      />

      {/* One section per primitive — the icon carries the kind, so the
          `workflow:` / `panel:` prefix is dropped from every label. */}
      {PRIMITIVE_KINDS.map((kind) => (
        <FacetSection
          key={kind}
          title={PRIMITIVE_META[kind].pluralLabel}
          facets={facetsByKind(kind)}
          activeValues={filterAgentNames}
          onToggle={(v) => toggleFilter('filterAgentNames', v)}
          renderLabel={(f) => (
            <>
              <PrimitiveIcon kind={kind} size={14} className="shrink-0" />
              <span className="truncate" title={f.value}>{f.label}</span>
            </>
          )}
        />
      ))}
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

      {/* Drag handle — facet labels are long, the reader picks the width */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize filters sidebar"
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-16); }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudge(16); }
        }}
        className={cn(
          'absolute -right-[2px] top-0 z-10 h-full w-[4px] cursor-col-resize transition-colors',
          'hover:bg-[var(--theme-accent)]/40 focus:bg-[var(--theme-accent)]/40 focus:outline-none',
          resizing && 'bg-[var(--theme-accent)]/60',
        )}
      />
    </div>
  );
}
