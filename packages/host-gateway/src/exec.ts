import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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
    // Shell mode: command is the full shell string, args is ignored
    // Use zsh so the user's full PATH and environment are available
    try {
      const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-l', '-c', command], {
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
