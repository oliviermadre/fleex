import { useEffect, useRef, useCallback, useMemo } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';
import { SaveStatus } from './SaveStatus';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { MentionMenu, type MentionOption } from '../markdown/MentionMenu';
import { useMentionAutocomplete } from '../markdown/useMentionAutocomplete';
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
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const scratchpadListLoaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const loadScratchpadList = useScratchpadStore((s) => s.loadScratchpadList);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);
  const tickets = useTicketStore((s) => s.tickets);

  const entry = entries[scratchpadKey] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (value: string) => setContent(scratchpadKey, value),
    [scratchpadKey, setContent],
  );

  const handleToggleCheckbox = useCallback(
    (lineIndex: number) => toggleCheckbox(scratchpadKey, lineIndex),
    [scratchpadKey, toggleCheckbox],
  );

  // Only the two primitives that navigate somewhere from a note. An @agent: or
  // @skill: dispatches nothing here and renders no chip on this surface, so
  // offering it would insert dead text.
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const notes: MentionOption[] = scratchpadList.map((note) => ({
      // The reference syntax spells the global note `global`; `__global__` is a
      // storage key and must never reach the document.
      insertText: `@scratchpad:${note.key === GLOBAL_NOTE_KEY ? 'global' : note.key}`,
      label: note.label,
      type: 'scratchpad' as const,
    }));
    const ticketOpts: MentionOption[] = tickets.map((t) => ({
      insertText: `@ticket:${t.displayId}`,
      label: `#${t.displayId} ${t.title}`,
      type: 'ticket' as const,
      deferred: true,
    }));
    return [...notes, ...ticketOpts];
  }, [scratchpadList, tickets]);

  const mentionAc = useMentionAutocomplete({
    options: mentionOptions,
    value: entry.content,
    onChange: handleChange,
    textareaRef,
  });

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

  // The sidebar list loads this too, but it is a sibling of this view rather than an
  // ancestor: with the sidebar on another panel there would be no notes to offer.
  useEffect(() => {
    if (!scratchpadListLoaded) void loadScratchpadList(resolvedRepositories);
  }, [scratchpadListLoaded, loadScratchpadList, resolvedRepositories]);

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
        textareaProps={{
          spellCheck: false,
          onChange: mentionAc.onScan,
          onKeyDown: (e) => { mentionAc.onKeyDown(e); },
          onBlur: () => { setTimeout(mentionAc.close, 150); },
        }}
        overlay={
          mentionAc.open && mentionAc.filtered.length > 0 ? (
            <MentionMenu
              options={mentionAc.filtered}
              selectedIndex={mentionAc.index}
              onSelect={mentionAc.accept}
              position={{ bottom: 8, left: 8 }}
            />
          ) : null
        }
      />

      <NoteLinksPanel scratchpadKey={scratchpadKey} />
    </div>
  );
}
