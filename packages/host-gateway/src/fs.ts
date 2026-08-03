import * as fsp from 'node:fs/promises';

import {
  ValidationError,
  asRecord,
  optionalBoolean,
  requireNumber,
  requireString,
} from './validation';

export type FsRequest =
  | { op: 'read'; path: string }
  | { op: 'write'; path: string; content: string }
  | { op: 'readdir'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'exists'; path: string }
  | { op: 'mkdir'; path: string }
  | { op: 'rm'; path: string; recursive?: boolean }
  | { op: 'readTail'; path: string; bytes: number };

const FS_OPS = ['read', 'write', 'readdir', 'stat', 'exists', 'mkdir', 'rm', 'readTail'] as const;

type FsOp = (typeof FS_OPS)[number];

function isFsOp(value: unknown): value is FsOp {
  return typeof value === 'string' && (FS_OPS as readonly string[]).includes(value);
}

/** Validates an untrusted `/fs` body. Throws {@link ValidationError} on any bad field. */
function parseFsRequest(raw: unknown): FsRequest {
  const body = asRecord(raw);

  const op = body['op'];
  if (!isFsOp(op)) {
    throw new ValidationError(`"op" must be one of: ${FS_OPS.join(', ')}`);
  }

  const path = requireString(body['path'], 'path');

  switch (op) {
    case 'write':
      return { op, path, content: requireString(body['content'], 'content') };
    case 'rm':
      return { op, path, recursive: optionalBoolean(body['recursive'], 'recursive') };
    case 'readTail':
      return { op, path, bytes: requireNumber(body['bytes'], 'bytes') };
    default:
      return { op, path };
  }
}

export async function handleFs(raw: unknown): Promise<unknown> {
  const body = parseFsRequest(raw);

  switch (body.op) {
    case 'read': {
      const content = await fsp.readFile(body.path, 'utf-8');
      return { content };
    }

    case 'write': {
      await fsp.writeFile(body.path, body.content, 'utf-8');
      return { ok: true };
    }

    case 'readdir': {
      const dirents = await fsp.readdir(body.path, { withFileTypes: true });
      const entries = dirents.map((d) => ({
        name: d.name,
        isFile: d.isFile(),
        isDirectory: d.isDirectory(),
      }));
      return { entries };
    }

    case 'stat': {
      try {
        const stat = await fsp.stat(body.path);
        return { size: stat.size, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    }

    case 'exists': {
      try {
        await fsp.access(body.path);
        return { exists: true };
      } catch {
        return { exists: false };
      }
    }

    case 'mkdir': {
      await fsp.mkdir(body.path, { recursive: true });
      return { ok: true };
    }

    case 'rm': {
      await fsp.rm(body.path, { recursive: body.recursive ?? false });
      return { ok: true };
    }

    case 'readTail': {
      const handle = await fsp.open(body.path, 'r');
      try {
        const stat = await handle.stat();
        const fileSize = stat.size;
        if (fileSize === 0) return { content: '' };

        const readStart = Math.max(0, fileSize - body.bytes);
        const readLength = fileSize - readStart;
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, readStart);
        return { content: buffer.toString('utf-8') };
      } finally {
        await handle.close();
      }
    }

    default:
      throw new Error(`Unknown fs operation: ${(body as any).op}`);
  }
}
