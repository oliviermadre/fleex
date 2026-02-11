import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { MarkdownRenderer } from './MarkdownRenderer';

export function ScratchpadPanel() {
  const open = useUIStore((s) => s.scratchpadOpen);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const content = useScratchpadStore((s) => s.content);
  const setContent = useScratchpadStore((s) => s.setContent);
  const loaded = useScratchpadStore((s) => s.loaded);
  const saving = useScratchpadStore((s) => s.saving);
  const load = useScratchpadStore((s) => s.load);
  const mode = useScratchpadStore((s) => s.mode);
  const setMode = useScratchpadStore((s) => s.setMode);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Load content on first open
  useEffect(() => {
    if (open && !loaded) {
      load();
    }
  }, [open, loaded, load]);

  // Focus textarea in edit mode
  useEffect(() => {
    if (open && mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, mode]);

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

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="scratchpad-backdrop"
      onClick={handleBackdropClick}
    >
      <div className={`scratchpad-panel ${open ? 'scratchpad-panel-enter' : ''}`}>
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
            <span className="text-sm font-medium text-[var(--theme-text-primary)]">
              Scratchpad
            </span>
            {saving && (
              <span className="text-xs text-[var(--theme-text-muted)]">saving...</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Mode toggle */}
            <div className="flex rounded-md border border-white/[0.06] overflow-hidden mr-2">
              <button
                className={`px-2.5 py-1 text-xs transition-colors ${
                  mode === 'preview'
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                }`}
                onClick={() => setMode('preview')}
              >
                Preview
              </button>
              <button
                className={`px-2.5 py-1 text-xs transition-colors ${
                  mode === 'edit'
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                }`}
                onClick={() => setMode('edit')}
              >
                Edit
              </button>
            </div>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {mode === 'edit' ? (
            <textarea
              ref={textareaRef}
              className="w-full h-full p-4 bg-transparent text-sm text-[var(--theme-text-primary)] font-mono resize-none outline-none placeholder:text-[var(--theme-text-faint)]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Scratchpad&#10;&#10;Write your notes here...&#10;&#10;- [ ] Task item&#10;- [x] Completed item&#10;&#10;>>> Toggle section&#10;Hidden content here&#10;<<<"
              spellCheck={false}
            />
          ) : (
            <div className="p-4">
              {content.trim() ? (
                <MarkdownRenderer content={content} onToggleCheckbox={toggleCheckbox} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--theme-text-faint)]">
                  <svg className="w-8 h-8 mb-3 opacity-40" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  </svg>
                  <span className="text-xs">Empty scratchpad</span>
                  <button
                    className="mt-2 text-xs text-[var(--theme-accent)] hover:underline"
                    onClick={() => setMode('edit')}
                  >
                    Start writing
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
