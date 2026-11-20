import { describe, it, expect } from 'vitest';
import { ClaudeStateAdapter } from '../../src/infrastructure/adapters/claude-state.adapter.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;

describe('ClaudeStateAdapter process discovery', () => {
  it("does not spawn lsof every second for a PID whose CWD can't be read", async () => {
    const calls: string[] = [];
    const exec = async (cmd: string) => {
      calls.push(cmd);
      if (cmd.startsWith('ps ')) return { stdout: '  PID  %CPU COMM\n 91001 1.0 claude\n 91002 0.5 claude\n', stderr: '' };
      if (cmd.includes('-p 91001')) return { stdout: 'n/work/a\n', stderr: '' };
      throw new Error('lsof: permission denied');
    };
    const a = new ClaudeStateAdapter(exec as never, {} as never, '/home/u', silent);
    expect(await a.discoverClaudeProcesses()).toEqual([{ pid: 91001, cpuPercent: 1, cwd: '/work/a' }]);
    expect(await a.discoverClaudeProcesses()).toEqual([{ pid: 91001, cpuPercent: 1, cwd: '/work/a' }]);
    expect(calls.filter((c) => c.startsWith('lsof'))).toHaveLength(2);
  });
});
