import { useEffect, useRef, useCallback } from 'react';

import { useScrollSync } from '../../hooks/useScrollSync';
import { useScratchpadStore } from '../../stores/scratchpadStore';

import { MarkdownRenderer } from './MarkdownRenderer';
import { SaveStatus } from './SaveStatus';

interface Props {
  scratchpadKey: string;
}

export function ScratchpadMainView({ scratchpadKey }: Props) {
  const entries = useScratchpadStore((s) => s.entries);
  const setContent = useScratchpadStore((s) => s.setContent);
  const load = useScratchpadStore((s) => s.load);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);

  const entry = entries[scratchpadKey] ?? {
    content: '',
    loaded: false,
    saving: false,
    savedAt: null,
    dirty: false,
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const { handleTyping, handlePreviewScroll } = useScrollSync(textareaRef, previewRef, true);

  const handleToggleCheckbox = useCallback(
    (lineIndex: number) => toggleCheckbox(scratchpadKey, lineIndex),
    [scratchpadKey, toggleCheckbox],
  );

  // Load on key change
  useEffect(() => {
    if (!entry.loaded) {
      load(scratchpadKey);
    }
  }, [scratchpadKey, entry.loaded, load]);

  // Focus textarea on key change
  useEffect(() => {
    textareaRef.current?.focus();
  }, [scratchpadKey]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(scratchpadKey, e.target.value);
      handleTyping();
    },
    [scratchpadKey, setContent, handleTyping],
  );

  const label = scratchpadKey === '__global__' ? 'Global' : scratchpadKey;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 border-b border-[var(--theme-border)]"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
          {label}
        </span>
        <SaveStatus saving={entry.saving} savedAt={entry.savedAt} dirty={entry.dirty} />
      </div>

      {/* Split: edit | preview */}
      <div className="flex flex-1 min-h-0">
        {/* Edit pane */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className="px-4 py-1.5 border-b border-[var(--theme-border-subtle)]">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--theme-text-faint)]">
              Edit
            </span>
          </div>
          <textarea
            ref={textareaRef}
            className="w-full flex-1 p-4 bg-transparent text-sm text-[var(--theme-text-primary)] font-mono resize-none outline-none placeholder:text-[var(--theme-text-faint)]"
            value={entry.content}
            onChange={handleChange}
            placeholder="# Scratchpad&#10;&#10;Write your notes here..."
            spellCheck={false}
          />
        </div>

        {/* Divider */}
        <div className="w-px bg-[var(--theme-border)] flex-shrink-0" />

        {/* Preview pane */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className="px-4 py-1.5 border-b border-[var(--theme-border-subtle)]">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--theme-text-faint)]">
              Preview
            </span>
          </div>
          <div
            ref={previewRef}
            className="flex-1 overflow-y-auto p-4"
            onScroll={handlePreviewScroll}
          >
            {entry.content.trim() ? (
              <MarkdownRenderer content={entry.content} onToggleCheckbox={handleToggleCheckbox} />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)] text-xs">
                Preview will appear here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
