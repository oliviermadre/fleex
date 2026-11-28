/**
 * Artefacts: the files a conversation produces in its folder.
 *
 * After each Write / Edit / NotebookEdit / Bash call the folder is scanned for
 * files created or modified since the call started; each becomes a card the
 * user can open or attach to a ticket as a deliverable. Files written outside
 * the folder never become cards.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Tools whose end triggers a scan of the folder. */
export const PRODUCING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);

const SKIPPED_DIRS = new Set(['node_modules', '__pycache__', '.venv']);
export const SCRIPT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.py', '.sh', '.rb', '.go']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp']);
const BINARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.pdf', '.zip', '.gz', '.tar', '.tgz', '.xlsx', '.docx', '.pptx', '.mp4', '.mov', '.mp3', '.wav']);
/** Deliverables are text: larger files are not attachable. */
export const MAX_ATTACH_BYTES = 1024 * 1024;
const PREVIEW_BYTES = 64 * 1024;
/** Cards shown per turn before grouping the rest under "+ N autres fichiers". */
export const MAX_CARDS_PER_TURN = 10;

export interface Attachment {
  ticketId: string;
  displayId: string;
  url?: string;
}

export interface ArtifactCard {
  path: string;
  relPath: string;
  name: string;
  /** `script` gets a one-line card, `full` a card with a preview. */
  kind: 'script' | 'full';
  mime: string;
  sizeBytes: number;
  preview?: ArtifactPreview;
  attachable: boolean;
  attachments: Attachment[];
  /** Set on an older card when a later turn modified the file again. */
  modifiedSince?: boolean;
}

export type ArtifactPreview =
  | { type: 'csv'; rows: string[][] }
  | { type: 'markdown'; text: string }
  | { type: 'html'; html: string }
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };

/** Files under `dir` modified at or after `sinceMs`, hidden and dependency folders skipped. */
export function changedFiles(dir: string, sinceMs: number): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIPPED_DIRS.has(e.name)) walk(full, depth + 1);
      } else if (e.isFile()) {
        try {
          if (fs.statSync(full).mtimeMs >= sinceMs) out.push(full);
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(dir, 0);
  return out.sort();
}

function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };
  return map[ext] ?? (SCRIPT_EXTENSIONS.has(ext) ? 'text/x-script' : 'application/octet-stream');
}

/** Parse the first `rows` CSV lines (quotes handled, enough for a preview). */
export function csvHead(text: string, rows = 5): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (out.length >= rows) break;
    if (!line) continue;
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

function headText(file: string): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(PREVIEW_BYTES);
    const n = fs.readSync(fd, buf, 0, PREVIEW_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n');
}

function preview(file: string, ext: string, size: number): ArtifactPreview | undefined {
  try {
    if (IMAGE_EXTENSIONS.has(ext)) {
      if (size > PREVIEW_BYTES * 8) return undefined;
      return { type: 'image', dataUrl: `data:${mimeOf(ext)};base64,${fs.readFileSync(file).toString('base64')}` };
    }
    if (BINARY_EXTENSIONS.has(ext)) return undefined;
    const text = headText(file);
    if (ext === '.csv') return { type: 'csv', rows: csvHead(text) };
    if (ext === '.md') return { type: 'markdown', text: firstLines(text, 30) };
    if (ext === '.html' || ext === '.htm') return { type: 'html', html: text };
    if (ext === '.json' || ext === '.txt') return { type: 'text', text: firstLines(text, 20) };
    return undefined;
  } catch {
    return undefined;
  }
}

/** Deliverable type for an attached file (P16): html, code for scripts, report otherwise. */
export function deliverableTypeFor(file: string): 'html' | 'code' | 'report' {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (SCRIPT_EXTENSIONS.has(ext)) return 'code';
  return 'report';
}

/** Text files up to 1 MB can become a deliverable; binaries cannot. */
export function isAttachable(file: string, sizeBytes: number): boolean {
  return !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()) && sizeBytes <= MAX_ATTACH_BYTES;
}

export function buildCard(file: string, workDir: string): ArtifactCard | null {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  const ext = path.extname(file).toLowerCase();
  const kind = SCRIPT_EXTENSIONS.has(ext) ? 'script' : 'full';
  const p = kind === 'full' ? preview(file, ext, size) : undefined;
  return {
    path: file,
    relPath: path.relative(workDir, file),
    name: path.basename(file),
    kind,
    mime: mimeOf(ext),
    sizeBytes: size,
    ...(p ? { preview: p } : {}),
    attachable: isAttachable(file, size),
    attachments: [],
  };
}

/**
 * The last ticket cited in a conversation (`#123`, `ticket 123`, a UUID), to
 * preselect in the attach picker (T5, P19). Undefined when none is cited.
 */
export function lastCitedTicket(texts: string[]): string | undefined {
  const re = /(?:#(\d{1,7})\b|\bticket\s+#?(\d{1,7})\b|\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b)/gi;
  let last: string | undefined;
  for (const t of texts) {
    for (const m of t.matchAll(re)) last = m[1] ?? m[2] ?? m[3];
  }
  return last;
}
