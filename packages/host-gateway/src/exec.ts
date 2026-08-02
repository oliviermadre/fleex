import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logInfo, logDebug } from './logger';
import {
  ValidationError,
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
} from './validation';

const execFileAsync = promisify(execFile);

interface ExecRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean;
}

/** Validates an untrusted `/exec` body. Throws {@link ValidationError} on any bad field. */
function parseExecRequest(raw: unknown): ExecRequest {
  const body = asRecord(raw);

  const command = requireString(body['command'], 'command');
  if (command.length === 0) {
    throw new ValidationError('"command" must not be empty');
  }

  return {
    command,
    args: optionalStringArray(body['args'], 'args') ?? [],
    cwd: optionalString(body['cwd'], 'cwd'),
    timeout: optionalNumber(body['timeout'], 'timeout'),
    maxBuffer: optionalNumber(body['maxBuffer'], 'maxBuffer'),
    shell: optionalBoolean(body['shell'], 'shell'),
  };
}

interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** High-frequency polling commands logged only at -vv */
function isPollingCommand(command: string, args: string[], shell?: boolean): boolean {
  if (shell) {
    if (/^(ps|pgrep|lsof)\b/.test(command)) return true;
    if (/^tmux\s+(list-panes|list-sessions)\b/.test(command)) return true;
    return false;
  }
  if (command === 'tmux' && (args[0] === 'list-panes' || args[0] === 'list-sessions')) return true;
  if (command === 'ps' || command === 'pgrep') return true;
  if (command === 'lsof') return true;
  return false;
}

export async function handleExec(raw: unknown): Promise<ExecResponse> {
  const {
    command,
    args,
    cwd,
    timeout = 30_000,
    maxBuffer = 10 * 1024 * 1024,
    shell,
  } = parseExecRequest(raw);

  const line = `[exec] ${shell ? 'shell' : 'exec'} ${command} ${shell ? '' : JSON.stringify(args)} ${cwd ?? ''}`.trimEnd();
  if (isPollingCommand(command, args, shell)) {
    logDebug(line);
  } else {
    logInfo(line);
  }

  if (shell) {
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
