/**
 * Whole Assistant turns against a scripted SDK `query`: what the user gets in
 * the conversation folder, the one confirmation, Stop, the fallbacks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Runner, type ClientEvent } from '../src/runner.ts';
import { SessionStore } from '../src/sessions.ts';
import type { QueryFn, QueryHandle, SdkMessage } from '../src/agent-turn.ts';

let tmp: string;
let root: string;
let store: SessionStore;
let events: Array<ClientEvent & { sessionId: string }>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-runner-')));
  root = path.join(tmp, 'workspaces');
  fs.mkdirSync(root);
  store = new SessionStore(path.join(tmp, 'sessions'));
  events = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Options = Record<string, unknown> & { cwd: string; resume?: string; env: Record<string, string> };
type Script = (opts: Options, prompt: string, ctl: { interrupted: Promise<void> }) => AsyncGenerator<SdkMessage>;

/** A `query` playing one script per call; records what each call received. */
function scripted(...scripts: Script[]) {
  const calls: Array<{ prompt: string; options: Options }> = [];
  const query: QueryFn = ({ prompt, options }) => {
    const opts = options as Options;
    calls.push({ prompt, options: opts });
    let interrupt!: () => void;
    const interrupted = new Promise<void>((r) => (interrupt = r));
    const gen = scripts[calls.length - 1]!(opts, prompt, { interrupted });
    const handle = gen as unknown as QueryHandle;
    handle.interrupt = async () => interrupt();
    return handle;
  };
  return { query, calls };
}

/** Call the PreToolUse guard the way the SDK would. */
function guard(opts: Options, tool: string, input: Record<string, unknown>, id: string) {
  const pre = (opts.hooks as { PreToolUse: Array<{ hooks: Array<(i: unknown, id: string) => Promise<{ hookSpecificOutput?: { permissionDecision: string } }>> }> }).PreToolUse[0]!;
  return pre.hooks[0]!({ tool_name: tool, tool_input: input, tool_use_id: id }, id);
}

const init = (id = 'sdk-1'): SdkMessage => ({ type: 'system', subtype: 'init', session_id: id, mcp_servers: [{ name: 'notion', status: 'needs-auth' }] });
const toolUse = (id: string, name: string, input: Record<string, unknown>): SdkMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const toolResult = (id: string, content: string, isError = false): SdkMessage => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});
const say = (text: string): SdkMessage => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const result = (subtype = 'success'): SdkMessage => ({ type: 'result', subtype });

function runner(query: QueryFn, extra: { apiKey?: string } = {}) {
  return new Runner({
    store,
    query,
    emit: (sessionId, e) => events.push({ ...e, sessionId }),
    sessionsChanged: () => {},
    resolveWorkspace: (ws) => ws ?? 'default',
    workspacesRoot: () => root,
    accessCatalog: () => new Map([['ticket comment', 'write']]),
    defaultModel: 'claude-opus-5',
    maxTurns: async () => 3,
    apiKey: () => extra.apiKey,
  });
}

const until = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!pred()) throw new Error('timed out');
};

describe('a turn', () => {
  it('writes and runs a script in the conversation folder, with no confirmation, and shows the CSV (CA1)', async () => {
    const { query, calls } = scripted(async function* (opts) {
      yield init();
      yield toolUse('w1', 'Write', { file_path: path.join(opts.cwd, 'export.ts'), content: 'x' });
      expect((await guard(opts, 'Write', { file_path: 'export.ts' }, 'w1')).hookSpecificOutput).toBeUndefined();
      fs.writeFileSync(path.join(opts.cwd, 'export.ts'), 'x');
      yield toolResult('w1', 'ok');
      yield toolUse('b1', 'Bash', { command: 'bun export.ts && fleex ticket comment 482 done' });
      fs.writeFileSync(path.join(opts.cwd, 'tickets-bloques.csv'), 'id,title\n482,x\n');
      yield toolResult('b1', 'done');
      yield say('Export fait.');
      yield result();
    });
    const s = store.create();
    expect(fs.readdirSync(root)).toEqual([]); // no folder before the first message (CA10)
    await runner(query).handleUserTurn(s.id, 'exporte les tickets bloqués');

    const session = store.get(s.id)!;
    expect(session.workDir).toBe(path.join(root, `assistant-${s.id.replace(/-/g, '').slice(0, 8)}`));
    expect(calls[0]!.options.cwd).toBe(session.workDir);
    expect(session.sdkSessionId).toBe('sdk-1');
    expect(events.some((e) => e.type === 'confirm_request')).toBe(false);

    const bash = session.transcript.find((i) => 'tool' in i && i.tool.name === 'Bash');
    expect(bash && 'tool' in bash && bash.tool.access).toBe('write'); // fleex badge (CA2, display only)

    const cards = session.transcript.flatMap((i) => ('artifact' in i ? [i.artifact] : []));
    expect(cards.map((c) => [c.name, c.kind])).toEqual([
      ['export.ts', 'script'],
      ['tickets-bloques.csv', 'full'],
    ]);
    expect(events.find((e) => e.type === 'mcp_status')).toMatchObject({ servers: [{ name: 'notion', status: 'needs-auth' }] });
    expect(session.status).toBe('idle');
  });

  it('resumes the same SDK session on the next message (P1)', async () => {
    const { query, calls } = scripted(
      async function* () { yield init('sdk-1'); yield result(); },
      async function* () { yield init('sdk-1'); yield result(); },
    );
    const s = store.create();
    const r = runner(query);
    await r.handleUserTurn(s.id, 'a');
    await r.handleUserTurn(s.id, 'b');
    expect(calls[0]!.options.resume).toBeUndefined();
    expect(calls[1]!.options.resume).toBe('sdk-1');
  });
});

