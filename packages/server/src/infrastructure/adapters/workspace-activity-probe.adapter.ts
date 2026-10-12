import type { WorkspaceActivityProbe } from '../../application/ports/workspace-activity-probe.port.js';
import type { ExecFn } from '../host/types.js';

/**
 * tmux + lsof through the host gateway's exec, so it sees the host's panes and
 * processes even when the server runs in a container.
 */
export class ExecWorkspaceActivityProbe implements WorkspaceActivityProbe {
  constructor(private readonly execFn: ExecFn) {}

  async panePaths(): Promise<string[]> {
    try {
      const { stdout } = await this.execFn('tmux', ['list-panes', '-a', '-F', '#{pane_current_path}'], { timeout: 10_000 });
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch (err) {
      // No tmux server running (or tmux not installed) means no pane can hold a worktree.
      const msg = err instanceof Error ? err.message : String(err);
      if (/no server running|error connecting|ENOENT|not found/i.test(msg)) return [];
      throw err;
    }
  }

  async processCwds(): Promise<{ pid: number; command?: string; cwd: string }[]> {
    let stdout: string;
    try {
      ({ stdout } = await this.execFn('lsof', ['-d', 'cwd', '-F', 'pcn'], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }));
    } catch (err) {
      // lsof exits 1 when it could not inspect some processes (other users'):
      // what it did print is still a complete list of the processes we can see.
      const partial = (err as { stdout?: string }).stdout;
      if (!partial) throw err;
      stdout = partial;
    }
    return parseLsofCwds(stdout);
  }
}

/** Parse `lsof -F pcn` field output: `p<pid>` starts a process, `c<cmd>`, `n<path>`. */
export function parseLsofCwds(stdout: string): { pid: number; command?: string; cwd: string }[] {
  const out: { pid: number; command?: string; cwd: string }[] = [];
  let pid = 0;
  let command: string | undefined;
  for (const line of stdout.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') { pid = Number(value); command = undefined; }
    else if (tag === 'c') command = value;
    else if (tag === 'n' && pid) out.push({ pid, command, cwd: value });
  }
  return out;
}
