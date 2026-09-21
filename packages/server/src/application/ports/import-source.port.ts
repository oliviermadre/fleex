import type { ImportSourceId, ResolvedImport, SourceMatch } from '@fleex/shared';

/**
 * Resolves a detected {@link SourceMatch} into a {@link ResolvedImport} (title,
 * description, links…) by talking to the source (GitHub, Slack). One adapter per
 * source, keyed by the same `id` as the shared source descriptor. It never
 * persists anything — creation is the use-case's job.
 */
export interface ImportSourceAdapter {
  readonly id: ImportSourceId;
  resolve(match: SourceMatch, opts?: { signal?: AbortSignal }): Promise<ResolvedImport>;
}
