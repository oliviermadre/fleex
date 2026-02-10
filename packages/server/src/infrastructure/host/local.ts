import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fsp from 'node:fs/promises';
import type { ExecFn, ShellExecFn, HostFs } from './types.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const localExec: ExecFn = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
  });
  return { stdout, stderr };
};

export const localShellExec: ShellExecFn = async (command, options) => {
  const { stdout, stderr } = await execAsync(command, {
    cwd: options?.cwd,
    timeout: options?.timeout,
  });
  return { stdout, stderr };
};

export class LocalHostFs implements HostFs {
  async readFile(path: string): Promise<string> {
    return fsp.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fsp.writeFile(path, content, 'utf-8');
  }

  async readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    const dirents = await fsp.readdir(path, { withFileTypes: true });
    return dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
    }));
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const stat = await fsp.stat(path);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
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
    await fsp.rm(path, { recursive: options?.recursive ?? false });
  }

  async readTail(path: string, bytes: number): Promise<string> {
    const handle = await fsp.open(path, 'r');
    try {
      const stat = await handle.stat();
      const fileSize = stat.size;
      if (fileSize === 0) return '';

      const readStart = Math.max(0, fileSize - bytes);
      const readLength = fileSize - readStart;
      const buffer = Buffer.alloc(readLength);
      await handle.read(buffer, 0, readLength, readStart);
      return buffer.toString('utf-8');
    } finally {
      await handle.close();
    }
  }
}
