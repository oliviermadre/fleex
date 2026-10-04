/**
 * `fleex status --json` must emit one parseable JSON document, not the table.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-status-'));
process.env.FLEEX_HOME = home;

const { setJsonMode } = await import('../../src/core/colors.ts');
const { runStatus } = await import('../../src/commands/status/_impl.ts');

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => { chunks.push(String(chunk)); return true; }) as any;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

describe('status --json', () => {
  beforeAll(() => {
    const dir = path.join(home, '.run', 'ws@branch');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ports.json'), JSON.stringify({ gateway: 4000, server: 4001, web: 4002 }));
    fs.writeFileSync(path.join(dir, 'server.pid'), '999999999');
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
  afterEach(() => setJsonMode(false));

  it('emits a single JSON document with per-service state', async () => {
    setJsonMode(true);
    const out = await captureStdout(runStatus);
    const parsed = JSON.parse(out);
    expect(parsed.instances).toHaveLength(1);
    const inst = parsed.instances[0];
    expect(inst.slug).toBe('ws@branch');
    expect(inst.services.map((s: { name: string }) => s.name)).toEqual(['gateway', 'server', 'web']);
    expect(inst.services[0]).toEqual({ name: 'gateway', status: 'stopped', pid: null, url: 'http://localhost:4000' });
    expect(inst.services[1].status).toBe('dead');
  });

  it('emits an empty instance list as JSON when nothing has run', async () => {
    fs.renameSync(path.join(home, '.run'), path.join(home, '.run-off'));
    try {
      setJsonMode(true);
      expect(JSON.parse(await captureStdout(runStatus)).instances).toEqual([]);
    } finally {
      fs.renameSync(path.join(home, '.run-off'), path.join(home, '.run'));
    }
  });

  it('still renders the table without --json', async () => {
    const out = await captureStdout(runStatus);
    expect(out).toContain('fleex stack status');
    expect(out).toContain('ws@branch');
  });
});
