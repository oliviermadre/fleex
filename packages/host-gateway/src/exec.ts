import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logInfo, logDebug } from './logger';
import { checkCommandAllowed, getPolicy } from './security-policy';
import { audit } from './audit-log';

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
  denied?: boolean;
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

export async function handleExec(body: ExecRequest): Promise<ExecResponse> {
  const { command, args = [], cwd, timeout = 30_000, maxBuffer = 10 * 1024 * 1024, shell } = body;

  // ── Security policy check ──
  const policy = getPolicy();
  const check = checkCommandAllowed(command, args, shell);
  const cappedTimeout = Math.min(timeout, policy.maxCommandTimeoutMs);

  if (!check.allowed) {
    if (policy.auditLog) {
      await audit({
        type: 'exec',
        action: shell ? 'shell' : 'exec',
        details: { command, args, cwd, shell },
        result: 'denied',
        reason: check.reason,
      });
    }
    logInfo(`[exec] DENIED: ${command} — ${check.reason}`);
    return {
      stdout: '',
      stderr: `Security policy violation: ${check.reason}`,
      exitCode: 126,
      denied: true,
    };
  }

  const line = `[exec] ${shell ? 'shell' : 'exec'} ${command} ${shell ? '' : JSON.stringify(args)} ${cwd ?? ''}`.trimEnd();
  if (isPollingCommand(command, args, shell)) {
    logDebug(line);
  } else {
    logInfo(line);
    if (policy.auditLog) {
      await audit({
        type: 'exec',
        action: shell ? 'shell' : 'exec',
        details: { command, args, cwd, shell },
        result: 'allowed',
      });
    }
  }

  if (shell) {
    try {
      const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-il', '-c', command], {
        cwd,
        timeout: cappedTimeout,
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
      timeout: cappedTimeout,
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
