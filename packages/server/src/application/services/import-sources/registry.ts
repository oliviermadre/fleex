import type { ImportSourceId } from '@fleex/shared';
import type { ImportSourceAdapter } from '../../ports/import-source.port.js';

/**
 * Server-side registry of import adapters, keyed by source id — the mirror of
 * `NativeOperationRegistry` for import sources. The adapters carry runtime
 * dependencies (the GitHub GraphQL client, the Slack import port), so the list
 * is always injected by the container rather than defaulted here.
 *
 * Adding a source = build its adapter in the container and add it to the list
 * passed here; the shared descriptor (`packages/shared/src/sources`) provides
 * the matching detection.
 */
export class ImportSourceRegistry {
  private readonly byId: Map<ImportSourceId, ImportSourceAdapter>;

  constructor(adapters: readonly ImportSourceAdapter[]) {
    this.byId = new Map(adapters.map((a) => [a.id, a]));
  }

  get(id: ImportSourceId): ImportSourceAdapter | undefined {
    return this.byId.get(id);
  }

  has(id: ImportSourceId): boolean {
    return this.byId.has(id);
  }

  ids(): ImportSourceId[] {
    return [...this.byId.keys()];
  }
}
