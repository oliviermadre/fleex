import { useEffect, useRef, useCallback } from 'react';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { SaveStatus } from './SaveStatus';
import { MarkdownEditor } from '../markdown/MarkdownEditor';

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
  const markdownMode = useScratchpadStore((s) => s.markdownMode);
  const setMarkdownMode = useScratchpadStore((s) => s.setMarkdownMode);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const entry = entries[storeKey] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };

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
    (value: string) => setContent(storeKey, value),
    [storeKey, setContent],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`flex items-center justify-between border-b border-white/[0.06] ${compact ? 'px-2 py-1.5' : 'px-4 py-3'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!compact && (
            <svg className="w-4 h-4 text-[var(--theme-accent)] flex-shrink-0" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
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
          {trailing}
        </div>
      </div>

      <MarkdownEditor
        surfaceKind="scratchpad"
        mode={markdownMode}
        onModeChange={setMarkdownMode}
        value={entry.content}
        onChange={handleChange}
        onToggleCheckbox={handleToggleCheckbox}
        textareaRef={textareaRef}
        className="p-3"
        placeholder={'# Scratchpad\n\nWrite your notes here...'}
        textareaProps={{ spellCheck: false }}
      />
    </div>
  );
}
