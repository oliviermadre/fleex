import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';

import type { FileMetaStorePort } from '../ports/file-meta-store.port.js';
import type { FileStorePort } from '../ports/file-store.port.js';
import type {
  TextBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages';

export type PromptContentBlock = TextBlockParam | ImageBlockParam;

// Max image size to materialize on disk for the agent to Read.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB (API limit per image)

// Max text file size to inline
const MAX_TEXT_BYTES = 100 * 1024; // 100 KB

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// Where materialized prompt images are written for the agent's Read tool.
const ATTACHMENTS_DIR = join(homedir(), FLEEX_DIR, 'files', 'prompt-attachments');

/**
 * Write an image blob to a local file and return its absolute path, so the
 * prompt can reference it by path instead of inlining base64.
 *
 * Why not inline base64: an image turns the prompt into a content-block array,
 * which the SDK streams to the CLI over stdin as one huge stream-json line. The
 * CLI's stdin parser truncates large lines and crashes ("exited with code 1").
 * Referencing a file keeps the prompt a plain string and lets the agent load the
 * image via its Read tool. Returns null on any failure (caller falls back).
 */
async function materializeImage(
  fileId: string,
  mimeType: string,
  fileStore: FileStorePort,
): Promise<string | null> {
  try {
    const buffer = await fileStore.getBuffer(fileId);
    if (!buffer) return null;
    await mkdir(ATTACHMENTS_DIR, { recursive: true });
    const ext = IMAGE_EXT_BY_MIME[mimeType] ?? 'bin';
    const path = join(ATTACHMENTS_DIR, `${fileId}.${ext}`);
    await writeFile(path, buffer);
    return path;
  } catch {
    return null;
  }
}

/**
 * True when any block references a materialized image attachment (see
 * `materializeImage`). Since images are emitted as a text pointer, not an
 * image block, callers use this to know the prompt carries an image the agent
 * must open with Read — e.g. talk mode must then enable the Read tool.
 */
export function promptHasImageAttachment(blocks: PromptContentBlock[]): boolean {
  return blocks.some((b) => b.type === 'text' && b.text.includes(ATTACHMENTS_DIR));
}

// Matches ![alt](/api/files/{uuid}) or [text](/api/files/{uuid})
const FILE_REF_PATTERN =
  /(!?)\[([^\]]*)\]\(\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

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
      // Materialize the image to a local file and reference it by path (see
      // materializeImage) rather than inlining base64, which would crash the CLI.
      const localPath = await materializeImage(fileId, meta.mimeType, fileStore);
      if (localPath) {
        blocks.push({
          type: 'text',
          text: `[Image attachment "${meta.originalName}" (${meta.mimeType}) saved at ${localPath} — use the Read tool on this path to view it.]`,
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
        blocks.push({
          type: 'text',
          text: `**${meta.originalName}:**\n\`\`\`${ext}\n${content}\n\`\`\``,
        });
        continue;
      }
    }

    // Fallback: textual description for unsupported/large files
    const sizeKB = Math.round(meta.sizeBytes / 1024);
    blocks.push({
      type: 'text',
      text: `[Attachment: ${meta.originalName} (${meta.mimeType}, ${sizeKB} KB)]`,
    });
  }

  // Push remaining text after last match
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return blocks;
}
