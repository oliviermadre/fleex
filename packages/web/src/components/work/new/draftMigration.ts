import type { WorkDraft, DraftSource } from '../../../stores/workStore';

/** The empty draft — the starting point for a brand-new task (ENTRY screen). */
export const EMPTY_DRAFT: WorkDraft = {
  title: '',
  text: '',
  stage: 'entry',
  source: null,
  repoKeys: [],
  repoBaseBranches: {},
  repoCheckoutRefs: {},
  epicIds: [],
  boardId: null,
  type: 'build',
  priority: 'none',
  startWithAssistant: true,
};

/**
 * Title = the first sentence, capped at 70 chars. Previously how EVERY ticket
 * title was produced from the composer text; now the title is chosen explicitly,
 * so this only survives to migrate a persisted `localStorage['fleex_work']`
 * blob written before the title existed.
 */
export function deriveTitle(text: string): string {
  const trimmed = text.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  const base = firstSentence.length <= 70 ? firstSentence : firstSentence.slice(0, 70).trimEnd();
  return base || 'Untitled task';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Normalise a persisted draft blob to the current {@link WorkDraft} shape:
 * - a legacy blob with no `title` derives one from its `text` (the old behaviour)
 *   and opens straight in the composer;
 * - a legacy blob with an empty `text` becomes the empty draft (ENTRY);
 * - a current blob is merged over the defaults, repairing an invalid `stage`.
 */
export function migrateDraft(raw: unknown): WorkDraft {
  if (!isRecord(raw)) return { ...EMPTY_DRAFT };
  const d = raw;

  const merged: WorkDraft = {
    ...EMPTY_DRAFT,
    ...(d as Partial<WorkDraft>),
    // Guarantee the shape of the collections even from a truncated/old blob.
    text: typeof d['text'] === 'string' ? (d['text'] as string) : '',
    repoKeys: Array.isArray(d['repoKeys']) ? (d['repoKeys'] as string[]) : [],
    repoBaseBranches: isRecord(d['repoBaseBranches']) ? (d['repoBaseBranches'] as Record<string, string>) : {},
    repoCheckoutRefs: isRecord(d['repoCheckoutRefs']) ? (d['repoCheckoutRefs'] as Record<string, string>) : {},
    epicIds: Array.isArray(d['epicIds']) ? (d['epicIds'] as string[]) : [],
    source: isRecord(d['source']) ? (d['source'] as unknown as DraftSource) : null,
  };

  if (typeof d['title'] !== 'string') {
    // Pre-title blob: the title used to be the first line of the description.
    if (merged.text.trim() !== '') {
      merged.title = deriveTitle(merged.text);
      merged.stage = 'compose';
    } else {
      merged.title = '';
      merged.stage = 'entry';
    }
    return merged;
  }

  merged.title = d['title'] as string;
  if (merged.stage !== 'entry' && merged.stage !== 'compose') {
    merged.stage = merged.title.trim() !== '' || merged.text.trim() !== '' ? 'compose' : 'entry';
  }
  return merged;
}
