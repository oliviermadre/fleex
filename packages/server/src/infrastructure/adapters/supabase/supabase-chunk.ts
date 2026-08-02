/**
 * PostgREST encodes `.in('col', ids)` into the query string
 * (`?col=in.(uuid,uuid,...)`). The Kong/nginx sitting in front of Supabase caps
 * a request line at ~8 KB, so ~200 UUIDs is the practical ceiling — past that
 * the request dies with a 414 before reaching PostgREST.
 *
 * Bulk ticket callers (the cockpit's unread counts) pass every ticket in the
 * instance, so the ID list has to be split into batches (#509).
 */
export const IN_CLAUSE_CHUNK_SIZE = 200;

export function chunkIds(ids: string[], size = IN_CLAUSE_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}