describe('writes outside the folder', () => {
  const outsideTurn = (file: string, id: string): Script => async function* (opts) {
    yield init();
    yield toolUse(id, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' });
    const out = await guard(opts, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' }, id);
    if (out.hookSpecificOutput?.permissionDecision === 'deny') {
      yield toolResult(id, 'denied', true);
    } else {
      fs.writeFileSync(file, 'b\n');
      yield toolResult(id, 'ok');
    }
    yield result();
  };

  it('waits for the user; a refusal leaves the file untouched and the line "refusé" (CA3)', async () => {
    const zshrc = path.join(tmp, '.zshrc');
    fs.writeFileSync(zshrc, 'a\n');
    const { query } = scripted(outsideTurn(zshrc, 'e1'));
    const s = store.create();
    const r = runner(query);
    const turn = r.handleUserTurn(s.id, 'modifie ~/.zshrc');
    await until(() => events.some((e) => e.type === 'confirm_request'));
    expect(events.find((e) => e.type === 'confirm_request')).toMatchObject({ id: 'e1', path: zshrc, tool: 'Edit' });
    expect(store.get(s.id)!.status).toBe('awaiting_input');
    expect(r.pendingFor(s.id)).toHaveLength(1); // shown again if the panel reopens (R4)
    r.confirm({ id: 'e1', decision: 'deny' });
    await turn;
    expect(fs.readFileSync(zshrc, 'utf8')).toBe('a\n');
    const line = store.get(s.id)!.transcript.find((i) => 'tool' in i);
    expect(line && 'tool' in line && line.tool.status).toBe('denied');
  });

  it('"always" covers later writes of this conversation only, until the chip is removed (CA4)', async () => {
    const f1 = path.join(tmp, 'one.txt');
    const f2 = path.join(tmp, 'two.txt');
    const { query } = scripted(outsideTurn(f1, 'e1'), outsideTurn(f2, 'e2'), outsideTurn(f2, 'e3'));
    const s = store.create();
    const r = runner(query);
    const first = r.handleUserTurn(s.id, 'one');
    await until(() => events.some((e) => e.type === 'confirm_request'));
    r.confirm({ id: 'e1', decision: 'always' });
    await first;
    expect(store.get(s.id)!.outsideWritesAllowed).toBe(true);

    events = [];
    await r.handleUserTurn(s.id, 'two');
    expect(events.some((e) => e.type === 'confirm_request')).toBe(false);
    const line = store.get(s.id)!.transcript.filter((i) => 'tool' in i).pop();
    expect(line && 'tool' in line && line.tool.outsideAutoAllowed).toBe(true);

    const other = store.create();
    expect(store.get(other.id)!.outsideWritesAllowed).toBe(false);

    store.setOutsideWritesAllowed(s.id, false);
    const third = r.handleUserTurn(s.id, 'three');
    await until(() => events.some((e) => e.type === 'confirm_request'));
    r.confirm({ id: 'e3', decision: 'allow' });
    await third;
  });

  it('Stop refuses a pending confirmation and stops the turn (RG9)', async () => {
    const file = path.join(tmp, 'x.txt');
    const { query } = scripted(async function* (opts, _p, ctl) {
      yield init();
      yield toolUse('e1', 'Write', { file_path: file, content: 'x' });
      const out = await guard(opts, 'Write', { file_path: file, content: 'x' }, 'e1');
      expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
      await ctl.interrupted;
      yield result('error_during_execution');
    });
    const s = store.create();
    const r = runner(query);
    const turn = r.handleUserTurn(s.id, 'go');
    await until(() => events.some((e) => e.type === 'confirm_request'));
    await r.stop(s.id);
    await turn;
    expect(fs.existsSync(file)).toBe(false);
    expect(store.get(s.id)!.status).toBe('idle');
  });
});

describe('limits and fallbacks', () => {
  it('reports the turn budget and continues with a technical turn (D9, P21)', async () => {
    const { query, calls } = scripted(
      async function* () { yield init(); yield result('error_max_turns'); },
      async function* () { yield init(); yield result(); },
    );
    const s = store.create();
    const r = runner(query);
    await r.handleUserTurn(s.id, 'long task');
    expect(events.find((e) => e.type === 'max_turns')).toMatchObject({ limit: 3 });
    await r.handleUserTurn(s.id, 'Continue.', { continued: true });
    expect(calls[1]!.options.resume).toBe('sdk-1');
    const users = store.get(s.id)!.transcript.filter((i) => 'role' in i && i.role === 'user');
    expect(users).toHaveLength(1); // "Continue." is no user bubble, only a notice
    expect(store.get(s.id)!.transcript.some((i) => 'notice' in i && i.notice === 'continued')).toBe(true);
  });

  it('resumes a pre-SDK conversation from its text history (D8, CA16)', async () => {
    fs.writeFileSync(
      path.join(tmp, 'sessions', 'old.json'),
      JSON.stringify({
        id: 'old', title: 'Old', status: 'idle', createdAt: '2020',
        messages: [{ role: 'user', content: 'parle-moi du #482' }, { role: 'assistant', content: 'Le #482 traite des relances.' }],
        transcript: [{ role: 'user', text: 'parle-moi du #482' }, { role: 'assistant', text: 'Le #482 traite des relances.' }],
      }),
    );
    store = new SessionStore(path.join(tmp, 'sessions'));
    const { query, calls } = scripted(async function* () { yield init(); yield result(); });
    await runner(query).handleUserTurn('old', 'de quoi parlait-on ?');
    expect(calls[0]!.prompt).toContain('Le #482 traite des relances.');
    expect(calls[0]!.prompt).toContain('de quoi parlait-on ?');
    expect(store.get('old')!.transcript.some((i) => 'notice' in i && i.notice === 'legacy_resumed')).toBe(true);
    expect(store.get('old')!.workDir).toBeTruthy(); // folder created on the first new message (R8)
  });

  it('starts over from the text history when the SDK session is lost (RG10)', async () => {
    const { query, calls } = scripted(
      async function* () { yield init('sdk-1'); yield say('first answer'); yield result(); },
      // eslint-disable-next-line require-yield
      async function* () { throw new Error('No conversation found with session ID: sdk-1'); },
      async function* () { yield init('sdk-2'); yield result(); },
    );
    const s = store.create();
    const r = runner(query);
    await r.handleUserTurn(s.id, 'a');
    await r.handleUserTurn(s.id, 'b');
    expect(calls[2]!.options.resume).toBeUndefined();
    expect(calls[2]!.prompt).toContain('first answer');
    expect(store.get(s.id)!.sdkSessionId).toBe('sdk-2');
  });

  it('falls back to the API key when Claude Code has no login (T1)', async () => {
    const { query, calls } = scripted(
      async function* () { yield init(); yield { type: 'assistant', error: 'authentication_failed', parent_tool_use_id: null, message: { content: [] } }; yield result('success'); },
      async function* () { yield init(); yield say('ok'); yield result(); },
    );
    const s = store.create();
    await runner(query, { apiKey: 'sk-fallback' }).handleUserTurn(s.id, 'hi');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.options.env.ANTHROPIC_API_KEY).toBe('sk-fallback');
    expect(events.some((e) => e.type === 'auth_missing')).toBe(false);
  });

  it('says where to log in when there is neither a login nor a key', async () => {
    const { query } = scripted(async function* () {
      yield { type: 'assistant', error: 'authentication_failed', parent_tool_use_id: null, message: { content: [] } };
      yield result();
    });
    const s = store.create();
    await runner(query).handleUserTurn(s.id, 'hi');
    expect(events.some((e) => e.type === 'auth_missing')).toBe(true);
  });
});
