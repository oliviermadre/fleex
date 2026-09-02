import { apiBase } from '../../core/api.ts';

/** One retrieved excerpt, as the search and ask endpoints return it. */
export interface MemorySnippet {
  sourceKind: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
  ticketId?: string | null;
  repo?: string | null;
  updatedAt?: string | null;
}

export function memoryApi(path: string): string {
  return `${apiBase()}/api/memory${path}`;
}

/**
 * Human-readable origin of an excerpt: what kind of thing it was, which repo it
 * belongs to, when it was last touched. Whatever is unknown is left out rather
 * than shown as a placeholder.
 */
export function describeOrigin(snippet: MemorySnippet): string {
  return [snippet.sourceKind.replace(/_/g, ' '), snippet.repo, snippet.updatedAt?.slice(0, 10)]
    .filter(Boolean)
    .join(' · ');
}

/** Collapse an excerpt to a single line of at most `max` characters. */
export function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The selectable encoders, mirrored from `@fleex/shared`'s catalogue.
 *
 * Deliberately a copy rather than an import. `@fleex/shared` resolves to its
 * *built* `dist/` at runtime, and the CLI loads every command module at startup —
 * so a value imported from it here turns a stale build into a CLI that cannot
 * start, including the `self-update` that would rebuild it. Types are safe to
 * import (they are erased); values are not.
 *
 * Same reasoning as the two lists below: at this boundary the CLI is a contract,
 * and a rename upstream should break this build rather than a user's terminal.
 */
export const CLI_EMBEDDING_MODELS = [
  { id: 'Xenova/multilingual-e5-small', label: 'multilingual-e5-small', dimensions: 384 },
  { id: 'Xenova/multilingual-e5-base', label: 'multilingual-e5-base', dimensions: 768 },
  { id: 'onnx-community/embeddinggemma-300m-ONNX', label: 'EmbeddingGemma-300M', dimensions: 768 },
] as const;

/** The encoder used when nothing is configured. */
export const CLI_DEFAULT_EMBEDDING_MODEL = CLI_EMBEDDING_MODELS[0];

/**
 * The switchable features that consume the index — the same set the Settings
 * panel lists, in the same order.
 *
 * Duplicated from the server's `MEMORY_FEATURE_KEYS` rather than imported: a key
 * added here and not there is silently accepted by `--enable` and ignored by the
 * server. Keep the two in step.
 */
export const MEMORY_FEATURE_KEYS = [
  'paletteSearch',
  'ask',
  'repoScope',
  'duplicateDetection',
  'humanFeedbackBoost',
  'personaCoach',
  'synthesis',
  'curation',
  'assistantMemory',
  'automationMining',
  'relatedNotes',
  'executionTraces',
  'cliSessions',
] as const;

/**
 * The source kinds a `--kind` filter accepts.
 *
 * Listed explicitly rather than derived, because the CLI is a contract: an
 * accidental rename in the domain enum should break this build, not silently
 * change what a documented flag accepts.
 */
export const MEMORY_SOURCE_KINDS = [
  'ticket',
  'comment_thread',
  'deliverable',
  'ticket_summary',
  'cli_session_summary',
  'scratchpad',
  'persona',
  'skill',
  'epic',
  'execution_trace',
  'qa_pair',
  'curated_note',
  'assistant_conversation',
] as const;
