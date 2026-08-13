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
 * The switchable features that consume the index — the same set the Settings
 * panel lists, in the same order.
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
  'wikiLinks',
  'executionTraces',
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
] as const;
