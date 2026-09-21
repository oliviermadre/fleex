import { describe, it, expect, vi } from 'vitest';
import { FileSlackConnectionStore } from '../../src/infrastructure/adapters/file-slack-connection.store.js';
import type { SlackConnection } from '../../src/application/ports/slack-connection.port.js';

const CONN: SlackConnection = {
  token: 'xoxp-secret', teamId: 'T1', teamName: 'Evaneos', teamDomain: 'evaneos',
  userId: 'U1', userName: 'nas', scopes: ['channels:history'], connectedAt: '2026-09-21T10:00:00.000Z',
};

function setup(files: Record<string, string> = {}) {
  const ops: string[] = [];
  const hostFs = {
    exists: vi.fn(async (p: string) => p in files),
    readFile: vi.fn(async (p: string) => files[p]!),
    writeFile: vi.fn(async (p: string, c: string) => { ops.push(`write ${p}`); files[p] = c; }),
    mkdir: vi.fn(async (p: string) => { ops.push(`mkdir ${p}`); }),
    rm: vi.fn(async (p: string) => { delete files[p]; }),
  };
  const execFn = vi.fn(async (cmd: string, args: string[]) => { ops.push(`${cmd} ${args.join(' ')}`); return { stdout: '', stderr: '', exitCode: 0 }; });
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const store = new FileSlackConnectionStore(hostFs as never, execFn as never, '/home/nas', logger);
  return { store, files, ops, logger, hostFs };
}
const FILE = '/home/nas/.fleex/connectors/slack.json';

describe('FileSlackConnectionStore', () => {
  it('locks the directory before the token file exists, then the file itself', async () => {
    // Under a default umask a new file is world-readable. Closing the directory
    // first means the token is never reachable by another user, even for an instant.
    const { store, ops } = setup();

    await store.save(CONN);

    expect(ops).toEqual([
      'mkdir /home/nas/.fleex/connectors',
      'chmod 700 /home/nas/.fleex/connectors',
      `write ${FILE}`,
      `chmod 600 ${FILE}`,
    ]);
  });

  it('round-trips a connection, and forgets it on clear', async () => {
    const { store, files } = setup();
    await store.save(CONN);
    expect(await store.get()).toEqual(CONN);

    await store.clear();

    expect(await store.get()).toBeNull();
    expect(FILE in files).toBe(false);
  });

  it('reads a connection saved by a previous run', async () => {
    const { store } = setup({ [FILE]: JSON.stringify(CONN) });

    expect((await store.get())?.teamDomain).toBe('evaneos');
  });

  it('treats a corrupt file as "not connected" and keeps its content out of the logs', async () => {
    // A bare token is the nasty case: Node's SyntaxError message QUOTES it.
    const { store, logger } = setup({ [FILE]: 'xoxp-leaky' });
    expect(() => JSON.parse('xoxp-leaky')).toThrow(/xoxp-leaky/); // the hazard is real on this runtime

    expect(await store.get()).toBeNull();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('xoxp-leaky');
  });
});
