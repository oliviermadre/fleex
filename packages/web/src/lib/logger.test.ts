import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LogLevel, Logger } from './logger';

/**
 * Front logger (#371, from #362). The point of this module is that diagnostics
 * become *filterable* and *recoverable*: the console is gated by a level, the
 * ring buffer never is. Both halves are tested here — a logger that only proved
 * "it calls console.error" would not encode why this replaced raw console.*.
 *
 * Each test re-imports the module (`loadLogger`) because level resolution and
 * the buffer are module-level state resolved once at init.
 */

type LoggerModule = {
  createLogger: (scope: string) => Logger;
  getLogLevel: () => LogLevel;
  setLogLevel: (level: LogLevel) => void;
};

async function loadLogger(): Promise<LoggerModule> {
  vi.resetModules();
  return (await import('./logger')) as LoggerModule;
}

const handle = () => window.__fleexLog!;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__fleexLog;
});

describe('level filtering', () => {
  it('drops debug and info at level warn, keeps warn and error', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('warn');
    const log = createLogger('stores/foo');

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('emits debug once the level is lowered to debug', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');

    createLogger('stores/foo').debug('d');

    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('emits nothing to the console and captures nothing when silent', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('silent');

    const log = createLogger('stores/foo');
    log.debug('d');
    log.error('e');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(handle().entries()).toEqual([]);
  });
});

describe('console output', () => {
  it('prefixes the message with the scope', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');

    createLogger('stores/foo').error('Failed to load skills');

    expect(console.error).toHaveBeenCalledWith('[fleex:stores/foo] Failed to load skills');
  });

  it('omits the second argument entirely when there is no data', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');

    createLogger('stores/foo').error('boom');

    expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(1);
  });

  it('normalizes Error values in data to { name, message, stack }', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');

    createLogger('stores/foo').error('Failed to load skills', { err: new Error('boom'), id: 7 });

    expect(console.error).toHaveBeenCalledWith('[fleex:stores/foo] Failed to load skills', {
      err: { name: 'Error', message: 'boom', stack: expect.any(String) },
      id: 7,
    });
  });
});

describe('ring buffer', () => {
  it('captures entries below the console level so prod debug logs stay recoverable', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('warn');

    createLogger('stores/foo').debug('invisible but recorded', { id: 1 });

    expect(console.debug).not.toHaveBeenCalled();
    expect(handle().entries()).toEqual([
      {
        ts: expect.any(String),
        level: 'debug',
        scope: 'stores/foo',
        msg: 'invisible but recorded',
        data: { id: 1 },
      },
    ]);
  });

  it('keeps only the last 200 entries, oldest first', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');
    const log = createLogger('stores/foo');

    for (let i = 1; i <= 250; i++) log.debug(`call ${i}`);

    const entries = handle().entries();
    expect(entries).toHaveLength(200);
    expect(entries[0]?.msg).toBe('call 51');
    expect(entries[199]?.msg).toBe('call 250');
  });

  it('dumps the buffer as parseable JSON for pasting into a bug report', async () => {
    const { createLogger, setLogLevel } = await loadLogger();
    setLogLevel('debug');

    createLogger('stores/foo').error('boom', { err: new Error('nope') });

    const parsed = JSON.parse(handle().dump());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].data.err.message).toBe('nope');
  });
});

describe('level resolution', () => {
  it('reads the level from localStorage', async () => {
    localStorage.setItem('fleex:logLevel', 'error');

    const { getLogLevel } = await loadLogger();

    expect(getLogLevel()).toBe('error');
  });

  it('lets ?log= win over localStorage and persists it across the navigation', async () => {
    localStorage.setItem('fleex:logLevel', 'error');
    window.history.replaceState({}, '', '/?log=debug');

    const { getLogLevel } = await loadLogger();

    expect(getLogLevel()).toBe('debug');
    expect(localStorage.getItem('fleex:logLevel')).toBe('debug');
  });

  it('falls back to the build default on an unrecognized stored value', async () => {
    localStorage.setItem('fleex:logLevel', 'lol');

    const { getLogLevel, createLogger } = await loadLogger();

    expect(getLogLevel()).toBe('debug'); // import.meta.env.DEV is true under vitest
    expect(() => createLogger('stores/foo').debug('d')).not.toThrow();
  });

  it('survives a localStorage that throws (Safari private mode)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    window.history.replaceState({}, '', '/?log=warn');

    const { createLogger, getLogLevel, setLogLevel } = await loadLogger();

    expect(getLogLevel()).toBe('warn');
    expect(() => createLogger('stores/foo').error('boom')).not.toThrow();
    expect(() => setLogLevel('debug')).not.toThrow();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('exposes the level through the window handle', async () => {
    const { setLogLevel } = await loadLogger();
    setLogLevel('error');

    expect(handle().getLevel()).toBe('error');

    handle().setLevel('debug');
    expect(handle().getLevel()).toBe('debug');
  });
});
