import * as fsp from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostFs } from '../../src/infrastructure/host/types.js';

/**
 * A real, local `HostFs`. Mirrors the host-gateway's `handleFs` semantics
 * exactly (see packages/host-gateway/src/fs.ts) so integration tests exercise
 * the same behaviour the server sees in production, minus the HTTP hop.
 *
 * Why not `FakeHostFs` from ./fakes.ts? Because the JSON migration runner
 * writes `_migrations.json` through `node:fs` directly — an in-memory fake
 * would silently diverge from what the stores then read back.
 */
export class NodeHostFs implements HostFs {
  async readFile(path: string): Promise<string> {
    return fsp.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fsp.writeFile(path, content, 'utf-8');
  }

  async appendFile(path: string, content: string): Promise<void> {
    await fsp.appendFile(path, content, 'utf-8');
  }

  async readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    const dirents = await fsp.readdir(path, { withFileTypes: true });
    return dirents.map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory() }));
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const s = await fsp.stat(path);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await fsp.mkdir(path, { recursive: true });
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fsp.rm(path, { recursive: options?.recursive ?? false, force: true });
  }

  async readTail(path: string, bytes: number): Promise<string> {
    const handle = await fsp.open(path, 'r');
    try {
      const { size } = await handle.stat();
      if (size === 0) return '';
      const start = Math.max(0, size - bytes);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return buffer.toString('utf-8');
    } finally {
      await handle.close();
    }
  }
}

export interface TempHome {
  home: string;
  dispose(): Promise<void>;
}

/** An isolated `$HOME` for one test. Everything the JSON driver writes lands here. */
export async function makeTempHome(): Promise<TempHome> {
  const home = await mkdtemp(join(tmpdir(), 'fleex-http-test-'));
  return {
    home,
    dispose: async () => {
      await rm(home, { recursive: true, force: true });
    },
  };
}
