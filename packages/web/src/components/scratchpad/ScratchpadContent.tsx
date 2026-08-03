import { useEffect, useRef, useCallback } from 'react';

import { useScrollSync } from '../../hooks/useScrollSync';
import { useScratchpadStore } from '../../stores/scratchpadStore';

import { MarkdownRenderer } from './MarkdownRenderer';
import { SaveStatus } from './SaveStatus';

interface ScratchpadContentProps {
  /** Logical store key (e.g. 'org/name' for per-repo, '__global__' for global). */
  storeKey: string;
  /** Whether to auto-focus the textarea when this component mounts / storeKey changes. */
  autoFocus?: boolean;
  /** Optional title rendered in the header. */
  title?: string;
  /** Optional extra controls rendered in the header trailing area. */
  trailing?: React.ReactNode;
  /** Compact mode: smaller header for embedded usage (e.g. sidebar). */
  compact?: boolean;
}

/**
 * Pure scratchpad content (textarea + optional preview pane + header).
 * Free of modal/portal/backdrop concerns so it can be embedded
 * in modals, sidebars, or any other host container.
 */
export function ScratchpadContent({
  storeKey,
  autoFocus = false,
  title,
  trailing,
  compact = false,
}: ScratchpadContentProps) {
  const entries = useScratchpadStore((s) => s.entries);
  const setContent = useScratchpadStore((s) => s.setContent);
  const load = useScratchpadStore((s) => s.load);
  const flushSave = useScratchpadStore((s) => s.flushSave);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);
  const previewExpanded = useScratchpadStore((s) => s.previewExpanded);
  const togglePreview = useScratchpadStore((s) => s.togglePreview);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const entry = entries[storeKey] ?? {
    content: '',
    loaded: false,
    saving: false,
    savedAt: null,
    dirty: false,
  };

  const { handleTyping, handlePreviewScroll } = useScrollSync(
    textareaRef,
    previewRef,
    previewExpanded,
  );

  useEffect(() => {
    if (!entry.loaded) load(storeKey);
  }, [storeKey, entry.loaded, load]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus, storeKey]);

  // Flush on unmount / key change
  useEffect(() => {
    return () => {
      flushSave(storeKey);
    };
  }, [storeKey, flushSave]);

  const handleToggleCheckbox = useCallback(
    (lineIndex: number) => toggleCheckbox(storeKey, lineIndex),
    [storeKey, toggleCheckbox],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(storeKey, e.target.value);
      handleTyping();
    },
    [storeKey, setContent, handleTyping],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`flex items-center justify-between border-b border-white/[0.06] ${compact ? 'px-2 py-1.5' : 'px-4 py-3'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!compact && (
            <svg
              className="w-4 h-4 text-[var(--theme-accent)] flex-shrink-0"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M5.5 5h5M5.5 7.5h5M5.5 10h3"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          )}
          {title && (
            <span className="text-xs font-medium text-[var(--theme-text-primary)] truncate">
              {title}
            </span>
          )}
          <SaveStatus saving={entry.saving} savedAt={entry.savedAt} dirty={entry.dirty} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className={`p-1 rounded transition-colors ${
              previewExpanded
                ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-white/[0.06]'
            }`}
            onClick={togglePreview}
            title="Toggle preview"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </button>
          {trailing}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            className="w-full h-full p-3 bg-transparent text-sm text-[var(--theme-text-primary)] font-mono resize-none outline-none placeholder:text-[var(--theme-text-faint)]"
            value={entry.content}
            onChange={handleChange}
            placeholder="# Scratchpad&#10;&#10;Write your notes here..."
            spellCheck={false}
          />
        </div>

        {previewExpanded && (
          <>
            <div className="w-px bg-white/[0.06] flex-shrink-0" />
            <div
              ref={previewRef}
              className="flex-1 min-w-0 overflow-y-auto p-3"
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
          </>
        )}
      </div>
    </div>
  );
}
