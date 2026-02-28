import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { checkPathAllowed, getPolicy } from './security-policy';
import { audit } from './audit-log';

type FsRequest =
  | { op: 'read'; path: string }
  | { op: 'write'; path: string; content: string }
  | { op: 'readdir'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'exists'; path: string }
  | { op: 'mkdir'; path: string }
  | { op: 'rm'; path: string; recursive?: boolean }
  | { op: 'readTail'; path: string; bytes: number };

function classifyOp(op: string): 'read' | 'write' | 'delete' {
  if (op === 'rm') return 'delete';
  if (op === 'write' || op === 'mkdir') return 'write';
  return 'read';
}

export async function handleFs(body: FsRequest): Promise<unknown> {
  // ── Security policy check ──
  if ('path' in body && body.path) {
    const opType = classifyOp(body.op);
    const check = checkPathAllowed(body.path, opType);
    if (!check.allowed) {
      const policy = getPolicy();
      if (policy.auditLog) {
        await audit({
          type: 'fs',
          action: body.op,
          details: { path: body.path, opType },
          result: 'denied',
          reason: check.reason,
        });
      }
      throw new Error(`Security policy violation: ${check.reason}`);
    }

    const policy = getPolicy();
    if (policy.auditLog && opType !== 'read') {
      await audit({
        type: 'fs',
        action: body.op,
        details: { path: body.path, opType },
        result: 'allowed',
      });
    }
  }

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
