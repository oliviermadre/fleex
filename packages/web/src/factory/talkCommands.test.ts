import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commandName, commandsFor, matching, resetCommands, type CommandActs } from './talkCommands';

const acts = (): CommandActs & Record<string, ReturnType<typeof vi.fn>> => ({
  retry: vi.fn(async () => {}), setAside: vi.fn(async () => {}), release: vi.fn(async () => {}), star: vi.fn(async () => {}),
  giveBack: vi.fn(async () => {}), open: vi.fn(), newConversation: vi.fn(),
}) as never;
const tk = (over: object) => ({ kind: 'ticket' as const, ticketId: 't1', label: '#788', favorite: false, ...over });
const names = (t: Parameters<typeof commandsFor>[0]) => commandsFor(t).map((c) => c.name);

beforeEach(resetCommands);

describe('the commands of the talk line', () => {
  it('offers what makes sense where the ticket stands', () => {
    expect(names(tk({ phase: 'question' }))).toEqual(['run', 'open', 'star', 'giveback']);
    expect(names(tk({ phase: 'running', canAside: true }))).toEqual(['stop', 'open', 'star', 'giveback']);
    expect(names(tk({ phase: 'zone', released: false, favorite: true }))).toEqual(['release', 'open', 'unstar', 'giveback']);
    expect(names(tk({ phase: 'review', favorite: null }))).toEqual(['open', 'giveback']);              // a gate's decision stays on its buttons
    expect(names({ kind: 'assistant' })).toEqual(['new']);
  });

  it('does what it says, and asks twice before giving a ticket back', async () => {
    const a = acts(), list = commandsFor(tk({ phase: 'failed' }));
    expect(await list.find((c) => c.name === 'run')!.run(a)).toBe('#788: its station runs again');
    expect(a.retry).toHaveBeenCalledWith('t1');
    const give = list.find((c) => c.name === 'giveback')!;
    expect(await give.run(a)).toContain('type /giveback again');
    expect(a.giveBack).not.toHaveBeenCalled();
    expect(await give.run(a)).toBe('#788: given back, out of the Factory');
    expect(a.giveBack).toHaveBeenCalledWith('t1');
  });

  it('reads a slash and lists what starts with what is typed', () => {
    expect(commandName('/run now')).toBe('run');
    expect(commandName('/')).toBe('');
    expect(commandName('use the staging key')).toBeNull();
    expect(matching(commandsFor(tk({ phase: 'question' })), 'R').map((c) => c.name)).toEqual(['run']);
  });
});
