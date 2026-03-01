import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

export function ScratchpadsContent() {
  const navigate = useNavigate();
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const scratchpadListLoaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const loadScratchpadList = useScratchpadStore((s) => s.loadScratchpadList);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Scratchpads</span>
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
                  'flex min-w-0 w-full items-center justify-between py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
                  isSelected
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                    : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
                )}
                onClick={() => handleSelect(item.key)}
              >
                <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
                  {item.label}
                </span>
                <span className="ml-2 flex-shrink-0 text-xs text-[var(--theme-text-faint)] tabular-nums">
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
