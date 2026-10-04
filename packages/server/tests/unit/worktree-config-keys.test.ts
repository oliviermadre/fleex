import { describe, expect, it } from 'vitest';
import { getConfigKey, isWorktreeConfigKey, keyScope, listConfigKeys, setConfigKey } from '@fleex/shared';

describe('worktree config keys', () => {
  it('moves one element at a time without touching the rest of the layer', () => {
    // WHY: "Partager" an action must not drag the rest of the personal config into the repo file.
    const personal = { hooks: { setup: 'pnpm i', timeoutSec: 90 }, actions: [{ id: 'migrate', cmd: 'make migrate' }, { id: 'seed', cmd: 'make seed' }], pins: ['npm:dev'] };
    const action = getConfigKey(personal, 'action:migrate');
    const shared = setConfigKey(null, 'action:migrate', action);
    const rest = setConfigKey(personal, 'action:migrate', undefined);
    expect(shared).toEqual({ actions: [{ id: 'migrate', cmd: 'make migrate' }] });
    expect(rest).toEqual({ hooks: { setup: 'pnpm i', timeoutSec: 90 }, actions: [{ id: 'seed', cmd: 'make seed' }], pins: ['npm:dev'] });
  });

  it('prunes emptied containers, and keeps an action in place when replaced', () => {
    expect(setConfigKey({ hooks: { setup: 'x' } }, 'hooks.setup', undefined)).toEqual({});
    expect(setConfigKey({ pins: ['a'] }, 'pin:a', undefined)).toEqual({});
    const two = { actions: [{ id: 'a', cmd: '1' }, { id: 'b', cmd: '2' }] };
    expect(setConfigKey(two, 'action:a', { id: 'ignored', cmd: '3' }).actions).toEqual([{ id: 'a', cmd: '3' }, { id: 'b', cmd: '2' }]);
  });

  it('an empty setup is a value (explicitly none), not an absence', () => {
    expect(getConfigKey(setConfigKey({}, 'hooks.setup', ''), 'hooks.setup')).toBe('');
  });

  it('pins and hides are sets', () => {
    const c = setConfigKey(setConfigKey({}, 'hide:npm:prepare', true), 'hide:npm:prepare', true);
    expect(c).toEqual({ discovery: { hide: ['npm:prepare'] } });
    expect(listConfigKeys({ ...c, server: { start: 'make up' }, pins: ['npm:dev'] })).toEqual(['server.start', 'pin:npm:dev', 'hide:npm:prepare']);
  });

  it('says which layer wins and when a personal value masks the team one', () => {
    expect(keyScope({ server: { start: 'a' } }, { server: { start: 'b' } }, 'server.start')).toEqual({ layer: 'personal', masks: true });
    expect(keyScope({}, { server: { start: 'b' } }, 'server.start')).toEqual({ layer: 'shared', masks: false });
    expect(keyScope({}, null, 'server.start')).toEqual({ layer: null, masks: false });
  });

  it('rejects unknown keys', () => {
    expect(isWorktreeConfigKey('server.start')).toBe(true);
    expect(isWorktreeConfigKey('action:x')).toBe(true);
    expect(isWorktreeConfigKey('__proto__')).toBe(false);
    expect(() => setConfigKey({}, 'server.__proto__', 1)).not.toThrow(); // guarded upstream by isWorktreeConfigKey
  });
});
