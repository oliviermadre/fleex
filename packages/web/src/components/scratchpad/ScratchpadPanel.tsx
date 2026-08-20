import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { SaveStatus } from './SaveStatus';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';

export function ScratchpadPanel() {
  const open = useUIStore((s) => s.scratchpadOpen);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const scratchpadRepoKey = useUIStore((s) => s.scratchpadRepoKey);

  const entries = useScratchpadStore((s) => s.entries);
  const setContent = useScratchpadStore((s) => s.setContent);
  const load = useScratchpadStore((s) => s.load);
  const flushSave = useScratchpadStore((s) => s.flushSave);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);
  const markdownMode = useScratchpadStore((s) => s.markdownMode);
  const setMarkdownMode = useScratchpadStore((s) => s.setMarkdownMode);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Derive store key from repo key
  const storeKey = scratchpadRepoKey ?? '__global__';
  const entry = entries[storeKey] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };

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

  // Flush save on close
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      flushSave(storeKey);
    }
    prevOpenRef.current = open;
  }, [open, storeKey, flushSave]);

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

  // Both ends of the gesture, so selecting a note's text and releasing past the
  // panel's edge no longer closes it.
  const dismiss = useBackdropDismiss(backdropRef, toggleScratchpad);

  const handleToggleCheckbox = useCallback(
    (lineIndex: number) => toggleCheckbox(storeKey, lineIndex),
    [storeKey, toggleCheckbox],
  );

  const handleChange = useCallback(
    (value: string) => setContent(storeKey, value),
    [storeKey, setContent],
  );

  if (!open) return null;

  const title = scratchpadRepoKey
    ? `Scratchpad — ${scratchpadRepoKey}`
    : 'Scratchpad';

  return createPortal(
    <div
      ref={backdropRef}
      className="scratchpad-backdrop"
      {...dismiss}
    >
      <div className={`scratchpad-panel ${markdownMode !== 'write' ? 'scratchpad-panel-wide' : ''}`}>
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
        <MarkdownEditor
          surfaceKind="scratchpad"
          mode={markdownMode}
          onModeChange={setMarkdownMode}
          value={entry.content}
          onChange={handleChange}
          onToggleCheckbox={handleToggleCheckbox}
          textareaRef={textareaRef}
          className="p-4"
          placeholder={"# Scratchpad\n\nWrite your notes here...\n\n- [ ] Task item\n- [x] Completed item\n\n>>> Toggle section\nHidden content here\n<<<"}
          textareaProps={{ spellCheck: false }}
        />
      </div>
    </div>,
    document.body,
  );
}
