import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SaveStatus } from './SaveStatus';
import { useScrollSync } from '../../hooks/useScrollSync';
import { HotkeyBadge } from '../ui/HotkeyBadge';

export function ScratchpadPanel() {
  const open = useUIStore((s) => s.scratchpadOpen);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const scratchpadRepoKey = useUIStore((s) => s.scratchpadRepoKey);

  const entries = useScratchpadStore((s) => s.entries);
  const setContent = useScratchpadStore((s) => s.setContent);
  const load = useScratchpadStore((s) => s.load);
  const flushSave = useScratchpadStore((s) => s.flushSave);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);
  const previewExpanded = useScratchpadStore((s) => s.previewExpanded);
  const togglePreview = useScratchpadStore((s) => s.togglePreview);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Derive store key from repo key
  const storeKey = scratchpadRepoKey ?? '__global__';
  const entry = entries[storeKey] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };

  const { handleTyping, handlePreviewScroll } = useScrollSync(
    textareaRef,
    previewRef,
    previewExpanded,
  );

  // Load content on open or when key changes
  useEffect(() => {
    if (open && !entry.loaded) {
      load(storeKey);
    }
  }, [open, storeKey, entry.loaded, load]);

  // Focus textarea on open
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, storeKey]);

  // Flush save on close. AppLayout only mounts this panel while it's open, so
  // closing unmounts us — the cleanup is the close hook. Switching repo keys
  // flushes the previous scratchpad for the same reason.
  useEffect(() => {
    return () => {
      flushSave(storeKey);
    };
  }, [storeKey, flushSave]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggleScratchpad();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, toggleScratchpad]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) {
        toggleScratchpad();
      }
    },
    [toggleScratchpad],
  );

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

  if (!open) return null;

  const title = scratchpadRepoKey
    ? `Scratchpad — ${scratchpadRepoKey}`
    : 'Scratchpad';

  return createPortal(
    <div
      ref={backdropRef}
      className="scratchpad-backdrop"
      onClick={handleBackdropClick}
    >
      <div className={`scratchpad-panel ${previewExpanded ? 'scratchpad-panel-wide' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-[var(--theme-accent)]" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium text-[var(--theme-text-primary)] truncate max-w-[260px]">
              {title}
            </span>
            <SaveStatus saving={entry.saving} savedAt={entry.savedAt} dirty={entry.dirty} />
          </div>
          <div className="flex items-center gap-1">
            {/* Preview toggle */}
            <span className="relative">
              <button
                className={`p-1.5 rounded transition-colors ${
                  previewExpanded
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-white/[0.06]'
                }`}
                onClick={togglePreview}
                title="Toggle preview (Alt+Shift+V)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                  <circle cx="8" cy="8" r="2" />
                </svg>
              </button>
              <HotkeyBadge hotkey="⌥⇧V" position="top-left" />
            </span>
            {/* Hotkey badge */}
            <span className="text-[10px] text-[var(--theme-text-faint)] bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 rounded font-mono mr-1">
              Alt+Shift+P
            </span>
            {/* Close button */}
            <button
              className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-white/[0.06] transition-colors"
              onClick={toggleScratchpad}
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content — always flex row */}
        <div className="flex flex-1 min-h-0">
          {/* Textarea — always visible */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              className="w-full h-full p-4 bg-transparent text-sm text-[var(--theme-text-primary)] font-mono resize-none outline-none placeholder:text-[var(--theme-text-faint)]"
              value={entry.content}
              onChange={handleChange}
              placeholder="# Scratchpad&#10;&#10;Write your notes here...&#10;&#10;- [ ] Task item&#10;- [x] Completed item&#10;&#10;>>> Toggle section&#10;Hidden content here&#10;<<<"
              spellCheck={false}
            />
          </div>

          {/* Preview pane — animated */}
          {previewExpanded && (
            <>
              <div className="w-px bg-white/[0.06] flex-shrink-0" />
              <div
                ref={previewRef}
                className="flex-1 min-w-0 overflow-y-auto p-4"
                onScroll={handlePreviewScroll}
              >
                {entry.content.trim() ? (
                  <MarkdownRenderer
                    content={entry.content}
                    onToggleCheckbox={handleToggleCheckbox}
                  />
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
    </div>,
    document.body,
  );
}
