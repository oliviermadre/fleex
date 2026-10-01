import http from 'node:http';
import https from 'node:https';
import type { ExecFn, ShellExecFn, HostFs } from './types.js';

/**
 * POST JSON and parse the JSON answer, with no headers/body timeout of its own.
 *
 * The gateway only answers `/exec` once the command exits, and actions may run
 * up to ACTION_MAX_TIMEOUT_SEC (30 min). Global `fetch` (undici under Node)
 * aborts when response headers take more than 300 s, so a long action would
 * fail although it still runs. `node:http` has no such default (Bun's
 * implementation doesn't either); the command's own `timeout`, enforced by the
 * gateway, bounds the wait instead.
 */
export function postJsonNoTimeout(url: string, body: unknown): Promise<unknown> {
  const target = new URL(url);
  const payload = JSON.stringify(body);
  const request = target.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 0,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

export function remoteExec(gatewayUrl: string): ExecFn {
  return async (command, args, options) => {
    const res = await fetch(`${gatewayUrl}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        args,
        cwd: options?.cwd,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      }),
    });
    const data = await res.json() as { stdout: string; stderr: string; exitCode: number; error?: string };
    if (data.error) throw new Error(data.error);
    if (data.exitCode !== 0) {
      const err = new Error(data.stderr || `Command failed: ${command} ${args.join(' ')}`) as any;
      err.stdout = data.stdout;
      err.stderr = data.stderr;
      err.code = data.exitCode;
      throw err;
    }
    return { stdout: data.stdout, stderr: data.stderr };
  };
}

export function remoteShellExec(gatewayUrl: string): ShellExecFn {
  return async (command, options) => {
    // Not `fetch`: see postJsonNoTimeout — an action may legitimately run for 30 min.
    const data = await postJsonNoTimeout(`${gatewayUrl}/exec`, {
      command,
      args: [],
      shell: true,
      cwd: options?.cwd,
      timeout: options?.timeout,
    }) as { stdout: string; stderr: string; exitCode: number; timedOut?: boolean; error?: string };
    if (data.error) throw new Error(data.error);
    // Shell exec: don't throw on non-zero exit — callers read exitCode / stderr
    return {
      stdout: data.stdout,
      stderr: data.stderr,
      exitCode: typeof data.exitCode === 'number' ? data.exitCode : 0,
      ...(data.timedOut ? { timedOut: true } : {}),
    };
  };
}

export class RemoteHostFs implements HostFs {
  constructor(private readonly gatewayUrl: string) {}

  private async call(body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.gatewayUrl}/fs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data && typeof data === 'object' && 'error' in data) {
      throw new Error((data as any).error);
    }
    return data;
  }

  async readFile(path: string): Promise<string> {
    const data = await this.call({ op: 'read', path });
    return data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.call({ op: 'write', path, content });
  }

  async appendFile(path: string, content: string): Promise<void> {
    await this.call({ op: 'append', path, content });
  }

  async readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    const data = await this.call({ op: 'readdir', path });
    return data.entries;
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    return this.call({ op: 'stat', path });
  }

  async exists(path: string): Promise<boolean> {
    const data = await this.call({ op: 'exists', path });
    return data.exists;
  }

  async mkdir(path: string): Promise<void> {
    await this.call({ op: 'mkdir', path });
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.call({ op: 'rm', path, recursive: options?.recursive ?? false });
  }

  async readTail(path: string, bytes: number): Promise<string> {
    const data = await this.call({ op: 'readTail', path, bytes });
    return data.content;
  }
}
