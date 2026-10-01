import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { remoteShellExec } from './remote.js';

/** A fake gateway that, like the real one, only answers /exec once the "command" exits. */
let server: http.Server;
let url: string;
let reply: { delayMs: number; body: unknown } = { delayMs: 0, body: {} };
let received: unknown;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received = JSON.parse(raw);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      }, reply.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => vi.unstubAllGlobals());

describe('remoteShellExec', () => {
  it('does not go through global fetch, whose 300 s headers timeout would abort a 30-min action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('headers timeout'); }));
    reply = { delayMs: 150, body: { stdout: 'done', stderr: '', exitCode: 0 } };
    const result = await remoteShellExec(url)('sleep 1500 && echo done', { cwd: '/home/me', timeout: 1_800_000 });
    expect(result).toEqual({ stdout: 'done', stderr: '', exitCode: 0 });
    expect(received).toEqual({ command: 'sleep 1500 && echo done', args: [], shell: true, cwd: '/home/me', timeout: 1_800_000 });
  });

  it('keeps the exitCode / timedOut / error mapping', async () => {
    reply = { delayMs: 0, body: { stdout: '', stderr: 'boom', exitCode: 3, timedOut: true } };
    expect(await remoteShellExec(url)('x')).toEqual({ stdout: '', stderr: 'boom', exitCode: 3, timedOut: true });

    reply = { delayMs: 0, body: { stdout: 'a', stderr: '' } };
    expect(await remoteShellExec(url)('x')).toEqual({ stdout: 'a', stderr: '', exitCode: 0 });

    reply = { delayMs: 0, body: { error: 'spawn failed' } };
    await expect(remoteShellExec(url)('x')).rejects.toThrow('spawn failed');
  });

  it('rejects when the gateway is unreachable', async () => {
    await expect(remoteShellExec('http://127.0.0.1:1')('x')).rejects.toThrow();
  });
});
