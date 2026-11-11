import { describe, it, expect } from 'vitest';
import {
  BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS, MAX_IMAGE_BYTES, attachmentIds, runWorkspaceTool,
  type AssistantWorkspacePort,
} from '../../src/application/assistant/workspace-tools.js';

/**
 * The assistant's own hands (Read / Write / Edit / Bash). It delegates by
 * design, but must be able to look at what it is shown and check a proof.
 */
function ws(files: Record<string, string | Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]));
  const shells: Array<{ command: string; cwd: string; timeoutMs: number }> = [];
  let shellResult = { stdout: 'ok', stderr: '', exitCode: 0 } as { stdout: string; stderr: string; exitCode: number; timedOut?: boolean };
  const port: AssistantWorkspacePort = {
    resolve: async () => '/ws',
    readFile: async (p) => { const b = store.get(p); if (!b) throw new Error(`ENOENT: no such file, open '${p}'`); return b; },
    writeFile: async (p, c) => { store.set(p, Buffer.from(c)); },
    shell: async (command, o) => { shells.push({ command, ...o }); return shellResult; },
  };
  return { port, store, shells, setShell: (r: typeof shellResult) => { shellResult = r; } };
}
const run = (w: ReturnType<typeof ws>, name: 'Read' | 'Write' | 'Edit' | 'Bash', input: Record<string, unknown>, cwd: string | null = '/ws') =>
  runWorkspaceTool(name, input, { cwd, workspace: w.port });

describe('Read', () => {
  it('reads a text file, relative to the ticket workspace or absolute', async () => {
    const w = ws({ '/ws/a.txt': 'un\ndeux\ntrois', '/etc/hosts': 'localhost' });
    expect((await run(w, 'Read', { path: 'a.txt' })).content).toBe('un\ndeux\ntrois');
    expect((await run(w, 'Read', { path: '/etc/hosts' })).content).toBe('localhost');
  });
  it('reads a slice of a big file and says which lines it is', async () => {
    const w = ws({ '/ws/a.txt': 'un\ndeux\ntrois\nquatre' });
    expect((await run(w, 'Read', { path: 'a.txt', offset: 2, limit: 2 })).content).toBe('deux\ntrois\n[lignes 2 à 3 sur 4]');
  });
  it('shows an image file to the model as an image; the log summary carries no bytes', async () => {
    const w = ws({ '/ws/shot.PNG': Buffer.from('PNGDATA') });
    const r = await run(w, 'Read', { path: 'shot.PNG' });
    expect(r.ok).toBe(true);
    expect(r.content).toEqual([expect.objectContaining({ type: 'text' }), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('PNGDATA').toString('base64') } }]);
    expect(r.summary).not.toContain(Buffer.from('PNGDATA').toString('base64'));
  });
  it('refuses an image above the API limit, a binary file and a missing file, each with its reason', async () => {
    const w = ws({ '/ws/big.png': Buffer.alloc(MAX_IMAGE_BYTES + 1, 1), '/ws/app.bin': Buffer.from([1, 0, 2]) });
    expect(await run(w, 'Read', { path: 'big.png' })).toMatchObject({ ok: false, content: expect.stringContaining('trop lourde') });
    expect(await run(w, 'Read', { path: 'app.bin' })).toMatchObject({ ok: false, content: expect.stringContaining('binaire') });
    expect(await run(w, 'Read', { path: 'nope.txt' })).toMatchObject({ ok: false, content: expect.stringContaining('ENOENT') });
  });
  it('reads an uploaded attachment by its /api/files reference, even when the ticket has no workspace', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const attachments = { load: async (x: string) => (x === id ? { name: 'log.txt', mimeType: 'text/plain', buffer: Buffer.from('trace') } : null) };
    const w = ws();
    expect((await runWorkspaceTool('Read', { path: `/api/files/${id}` }, { cwd: null, workspace: w.port, attachments })).content).toBe('trace');
    const missing = await runWorkspaceTool('Read', { path: '/api/files/99999999-2222-3333-4444-555555555555' }, { cwd: null, workspace: w.port, attachments });
    expect(missing).toMatchObject({ ok: false, content: expect.stringContaining('introuvable') });
  });
});

