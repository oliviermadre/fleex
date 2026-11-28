/**
 * How `fleex factory` names things on the command line: a ticket by its number, an item by the start of its id, a
 * machine by its name. Each resolver refuses rather than guesses, since the next thing done is a move or a removal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { apiGet, apiPost, apiCall } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiCall: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({ apiBase: () => 'http://localhost:9999', apiGet, apiPost, apiCall, apiPatch: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), LLM_TIMEOUT_MS: 1 }));

import { setJsonMode } from '../../src/core/colors.ts';
import { ago, parseDir, pickMachine, pickToken, resolveTarget, type FloorMachine, type FloorToken } from '../../src/commands/factory/_shared.ts';
import { parseFields } from '../../src/commands/factory/item/_shared.ts';
import { specFromFlags } from '../../src/commands/factory/machine/_shared.ts';
import { machinesOf } from '../../src/commands/factory/layout/import/index.ts';
import decideDef from '../../src/commands/factory/ticket/decide/index.ts';
import addDef from '../../src/commands/factory/machine/add/index.ts';

const token = (over: Partial<FloorToken>): FloorToken => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'ticket', displayId: 42, title: 'A ticket', type: 'fix', priority: 'high', status: 'todo', tags: [],
  machineId: 'm1', where: 'Review', phase: 'review', state: 'Waiting for a decision', outcome: '', released: false, note: '', since: '2026-01-01T00:00:00Z', handedAt: '2026-01-01T00:00:00Z',
  need: 'decision', actions: ['decide', 'move', 'take-back'], outcomes: ['approved', 'rejected'], ...over,
});
const machine = (over: Partial<FloorMachine>): FloorMachine => ({ id: 'bbbbbbbb-0000-0000-0000-000000000001', kind: 'station', name: 'Triage', x: 0, y: 0, w: 5, h: 5, holds: 0, needs: 0, ...over });

/** `die` and the ambiguity paths exit: turn that into something a test can await. */
function exits(): { stderr: () => string; restore: () => void } {
  const out: string[] = [];
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { out.push(String(chunk)); return true; }) as never);
  return { stderr: () => out.join(''), restore: () => { exit.mockRestore(); err.mockRestore(); } };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [], original = process.stdout.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => { chunks.push(String(chunk)); return true; }) as any;
  try { await fn(); } finally { process.stdout.write = original; }
  return chunks.join('');
}

