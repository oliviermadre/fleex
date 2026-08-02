import type { ExecFn, ShellExecFn, HostFs } from './types.js';

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * The gateway answers 401/403 with a JSON body, but the failure is about
 * credentials, not about the call itself — surface it as such instead of
 * letting the caller trip over a missing `stdout`.
 */
function assertAuthorized(res: Response): void {
  if (res.status === 401) {
    throw new Error(
      `Gateway rejected the token (401). Run 'fleex doctor' then 'fleex restart'.`,
    );
  }
  if (res.status === 403) {
    throw new Error(`Gateway refused the request (403 forbidden_origin).`);
  }
}

export function remoteExec(gatewayUrl: string, token: string): ExecFn {
  return async (command, args, options) => {
    const res = await fetch(`${gatewayUrl}/exec`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        command,
        args,
        cwd: options?.cwd,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      }),
    });
    assertAuthorized(res);
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

export function remoteShellExec(gatewayUrl: string, token: string): ShellExecFn {
  return async (command, options) => {
    const res = await fetch(`${gatewayUrl}/exec`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        command,
        args: [],
        shell: true,
        cwd: options?.cwd,
        timeout: options?.timeout,
      }),
    });
    assertAuthorized(res);
    const data = await res.json() as { stdout: string; stderr: string; exitCode: number; error?: string };
    if (data.error) throw new Error(data.error);
    // Shell exec: don't throw on non-zero exit — callers handle stderr
    return { stdout: data.stdout, stderr: data.stderr };
  };
}

export class RemoteHostFs implements HostFs {
  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
  ) {}

  private async call(body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.gatewayUrl}/fs`, {
      method: 'POST',
      headers: authHeaders(this.token),
      body: JSON.stringify(body),
    });
    assertAuthorized(res);
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
