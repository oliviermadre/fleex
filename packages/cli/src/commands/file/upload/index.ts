import fs from 'node:fs';
import path from 'node:path';
import type { CommandDef } from '../../../core/types.ts';
import { die, ok, present, info } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
};

interface Uploaded { id: string; url: string; originalName: string; mimeType: string; sizeBytes: number }

const def: CommandDef = {
  workspaceAware: true,
  name: 'upload',
  description: 'Upload a file (max 10 MB) and print the Markdown to embed it: ![alt](/api/files/<id>)',
  setup(cmd) {
    cmd.argument('<path>', 'File to upload (image, PDF, text…)');
    cmd.option('--alt <text>', 'Alt text for the Markdown snippet (default: the file name)');
  },
  action: async (filePath: string, opts: { alt?: string }) => {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return die(`File not found: ${abs}`);
    const name = path.basename(abs);
    const type = MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(abs)], { type }), name);

    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/files`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      return die(`Upload failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error ?? text; } catch { /* raw body */ }
      return die(`Upload refused (HTTP ${res.status}): ${msg}`);
    }
    const file = JSON.parse(text) as Uploaded;
    const isImage = file.mimeType.startsWith('image/');
    const markdown = isImage ? `![${opts.alt ?? name}](${file.url})` : `[${opts.alt ?? name}](${file.url})`;
    present({ ...file, markdown }, () => {
      ok(`Uploaded ${name} (${Math.round(file.sizeBytes / 1024)} KB, ${file.mimeType}) → ${file.id}`);
      info('Embed it in a deliverable or a comment:');
      process.stdout.write(`${markdown}\n`);
    });
  },
};

export default def;
