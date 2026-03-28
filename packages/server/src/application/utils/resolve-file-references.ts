import type { TextBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import type { FileMetaStorePort } from '../ports/file-meta-store.port.js';
import type { FileStorePort } from '../ports/file-store.port.js';

export type PromptContentBlock = TextBlockParam | ImageBlockParam;

// Max image size to inline as base64 (larger images get a text placeholder)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (API limit per image)

// Max text file size to inline
const MAX_TEXT_BYTES = 100 * 1024; // 100 KB

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Matches ![alt](/api/files/{uuid}) or [text](/api/files/{uuid})
const FILE_REF_PATTERN = /(!?)\[([^\]]*)\]\(\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/**
 * Converts a markdown string containing `/api/files/{uuid}` references into
 * an array of content blocks suitable for the Anthropic Messages API.
 *
 * - Images → ImageBlockParam (base64, native multimodal)
 * - Text files (txt, csv) → TextBlockParam with content inline
 * - Other types → TextBlockParam with metadata placeholder
 * - Plain text segments between file references → TextBlockParam
 */
export async function resolveFileReferences(
  text: string,
  fileMetaStore: FileMetaStorePort,
  fileStore: FileStorePort,
): Promise<PromptContentBlock[]> {
  if (!text.includes('/api/files/')) {
    return [{ type: 'text', text }];
  }

  const blocks: PromptContentBlock[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FILE_REF_PATTERN)) {
    const matchStart = match.index!;
    const matchEnd = matchStart + match[0].length;

    // Push text before this match
    if (matchStart > lastIndex) {
      blocks.push({ type: 'text', text: text.slice(lastIndex, matchStart) });
    }
    lastIndex = matchEnd;

    const alt = match[2]!;
    const fileId = match[3]!;

    const meta = await fileMetaStore.getById(fileId);
    if (!meta) {
      // File not found — keep original markdown
      blocks.push({ type: 'text', text: match[0] });
      continue;
    }

    if (IMAGE_MIME_TYPES.has(meta.mimeType) && meta.sizeBytes <= MAX_IMAGE_BYTES) {
      const buffer = await fileStore.getBuffer(fileId);
      if (buffer) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: meta.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: buffer.toString('base64'),
          },
        });
        continue;
      }
    }

    if (meta.mimeType === 'text/plain' || meta.mimeType === 'text/csv') {
      const buffer = await fileStore.getBuffer(fileId);
      if (buffer) {
        let content = buffer.toString('utf-8');
        if (buffer.length > MAX_TEXT_BYTES) {
          content = content.slice(0, MAX_TEXT_BYTES) + '\n... (truncated)';
        }
        const ext = meta.mimeType === 'text/csv' ? 'csv' : '';
        blocks.push({ type: 'text', text: `**${meta.originalName}:**\n\`\`\`${ext}\n${content}\n\`\`\`` });
        continue;
      }
    }

    // Fallback: textual description for unsupported/large files
    const sizeKB = Math.round(meta.sizeBytes / 1024);
    blocks.push({ type: 'text', text: `[Attachment: ${meta.originalName} (${meta.mimeType}, ${sizeKB} KB)]` });
  }

  // Push remaining text after last match
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return blocks;
}
