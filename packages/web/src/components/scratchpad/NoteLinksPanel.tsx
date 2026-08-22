import { useCallback, useEffect, useState } from 'react';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { fetchNoteLinks, type NoteLinks } from '../../services/api';

/**
 * What points at this note, and what resembles it.
 *
 * The two halves answer different questions and are both needed. Backlinks are
 * exact: someone wrote `[[org/repo]]` and meant it, so the connection is a fact.
 * Related notes come from the index, which surfaces the connections nobody
 * thought to write down — the half of a knowledge graph manual linking never
 * produces, and the reason this panel exists rather than a plain backlink list.
 *
 * A footer rather than a sidebar: it is context about the note, not the note, and
 * it should not compete with the editor for width.
 */
export function NoteLinksPanel({ scratchpadKey }: { scratchpadKey: string }) {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.relatedNotes !== false);

  const select = useScratchpadStore((s) => s.setSelectedScratchpadKey);
  const [links, setLinks] = useState<NoteLinks | null>(null);

  const load = useCallback(async () => {
    try {
      // The note's own key is also the link target: `[[global]]` and `[[org/repo]]`
      // both normalise to the key the list endpoint reports, so a backlink scan
      // and a note selection speak the same vocabulary.
      setLinks(await fetchNoteLinks(scratchpadKey, scratchpadKey));
    } catch {
      setLinks(null);
    }
  }, [scratchpadKey]);

  useEffect(() => {
    setLinks(null);
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled || !links) return null;
  if (links.backlinks.length === 0 && links.related.length === 0) return null;

  return (
    <div className="border-t border-[var(--theme-border)] px-4 py-2">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
        {links.backlinks.length > 0 && (
          <Group label="Linked from">
            {links.backlinks.map((note) => (
              <NoteChip key={note.key} label={note.label} onClick={() => select(note.key)} />
            ))}
          </Group>
        )}
        {links.related.length > 0 && (
          <Group label="Related">
            {links.related.map((note) => (
              <NoteChip
                key={note.key}
                label={note.label}
                // The score is what distinguishes a strong match from a weak one,
                // and this list is ranked, not filtered — so it has to be visible.
                hint={`${Math.round(note.score * 100)}% similar`}
                onClick={() => select(note.key)}
              />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function NoteChip({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ?? label}
      className="rounded border border-[var(--theme-border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] cursor-pointer"
    >
      {label}
      {hint && <span className="ml-1.5 font-sans text-[10px] text-[var(--theme-text-faint)]">{hint}</span>}
    </button>
  );
}
