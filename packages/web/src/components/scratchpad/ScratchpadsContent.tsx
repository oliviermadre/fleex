import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../lib/cn';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

export function ScratchpadsContent() {
  const navigate = useNavigate();
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const scratchpadListLoaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const loadScratchpadList = useScratchpadStore((s) => s.loadScratchpadList);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);

  useEffect(() => {
    loadScratchpadList(resolvedRepositories);
  }, [loadScratchpadList, resolvedRepositories]);

  const handleSelect = (key: string) => {
    if (key === '__global__') {
      navigate('/scratchpads/global', { replace: true });
    } else {
      navigate(`/scratchpads/${key}`, { replace: true });
    }
  };

  // Separate global from repo scratchpads, then group by org
  const { globalItem, orgGroups } = useMemo(() => {
    let globalItem: (typeof scratchpadList)[number] | null = null;
    const byOrg = new Map<
      string,
      { key: string; name: string; label: string; lineCount: number }[]
    >();

    for (const item of scratchpadList) {
      if (item.key === '__global__') {
        globalItem = item;
        continue;
      }
      const slashIdx = item.key.indexOf('/');
      if (slashIdx > 0) {
        const org = item.key.substring(0, slashIdx);
        const name = item.key.substring(slashIdx + 1);
        const existing = byOrg.get(org) ?? [];
        existing.push({ key: item.key, name, label: item.label, lineCount: item.lineCount });
        byOrg.set(org, existing);
      }
    }

    // Sort repos within each org, then sort orgs alphabetically
    for (const [, repos] of byOrg)
      repos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const orgGroups = [...byOrg.entries()].sort(([a], [b]) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return { globalItem, orgGroups };
  }, [scratchpadList]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Scratchpads
        </span>
        <button
          onClick={toggleContentPanel}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          title="Collapse panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="6" y1="1.5" x2="6" y2="14.5" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-2">
        {!scratchpadListLoaded ? (
          <div className="px-3 py-4 text-xs text-[var(--theme-text-muted)]">Loading...</div>
        ) : scratchpadList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-[var(--theme-text-muted)]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-[var(--theme-text-faint)]"
            >
              <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z" />
              <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" strokeWidth="1" strokeLinecap="round" />
            </svg>
            <p className="text-xs">No scratchpads</p>
          </div>
        ) : (
          <>
            {/* Global scratchpad */}
            {globalItem && (
              <ScratchpadItem
                label={globalItem.label}
                lineCount={globalItem.lineCount}
                isSelected={selectedScratchpadKey === globalItem.key}
                onClick={() => handleSelect(globalItem.key)}
              />
            )}

            {/* Org groups */}
            {orgGroups.map(([org, repos]) => (
              <ScratchpadOrgGroup
                key={org}
                org={org}
                items={repos}
                selectedKey={selectedScratchpadKey}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Org group (collapsible, same pattern as OrgGroup for repos) ──

function ScratchpadOrgGroup({
  org,
  items,
  selectedKey,
  onSelect,
}: {
  org: string;
  items: { key: string; name: string; lineCount: number }[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const groupId = `scratchpad-org:${org}`;
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(groupId);

  return (
    <div className="my-1.5">
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
        onClick={() => toggleGroup(groupId)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-[var(--theme-text-muted)] transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          {org}
        </span>
        <span className="ml-auto rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
          {items.length}
        </span>
      </button>
      {!collapsed &&
        items.map((item) => (
          <ScratchpadItem
            key={item.key}
            label={item.name}
            lineCount={item.lineCount}
            isSelected={selectedKey === item.key}
            onClick={() => onSelect(item.key)}
          />
        ))}
    </div>
  );
}

// ── Single scratchpad item ──

function ScratchpadItem({
  label,
  lineCount,
  isSelected,
  onClick,
}: {
  label: string;
  lineCount: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex min-w-0 w-full items-center justify-between py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
      onClick={onClick}
    >
      <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
        {label}
      </span>
      <span className="ml-2 flex-shrink-0 text-xs text-[var(--theme-text-faint)] tabular-nums">
        {lineCount}
      </span>
    </button>
  );
}