describe('pickToken', () => {
  const ITEM = token({ id: 'cccccccc-0000-0000-0000-000000000042', kind: 'item', displayId: null, title: 'A mail', source: 'gmail' });
  const tokens = [token({}), token({ id: 'aaaaaaaa-0000-0000-0000-000000000002', displayId: 7 }), ITEM];

  it('finds a ticket by its number, with or without the #', () => {
    expect(pickToken(tokens, '42').id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(pickToken(tokens, '#7').displayId).toBe(7);
  });

  it('finds an item by the start of its id, as a table prints it', () => {
    expect(pickToken(tokens, 'cccccccc').kind).toBe('item');
    expect(pickToken(tokens, ITEM.id, 'item').title).toBe('A mail');
  });

  it('does not take a number for the start of an item id when a ticket has that number', () => {
    // "42" is ticket #42, never the item whose id happens to end in 42.
    expect(pickToken(tokens, '42').kind).toBe('ticket');
  });

  it('refuses an ambiguous reference with the candidates, instead of acting on the first', () => {
    const x = exits();
    expect(() => pickToken(tokens, 'aaaaaaaa')).toThrow('exit');
    expect(x.stderr()).toContain('matches several');
    expect(x.stderr()).toContain('aaaaaaaa-0000-0000-0000-000000000002');
    x.restore();
  });

  it('refuses two tickets of different boards that share a number', () => {
    const x = exits();
    expect(() => pickToken([token({}), token({ id: 'dddddddd-0000-0000-0000-000000000001' })], '42')).toThrow('exit');
    x.restore();
  });

  it('says what to run when nothing matches, and keeps an item command to items', () => {
    const x = exits();
    expect(() => pickToken(tokens, '999')).toThrow('exit');
    expect(x.stderr()).toContain('fleex factory ticket list');
    expect(() => pickToken(tokens, '42', 'item')).toThrow('exit');
    x.restore();
  });
});

describe('pickMachine', () => {
  const machines = [
    machine({}), machine({ id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Review', exec: 'human_gate' }),
    machine({ id: 'eeeeeeee-0000-0000-0000-000000000001', kind: 'zone', name: 'Review queue' }),
    machine({ id: 'ffffffff-0000-0000-0000-000000000001', kind: 'belt', name: 'Belt' }),
  ];

  it('finds a machine by its name whatever the case, an exact name before a longer one', () => {
    expect(pickMachine(machines, 'triage').name).toBe('Triage');
    expect(pickMachine(machines, 'REVIEW').exec).toBe('human_gate');
    expect(pickMachine(machines, 'review q').kind).toBe('zone');
  });

  it('finds one by the start of its id, and a belt only that way', () => {
    expect(pickMachine(machines, 'eeeeeeee').name).toBe('Review queue');
    expect(pickMachine(machines, 'ffffffff').kind).toBe('belt');
    const x = exits();
    expect(() => pickMachine(machines, 'Belt')).toThrow('exit');
    x.restore();
  });

  it('refuses a name or a prefix that several machines share', () => {
    const x = exits();
    expect(() => pickMachine(machines, 'bbbbbbbb')).toThrow('exit');
    expect(() => pickMachine(machines, 'rev')).toThrow('exit');
    expect(x.stderr()).toContain('matches several machines');
    x.restore();
  });

  it('keeps to the kinds a command works on', () => {
    const x = exits();
    expect(() => pickMachine(machines, 'Review queue', ['station'])).toThrow('exit');
    x.restore();
  });
});

describe('what the flags become', () => {
  beforeEach(() => { apiGet.mockReset(); });

  it('reads a direction as a word, a letter or the number the layout holds', () => {
    expect([parseDir('east'), parseDir('S'), parseDir('west'), parseDir('3')]).toEqual([0, 1, 2, 3]);
  });

  it('turns --to into a machine id and --x/--y into a tile, and refuses half a tile or both', async () => {
    apiGet.mockResolvedValue([machine({})]);
    expect(await resolveTarget({ to: 'Triage' })).toEqual({ machineId: 'bbbbbbbb-0000-0000-0000-000000000001' });
    expect(await resolveTarget({ x: '3', y: '-4' })).toEqual({ x: 3, y: -4 });
    expect(await resolveTarget({})).toBeUndefined();
    const x = exits();
    await expect(resolveTarget({ x: '3' })).rejects.toThrow('exit');
    await expect(resolveTarget({ to: 'Triage', x: '1', y: '1' })).rejects.toThrow('exit');
    x.restore();
  });

  it('builds a spec from the flags, with --spec having the last word', () => {
    expect(specFromFlags({ x: '2', y: '3', name: 'Triage', exec: 'agent', outcomes: 'ok, rework', cap: '2', dir: 'south', spec: '{"cap":4,"model":null}' }))
      .toEqual({ x: 2, y: 3, name: 'Triage', exec: 'agent', outcomes: ['ok', 'rework'], cap: 4, dir: 1, model: null });
    const x = exits();
    expect(() => specFromFlags({ exec: 'robot' })).toThrow('exit');
    expect(() => specFromFlags({ spec: '[1]' })).toThrow('exit');
    expect(() => specFromFlags({ cap: 'two' })).toThrow('exit');
    x.restore();
  });

  it('reads --field pairs as text, yes or no, or a list', () => {
    expect(parseFields(['channel=#ops', 'bot=true', 'labels=INBOX, IMPORTANT', 'to=a=b'])).toEqual({ channel: '#ops', bot: true, labels: ['INBOX', 'IMPORTANT'], to: 'a=b' });
    expect(parseFields([])).toBeUndefined();
  });

  it('reads the machines of a floor file, of a bare layout and of what the API gives', () => {
    const machines = [{ id: 'z', kind: 'zone' }];
    expect(machinesOf(JSON.stringify({ fleexFloor: 1, layout: { machines } }))).toEqual(machines);
    expect(machinesOf(JSON.stringify({ machines }))).toEqual(machines);
    const x = exits();
    expect(() => machinesOf('{"tickets":[]}')).toThrow('exit');
    expect(() => machinesOf('not json')).toThrow('exit');
    x.restore();
  });

  it('says how long in the unit that fits', () => {
    expect([ago(4_000), ago(180_000), ago(7_200_000), ago(3 * 86_400_000)]).toEqual(['4 s', '3 min', '2 h', '3 d']);
  });
});

describe('what a command sends and answers', () => {
  beforeEach(() => { apiGet.mockReset(); apiPost.mockReset(); apiCall.mockReset(); setJsonMode(true); });
  afterEach(() => { setJsonMode(false); });

  it('decides at a gate on the ticket the number names, and answers with one JSON line: where the ticket stands now', async () => {
    const after = token({ phase: 'out', outcome: 'approved', need: null });
    apiGet.mockResolvedValue([token({})]);
    apiCall.mockResolvedValue(after);
    // The route answers with the whole floor (for the page): none of it may reach stdout.
    apiPost.mockResolvedValue({ floor: { layout: { machines: new Array(5000).fill({}) } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await captureStdout(() => (decideDef.action as any)('#42', 'approved', { reason: 'fine' }));
    expect(apiPost).toHaveBeenCalledWith('http://localhost:9999/api/factory/tickets/aaaaaaaa-0000-0000-0000-000000000001/resolve', { outcome: 'approved', reason: 'fine' });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(out)).toMatchObject({ id: after.id, phase: 'out', outcome: 'approved' });
  });

  it('says a ticket has left the floor when what was done sent it out by an exit, instead of failing', async () => {
    apiGet.mockResolvedValue([token({})]);
    apiCall.mockRejectedValue(new Error('HTTP 404: This ticket is not on the factory floor'));
    apiPost.mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await captureStdout(() => (decideDef.action as any)('42', 'approved', {}));
    expect(JSON.parse(out)).toEqual({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'ticket', displayId: 42, title: 'A ticket', onFloor: false });
  });

  it('lays a line of belts along its direction in one request', async () => {
    apiPost.mockImplementation(async (_url: string, body: { machines: Record<string, unknown>[] }) => ({ machines: body.machines.map((m, i) => ({ ...m, id: `b${i}`, dir: 'south' })) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await captureStdout(() => (addDef.action as any)('belt', { x: '5', y: '5', dir: 'south', length: '3' }));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]![1]).toEqual({ machines: [{ kind: 'belt', x: 5, y: 5, dir: 1 }, { kind: 'belt', x: 5, y: 6, dir: 1 }, { kind: 'belt', x: 5, y: 7, dir: 1 }] });
    expect(JSON.parse(out).machines.map((m: { y: number }) => m.y)).toEqual([5, 6, 7]);
  });

  it('refuses a station with nothing to run in it before asking the floor', async () => {
    const x = exits();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((addDef.action as any)('station', { x: '1', y: '1' })).rejects.toThrow('exit');
    expect(apiPost).not.toHaveBeenCalled();
    x.restore();
  });
});
