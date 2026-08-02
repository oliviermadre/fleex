const FILE_URL_PATTERN = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

/**
 * Collect the ids of uploaded files referenced by `/api/files/<uuid>` URLs in a
 * blob of markdown (ticket description, comment bodies…). Used to garbage-collect
 * attachments when their ticket is deleted.
 */
export function extractFileIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(FILE_URL_PATTERN)) {
    ids.add(match[1]!);
  }
  return Array.from(ids);
}
