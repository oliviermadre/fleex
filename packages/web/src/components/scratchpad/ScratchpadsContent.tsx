import { useEffect } from 'react';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

export function ScratchpadsContent() {
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const scratchpadListLoaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const loadScratchpadList = useScratchpadStore((s) => s.loadScratchpadList);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const setSelectedScratchpadKey = useScratchpadStore((s) => s.setSelectedScratchpadKey);
  const load = useScratchpadStore((s) => s.load);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  useEffect(() => {
    loadScratchpadList(resolvedRepositories);
  }, [loadScratchpadList, resolvedRepositories]);

  const handleSelect = (key: string) => {
    setSelectedScratchpadKey(key);
    const entries = useScratchpadStore.getState().entries;
    if (!entries[key]?.loaded) {
      load(key);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--theme-border)]">
        <svg className="w-4 h-4 text-[var(--theme-accent)]" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-medium text-[var(--theme-text-primary)]">Scratchpads</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!scratchpadListLoaded ? (
          <div className="px-3 py-4 text-xs text-[var(--theme-text-muted)]">Loading...</div>
        ) : scratchpadList.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--theme-text-muted)]">No scratchpads</div>
        ) : (
          scratchpadList.map((item) => {
            const isSelected = selectedScratchpadKey === item.key;
            return (
              <button
                key={item.key}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-l-2 border-[var(--theme-accent)] bg-zinc-800/40'
                    : 'border-l-2 border-transparent hover:bg-zinc-800/20',
                )}
                onClick={() => handleSelect(item.key)}
              >
                <span className="truncate text-sm text-[var(--theme-text-secondary)]">
                  {item.label}
                </span>
                <span className="ml-2 flex-shrink-0 text-[10px] text-[var(--theme-text-faint)] tabular-nums">
                  {item.lineCount}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
