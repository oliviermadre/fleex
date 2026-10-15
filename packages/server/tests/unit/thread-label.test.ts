import { describe, it, expect } from 'vitest';
import { GenerateThreadTitleUseCase, cleanTitle, computeParticipants } from '../../src/application/use-cases/thread-label.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { EventBus } from '../../src/application/event-bus.js';

const newThread = () => AgentThreadEntity.create({ id: 'th', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'a', brief: 'Fix the panel', forwardedContext: [] });

function setup(complete: (prompt: string) => Promise<string>, t = newThread()) {
  const saves: Array<string | null> = [];
  const store = { getById: async () => t, save: async (x: AgentThreadEntity) => { saves.push(x.generatedTitle); } };
  const events: string[] = [];
  const bus = new EventBus();
  bus.on('*', (e) => { events.push(e.type); });
  const limiter = { acquire: async () => () => {} };
  const logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
  const uc = new GenerateThreadTitleUseCase(store as never, limiter as never, bus, logger as never, complete);
  return { uc, t, saves, events };
}

describe('computeParticipants', () => {
  it('keeps each author of the thread once, in order of first message', () => {
    const c = (threadId: string | null, authorType: string, authorName: string) => ({ threadId, authorType, authorName });
    expect(computeParticipants([c('th', 'user', 'Olivier'), c('x', 'user', 'Other'), c('th', 'agent', 'builder'), c('th', 'user', 'Olivier')], 'th'))
      .toEqual([{ userId: 'user:Olivier', displayName: 'Olivier' }, { userId: 'agent:builder', displayName: 'builder' }]);
  });
  it('tells apart a user and an agent that share a name', () => {
    expect(computeParticipants([{ threadId: 'th', authorType: 'user', authorName: 'nas' }, { threadId: 'th', authorType: 'agent', authorName: 'nas' }], 'th')).toHaveLength(2);
  });
});

describe('cleanTitle', () => {
  it('strips quotes and trailing dots, collapses spaces, caps the length, and rejects empty output', () => {
    expect(cleanTitle('  "Fix   the panel." \n')).toBe('Fix the panel');
    expect(cleanTitle('x'.repeat(200))!.length).toBe(80);
    expect(cleanTitle('  ""  ')).toBeNull();
  });
});

describe('GenerateThreadTitleUseCase', () => {
  it('writes the title once, from the brief and the first message, and tells the UI', async () => {
    let prompt = '';
    const { uc, t, saves, events } = setup(async (p) => { prompt = p; return '"Fix the threads panel"'; });
    await uc.execute('th', 'the list is unreadable');
    expect(t.generatedTitle).toBe('Fix the threads panel');
    expect(prompt).toContain('Fix the panel');
    expect(prompt).toContain('the list is unreadable');
    expect(saves).toEqual(['Fix the threads panel']);
    expect(events).toEqual(['thread.updated']);
  });

  it('leaves the title null when Haiku fails, without throwing (the message was already sent)', async () => {
    const { uc, t, saves } = setup(async () => { throw new Error('rate limited'); });
    await expect(uc.execute('th', 'hello')).resolves.toBeUndefined();
    expect(t.generatedTitle).toBeNull();
    expect(saves).toEqual([]);
  });

  it('leaves the title null when Haiku answers nothing usable', async () => {
    const { uc, t } = setup(async () => '   ');
    await uc.execute('th', 'hello');
    expect(t.generatedTitle).toBeNull();
  });

  it('never overwrites an existing title and does not call Haiku for it', async () => {
    const named = newThread();
    named.generatedTitle = 'Existing';
    let calls = 0;
    const { uc, saves } = setup(async () => { calls++; return 'New'; }, named);
    await uc.execute('th', 'hello');
    expect(named.generatedTitle).toBe('Existing');
    expect(calls).toBe(0);
    expect(saves).toEqual([]);
  });

  it('does not start a second generation while one is in flight', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const { uc } = setup(() => { calls++; return new Promise<string>((r) => { release = r; }); });
    const first = uc.execute('th', 'a');
    await new Promise((r) => setTimeout(r, 0));
    await uc.execute('th', 'b');
    release('Title');
    await first;
    expect(calls).toBe(1);
  });

  it('trigger() returns immediately: the caller is never made to wait for Haiku', () => {
    const { uc } = setup(() => new Promise<string>(() => {})); // never settles
    expect(uc.trigger('th', 'hello')).toBeUndefined();
  });
});
