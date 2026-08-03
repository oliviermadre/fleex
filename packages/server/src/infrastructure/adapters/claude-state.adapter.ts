import * as path from 'node:path';

import { encodePath } from '../../domain/services/claude-path-encoding.js';

import type {
  ClaudeStatePort,
  ClaudeProcessInfo,
  ClaudeSessionFileInfo,
} from '../../application/ports/claude-state.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ShellExecFn, HostFs } from '../host/types.js';

/** CWD never changes for a running PID — cache it. */
const cwdCache = new Map<number, string>();

export class ClaudeStateAdapter implements ClaudeStatePort {
  constructor(
    private readonly shellExecFn: ShellExecFn,
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {}

  async discoverClaudeProcesses(): Promise<ClaudeProcessInfo[]> {
    try {
      const { stdout } = await this.shellExecFn('ps -eo pid,pcpu,comm', { timeout: 5000 });
      const lines = stdout.trim().split('\n').slice(1); // skip header
      const claudePids: Array<{ pid: number; cpuPercent: number }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        const parts = trimmed.split(/\s+/);
        if (parts.length < 3) continue;
        const comm = parts.slice(2).join(' ');
        // Match claude processes — the binary is typically "claude" or contains "claude"
        if (!comm.includes('claude') || comm.includes('claude-state')) continue;
        const pid = parseInt(parts[0] ?? '', 10);
        const cpuPercent = parseFloat(parts[1] ?? '');
        if (isNaN(pid) || isNaN(cpuPercent)) continue;
        claudePids.push({ pid, cpuPercent });
      }

      const results: ClaudeProcessInfo[] = [];
      for (const { pid, cpuPercent } of claudePids) {
        const cwd = await this.getCwd(pid);
        if (cwd) {
          results.push({ pid, cpuPercent, cwd });
        }
      }
      return results;
    } catch (err) {
      this.logger.debug('Failed to discover Claude processes', { error: String(err) });
      return [];
    }
  }

  async findSessionFile(cwd: string): Promise<ClaudeSessionFileInfo | null> {
    try {
      const encoded = encodePath(cwd);
      const projectDir = path.join(this.homedir, '.claude', 'projects', encoded);

      let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
      try {
        entries = await this.hostFs.readdir(projectDir);
      } catch {
        return null;
      }

      // Find most recent .jsonl not starting with "agent-"
      let newest: { name: string; mtimeMs: number } | null = null;
      for (const entry of entries) {
        if (!entry.isFile) continue;
        if (!entry.name.endsWith('.jsonl')) continue;
        if (entry.name.startsWith('agent-')) continue;
        try {
          const stat = await this.hostFs.stat(path.join(projectDir, entry.name));
          if (stat && (!newest || stat.mtimeMs > newest.mtimeMs)) {
            newest = { name: entry.name, mtimeMs: stat.mtimeMs };
          }
        } catch {
          continue;
        }
      }

      if (!newest) return null;

      const ageSeconds = (Date.now() - newest.mtimeMs) / 1000;
      return {
        path: path.join(projectDir, newest.name),
        ageSeconds,
      };
    } catch (err) {
      this.logger.debug('Failed to find session file', { cwd, error: String(err) });
      return null;
    }
  }

  async readLastMessages(filePath: string, count: number): Promise<string[]> {
    try {
      // Progressive chunk reading: start at 64KB, grow up to 1MB if no
      // meaningful (user/assistant) messages are found. Large progress messages
      // from subagents can push actual tool_use messages beyond a small window.
      const INITIAL_CHUNK = 64 * 1024;
      const MAX_CHUNK = 1024 * 1024;

      let chunkSize = INITIAL_CHUNK;
      while (chunkSize <= MAX_CHUNK) {
        const chunk = await this.hostFs.readTail(filePath, chunkSize);
        if (!chunk) return [];

        const lines = chunk.split('\n').filter((l) => l.trim().length > 0);
        const selected = lines.slice(-count);

        // Check if we captured any meaningful messages (user or assistant).
        // If not and we haven't hit the max, read a larger chunk.
        const hasMeaningful = selected.some((l) => {
          try {
            const t = JSON.parse(l).type;
            return t === 'user' || t === 'assistant';
          } catch {
            return false;
          }
        });

        if (hasMeaningful || chunkSize >= MAX_CHUNK) {
          return selected;
        }

        chunkSize *= 4;
      }

      return [];
    } catch (err) {
      this.logger.debug('Failed to read session file', { filePath, error: String(err) });
      return [];
    }
  }

  async checkPendingToolApproval(sessionFilePath: string): Promise<boolean> {
    try {
      // Session file: /.../{sessionId}.jsonl
      // Subagents dir: /.../{sessionId}/subagents/
      const sessionId = path.basename(sessionFilePath, '.jsonl');
      const subagentsDir = path.join(path.dirname(sessionFilePath), sessionId, 'subagents');

      let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
      try {
        entries = await this.hostFs.readdir(subagentsDir);
      } catch {
        return false;
      }

      // Find most recent agent-*.jsonl by modification time
      const agentEntries = entries.filter(
        (e) => e.isFile && e.name.startsWith('agent-') && e.name.endsWith('.jsonl'),
      );

      if (agentEntries.length === 0) return false;

      let newest: { name: string; mtimeMs: number } | null = null;
      for (const entry of agentEntries) {
        try {
          const stat = await this.hostFs.stat(path.join(subagentsDir, entry.name));
          if (stat && (!newest || stat.mtimeMs > newest.mtimeMs)) {
            newest = { name: entry.name, mtimeMs: stat.mtimeMs };
          }
        } catch {
          continue;
        }
      }

      if (!newest) return false;
      const latestAgent = path.join(subagentsDir, newest.name);

      const lines = await this.readLastMessages(latestAgent, 50);
      const toolUseIds = new Set<string>();
      const toolResultIds = new Set<string>();

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          const content = msg?.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (block.type === 'tool_use' && block.id) {
              toolUseIds.add(block.id);
            }
            if (block.type === 'tool_result' && block.tool_use_id) {
              toolResultIds.add(block.tool_use_id);
            }
          }
        } catch {
          continue;
        }
      }

      // If there's a tool_use without a matching tool_result, it's pending
      for (const id of toolUseIds) {
        if (!toolResultIds.has(id)) return true;
      }
      return false;
    } catch (err) {
      this.logger.debug('Failed to check pending tool approval', { error: String(err) });
      return false;
    }
  }

  private async getCwd(pid: number): Promise<string | null> {
    const cached = cwdCache.get(pid);
    if (cached) return cached;

    try {
      const { stdout } = await this.shellExecFn(
        `lsof -p ${pid} -Fn 2>/dev/null | grep '^n' | head -1`,
        {
          timeout: 3000,
        },
      );
      const line = stdout.trim();
      if (line.startsWith('n')) {
        const cwd = line.slice(1);
        cwdCache.set(pid, cwd);
        return cwd;
      }
    } catch {
      // lsof may fail for processes we don't own
    }
    return null;
  }
}
