import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ExecRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean;
}

interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function handleExec(body: ExecRequest): Promise<ExecResponse> {
  const { command, args = [], cwd, timeout = 30_000, maxBuffer = 10 * 1024 * 1024, shell } = body;

  console.log('[exec]', shell ? 'shell' : 'exec', command, shell ? '' : JSON.stringify(args), cwd ?? '');

  if (shell) {
    try {
      const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-il', '-c', command], {
        cwd,
        timeout,
        maxBuffer,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message,
        exitCode: err.code ?? 1,
      };
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message,
      exitCode: err.code ?? 1,
    };
  }
}
