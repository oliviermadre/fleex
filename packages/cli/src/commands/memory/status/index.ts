import type { CommandDef } from '../../../core/types.ts';
import { apiGet } from '../../../core/api.ts';
import { info, present, warn } from '../../../core/colors.ts';
import { renderTable } from '../../../core/agentic.ts';
import { memoryApi } from '../_shared.ts';

interface MemoryStatusResponse {
  engine: 'legacy' | 'semantic';
  available: boolean;
  reason?: string;
  provider: { id: string; dimensions: number; ready: boolean; installed: boolean; packageName: string } | null;
  index: {
    totalChunks: number;
    pendingEmbeddings: number;
    chunksByKind: Record<string, number>;
    embeddingModels: string[];
    lastIndexedAt: string | null;
  } | null;
  reindexing: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'status',
  aliases: ['st'],
  description: 'Report which context engine is active and what the memory index holds',
  action: async () => {
    const res = await apiGet<MemoryStatusResponse>(memoryApi('/status'));

    present(res, () => {
      info(`Engine: ${res.engine}${res.engine === 'legacy' ? ' (tag and recency ranking)' : ' (semantic retrieval)'}`);

      if (!res.available) {
        warn(res.reason ?? 'No memory index is available on this storage driver.');
        return;
      }

      if (res.provider && !res.provider.installed) {
        warn(`Local embeddings need an optional package: bun add ${res.provider.packageName}`);
      } else if (res.provider && !res.provider.ready) {
        info('Embedding model not loaded yet — it is fetched once, on the first indexing run.');
      }

      const index = res.index;
      if (!index || index.totalChunks === 0) {
        info('Index is empty. Run `fleex memory reindex` to populate it.');
        return;
      }

      const rows = Object.entries(index.chunksByKind)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => [kind.replace(/_/g, ' '), String(count)]);
      renderTable(['SOURCE', 'CHUNKS'], rows);

      info(`${index.totalChunks} chunk(s) total${index.pendingEmbeddings > 0 ? `, ${index.pendingEmbeddings} awaiting embedding` : ''}`);
      if (index.lastIndexedAt) info(`Last indexed: ${index.lastIndexedAt}`);
      // Vectors from different models do not share a space, so a mixed index
      // silently degrades retrieval until it is rebuilt.
      if (index.embeddingModels.length > 1) {
        warn(`Index holds vectors from ${index.embeddingModels.length} models (${index.embeddingModels.join(', ')}) — reindex to make retrieval trustworthy.`);
      }
      if (res.reindexing) info('A reindex is running.');
    });
  },
};

export default def;
