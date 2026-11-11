import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AssistantEnvironment, cliInvocation } from '../../src/application/assistant/assistant-environment.js';
import { resolveTodoActor } from '../../src/infrastructure/http/todo-actor.js';
import { actorHeaders } from '../../../cli/src/core/actor.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';

/**
 * Who the assistant's CLI calls are made as (lot 4).
 *
 * Why it matters: the CLI attributes a todo change to the human unless the
 * process that runs it declares an agent. The assistant used to declare
 * nothing: its changes were signed by the user, and the protection of the
 * user's own items did not apply to it.
 */

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const NAS = { name: 'Nas', persona: 'nas' };

/** What the CLI process would see: the inherited env, then the assignments `env(1)` makes, in order. */
function envSeenByCli(args: string[], inherited: Record<string, string> = {}): Record<string, string> {
  const env = { ...inherited };
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq <= 0 || !/^[A-Z_]+$/.test(a.slice(0, eq))) break; // first non-assignment = the command
    env[a.slice(0, eq)] = a.slice(eq + 1);
  }
  return env;
}

describe('cliInvocation — the identity of an assistant CLI call', () => {
  it('declares the assistant as an agent: display name for the history, slug as persona', () => {
    expect(cliInvocation('/opt/fleex', ['ticket', 'todo', 'done', '1', '3'], NAS)).toEqual({
      command: 'env',
      args: ['FLEEX_ACTOR_TYPE=agent', 'FLEEX_ACTOR_NAME=Nas', 'FLEEX_ACTOR_PERSONA=nas', '/opt/fleex', 'ticket', 'todo', 'done', '1', '3'],
    });
  });

  it('without an identity, runs the CLI as before (the tool documentation fetch, tests)', () => {
    expect(cliInvocation('/opt/fleex', ['documentation'])).toEqual({ command: '/opt/fleex', args: ['documentation'] });
  });

  it('the real CLI and the real server read that environment as agent « Nas », persona nas — not as the human', () => {
    const { args } = cliInvocation('/opt/fleex', ['ticket', 'todo', 'done', '1', '3'], NAS);
    const headers = actorHeaders(envSeenByCli(args));
    expect(resolveTodoActor(headers, 'olivier')).toEqual({ type: 'agent', name: 'Nas', source: 'cli', persona: 'nas' });
  });

  it('wins over an identity inherited from the spawning process (a server started inside an agent run)', () => {
    const inherited = { FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'workflow:Spec → Build', FLEEX_ACTOR_PERSONA: 'builder' };
    const { args } = cliInvocation('/opt/fleex', ['ticket', 'todo', 'list', '1'], { name: 'Nas', persona: 'Nas' });
    const actor = resolveTodoActor(actorHeaders(envSeenByCli(args, inherited)), 'olivier');
    expect(actor).toMatchObject({ type: 'agent', name: 'Nas', persona: 'nas' });
  });

  it('a display name with spaces, accents or « = » stays one argv element (no shell)', () => {
    const { args } = cliInvocation('/opt/fleex', ['ticket', 'show', '1'], { name: 'Chef = d’équipe', persona: 'chef' });
    expect(args[1]).toBe('FLEEX_ACTOR_NAME=Chef = d’équipe');
    expect(resolveTodoActor(actorHeaders(envSeenByCli(args)), 'olivier').name).toBe('Chef = d’équipe');
  });
});

describe('AssistantEnvironment.runCli', () => {
  const env = (execFn: ExecFn, cliBin = '/opt/fleex') => new AssistantEnvironment(execFn, logger as never, { cliBin, hasApiKey: true });

  it('passes the identity given for THIS call and keeps none for the next: one environment serves every ticket', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const e = env(async (command, args) => { calls.push({ command, args }); return { stdout: 'ok', stderr: '' }; });
    await e.runCli(['ticket', 'todo', 'list', '1'], NAS);
    await e.runCli(['ticket', 'todo', 'list', '2'], { name: 'Catalyst', persona: 'catalyst' });
    await e.runCli(['ticket', 'show', '3']);
    expect(calls.map((c) => envSeenByCli(c.args).FLEEX_ACTOR_NAME)).toEqual(['Nas', 'Catalyst', undefined]);
    expect(calls[2]).toEqual({ command: '/opt/fleex', args: ['ticket', 'show', '3'] });
  });

  // The real thing: a child process spawned from a parent that already carries
  // another agent's FLEEX_ACTOR_* must see the assistant's.
  it('really overrides the environment of the spawning process (spawned through env)', async () => {
    const polluted = { ...process.env, FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'Builder', FLEEX_ACTOR_PERSONA: 'builder' };
    const exec = promisify(execFile);
    const e = env(async (command, args) => exec(command, args, { env: polluted }), process.execPath);
    const script = 'console.log(JSON.stringify([process.env.FLEEX_ACTOR_TYPE, process.env.FLEEX_ACTOR_NAME, process.env.FLEEX_ACTOR_PERSONA]))';
    const asAssistant = await e.runCli(['-e', script], NAS);
    expect(asAssistant).toEqual({ ok: true, text: '["agent","Nas","nas"]' });
    // Control: without the identity, the inherited one leaks through.
    expect((await e.runCli(['-e', script])).text).toBe('["agent","Builder","builder"]');
  });

  it('a refused command gives its reason back, whether the CLI wrote it on stderr or (with --json) on stdout', async () => {
    const refusal = '#3 is assigned to olivier — leave it.';
    const fail = (out: { stdout: string; stderr: string }): ExecFn => async (command) => {
      // Same shape as the host gateway's error (remoteExec).
      throw Object.assign(new Error(out.stderr || `Command failed: ${command}`), out, { code: 1 });
    };
    const json = await env(fail({ stdout: JSON.stringify({ results: [], failures: [`#3: ${refusal}`] }), stderr: '' })).runCli(['ticket', 'todo', 'done', '1', '3', '--json'], NAS);
    expect(json.ok).toBe(false);
    expect(json.text).toContain(refusal);
    const human = await env(fail({ stdout: '', stderr: `[fleex] #3: ${refusal}` })).runCli(['ticket', 'todo', 'done', '1', '3'], NAS);
    expect(human).toEqual({ ok: false, text: `[fleex] #3: ${refusal}` });
  });
});