describe('Write and Edit', () => {
  it('Write creates or replaces the file', async () => {
    const w = ws();
    expect((await run(w, 'Write', { path: 'src/a.ts', content: 'x' })).ok).toBe(true);
    expect(w.store.get('/ws/src/a.ts')!.toString()).toBe('x');
  });
  it('Edit replaces an exact, unique string — and changes nothing when it is absent or ambiguous', async () => {
    const w = ws({ '/ws/a.ts': 'const a = 1;\nconst b = 1;' });
    expect((await run(w, 'Edit', { path: 'a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' })).ok).toBe(true);
    expect(w.store.get('/ws/a.ts')!.toString()).toBe('const a = 2;\nconst b = 1;');
    expect(await run(w, 'Edit', { path: 'a.ts', old_string: 'absent', new_string: 'y' })).toMatchObject({ ok: false, content: expect.stringContaining('introuvable') });
    expect(await run(w, 'Edit', { path: 'a.ts', old_string: 'const', new_string: 'let' })).toMatchObject({ ok: false, content: expect.stringContaining('2 fois') });
    expect(w.store.get('/ws/a.ts')!.toString()).toBe('const a = 2;\nconst b = 1;');
    expect((await run(w, 'Edit', { path: 'a.ts', old_string: 'const', new_string: 'let', replace_all: true })).ok).toBe(true);
    expect(w.store.get('/ws/a.ts')!.toString()).toBe('let a = 2;\nlet b = 1;');
  });
});

describe('Bash', () => {
  it('runs in the ticket workspace and reports output, stderr and exit code', async () => {
    const w = ws();
    w.setShell({ stdout: '2 passed\n', stderr: 'warn', exitCode: 1 });
    const r = await run(w, 'Bash', { command: 'npm test' });
    expect(w.shells).toEqual([{ command: 'npm test', cwd: '/ws', timeoutMs: BASH_DEFAULT_TIMEOUT_MS }]);
    expect(r.ok).toBe(false);
    expect(r.content).toBe('2 passed\n[stderr]\nwarn\n[code de sortie 1]');
  });
  it('caps the timeout and says when a command was cut', async () => {
    const w = ws();
    w.setShell({ stdout: '', stderr: '', exitCode: 124, timedOut: true });
    const r = await run(w, 'Bash', { command: 'sleep 9999', timeout_ms: 99_999_999 });
    expect(w.shells[0]!.timeoutMs).toBe(BASH_MAX_TIMEOUT_MS);
    expect(r).toMatchObject({ ok: false, content: expect.stringContaining('délai') });
  });
  it('does not run the fleex CLI: gates, routes and launches stay behind the fleex_* allow-list and the thread tools', async () => {
    const w = ws();
    for (const command of ['fleex workflow gate resolve 1 --approve', 'cd x && fleex ticket comment 1 "@agent:builder go"', '~/.fleex/bin/fleex ticket delete 1', 'echo $(fleex ticket list)']) {
      expect(await run(w, 'Bash', { command })).toMatchObject({ ok: false, content: expect.stringContaining('fleex_*') });
    }
    expect(w.shells).toEqual([]);
    // A path or a word that merely contains « fleex » is not the CLI.
    expect((await run(w, 'Bash', { command: 'ls ~/.fleex/repo && cat fleex.config.ts' })).ok).toBe(true);
  });
});

describe('without a workspace', () => {
  it('says the tool is unavailable instead of running anywhere else', async () => {
    const w = ws();
    expect(await run(w, 'Bash', { command: 'ls' }, null)).toMatchObject({ ok: false, content: expect.stringContaining('workspace') });
    expect(w.shells).toEqual([]);
  });
});

describe('attachmentIds', () => {
  it('finds each referenced upload once, in order', () => {
    const a = '11111111-2222-3333-4444-555555555555';
    const b = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(attachmentIds(`![x](/api/files/${a}) et [y](/api/files/${b}) puis ![x](/api/files/${a})`)).toEqual([a, b]);
    expect(attachmentIds('rien')).toEqual([]);
  });
});
