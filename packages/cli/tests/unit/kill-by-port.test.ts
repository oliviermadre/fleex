import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { killByPort, isAlive } from '../../src/core/process.ts';

const hasLsof = spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error === undefined;

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) {
    try { c.kill('SIGKILL'); } catch { /* gone */ }
  }
});

/** Spawn a node child running `code`; resolves once it prints its first line. */
function spawnNode(code: string): Promise<{ proc: ChildProcess; line: string }> {
  const proc = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(proc);
  return new Promise((resolve, reject) => {
    proc.stdout!.once('data', (d: Buffer) => resolve({ proc, line: d.toString().trim() }));
    proc.once('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('killByPort', () => {
  it.skipIf(!hasLsof)(
    "kills the process LISTENING on the port, never a client connected to it (another instance's server)",
    async () => {
      // An instance's server, holding the port.
      const server = await spawnNode(
        "const s=require('net').createServer(c=>c.on('data',()=>{})).listen(0,'127.0.0.1',()=>console.log(s.address().port))",
      );
      const port = Number(server.line);
      // Another process with an open connection TO that port — e.g. the user's
      // main stack talking to a QA stack. `fleex stop` of the QA stack used to
      // SIGKILL it too (#697: default@main's server/web died during a QA cleanup).
      const client = await spawnNode(
        `const c=require('net').connect(${port},'127.0.0.1',()=>console.log('connected'));c.on('error',()=>{});setInterval(()=>{},1e6)`,
      );

      const reaped = killByPort(port);
      await sleep(200);

      expect(reaped).toContain(server.proc.pid);
      expect(reaped).not.toContain(client.proc.pid);
      expect(isAlive(client.proc.pid!)).toBe(true);
    },
    15_000,
  );
});
