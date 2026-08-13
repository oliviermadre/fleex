import { useEffect, useRef, useCallback } from 'react';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { SaveStatus } from './SaveStatus';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { NoteLinksPanel } from './NoteLinksPanel';

interface Props {
  scratchpadKey: string;
}

export function ScratchpadMainView({ scratchpadKey }: Props) {
  const entries = useScratchpadStore((s) => s.entries);
  const setContent = useScratchpadStore((s) => s.setContent);
  const load = useScratchpadStore((s) => s.load);
  const toggleCheckbox = useScratchpadStore((s) => s.toggleCheckbox);
  const markdownMode = useScratchpadStore((s) => s.markdownMode);
  const setMarkdownMode = useScratchpadStore((s) => s.setMarkdownMode);

  const entry = entries[scratchpadKey] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    (value: string) => setContent(scratchpadKey, value),
    [scratchpadKey, setContent],
  );

  const label = scratchpadKey === '__global__' ? 'Global' : scratchpadKey;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 border-b border-[var(--theme-border)]" style={{ height: 'var(--header-height)' }}>
        <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
          {label}
        </span>
        <SaveStatus saving={entry.saving} savedAt={entry.savedAt} dirty={entry.dirty} />
      </div>

      <MarkdownEditor
        surfaceKind="scratchpad"
        mode={markdownMode}
        onModeChange={setMarkdownMode}
        value={entry.content}
        onChange={handleChange}
        onToggleCheckbox={handleToggleCheckbox}
        textareaRef={textareaRef}
        className="p-4"
        placeholder={'# Scratchpad\n\nWrite your notes here...'}
        textareaProps={{ spellCheck: false }}
      />

      <NoteLinksPanel scratchpadKey={scratchpadKey} />
    </div>
  );
}
