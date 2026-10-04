import { describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  parseComposerJson,
  parseLaunchJson,
  parseMakefile,
  parsePackageJson,
  stripJsonc,
} from './worktree-discovery.js';

describe('parseLaunchJson', () => {
  it('turns each configuration into a start target with its port, cwd and env', () => {
    // WHY: monorepos declare one configuration per app; each must be startable on its own,
    // in its own folder, with the port Fleex will wait for.
    const items = parseLaunchJson(`{
      // Claude Desktop writes comments and trailing commas
      "version": "0.0.1",
      "configurations": [
        { "name": "web", "runtimeExecutable": "pnpm", "runtimeArgs": ["--filter", "web", "dev"], "port": 5173, "cwd": "\${workspaceFolder}/apps/web", "env": { "DEBUG": "1" } },
        { "name": "api", "program": "\${workspaceFolder}/server.js", "args": ["--port", "4000"], "url": "http://localhost:4000/health", },
      ],
    }`);
    expect(items).toEqual([
      { id: 'launch:web', source: 'launch', label: 'web', command: 'pnpm --filter web dev', mode: 'terminal', cwd: 'apps/web', env: { DEBUG: '1' }, port: 5173 },
      { id: 'launch:api', source: 'launch', label: 'api', command: 'node server.js --port 4000', mode: 'terminal', url: 'http://localhost:4000/health' },
    ]);
  });

  it('never runs outside the worktree: an absolute or escaping cwd is dropped', () => {
    const items = parseLaunchJson(JSON.stringify({ configurations: [
      { name: 'a', runtimeExecutable: 'x', cwd: '/etc' },
      { name: 'b', runtimeExecutable: 'x', cwd: '${workspaceFolder}/../other' },
    ] }));
    expect(items.map((i) => i.cwd)).toEqual([undefined, undefined]);
  });

  it('ignores configurations it cannot run and an unreadable file', () => {
    expect(parseLaunchJson(JSON.stringify({ configurations: [{ name: 'attach', request: 'attach' }, { runtimeExecutable: 'x' }] }))).toEqual([]);
    expect(parseLaunchJson('{ not json')).toEqual([]);
  });

  it('keeps // inside strings when stripping comments', () => {
    expect(JSON.parse(stripJsonc('{"u": "http://x" // c\n}'))).toEqual({ u: 'http://x' });
  });
});

describe('package.json scripts', () => {
  it('runs scripts with the package manager the lockfile says, pnpm first', () => {
    // WHY: running `npm run` in a pnpm repo installs nothing but can resolve the wrong binaries.
    expect(detectPackageManager(new Set(['pnpm-lock.yaml', 'bun.lock']))).toBe('pnpm');
    expect(detectPackageManager(new Set(['yarn.lock']))).toBe('yarn');
    expect(detectPackageManager(new Set(['bun.lockb']))).toBe('bun');
    expect(detectPackageManager(new Set())).toBe('npm');
    const items = parsePackageJson(JSON.stringify({ scripts: { dev: 'vite', 'test:watch': 'vitest' } }), 'pnpm');
    expect(items.map((i) => [i.id, i.command])).toEqual([['npm:dev', 'pnpm run dev'], ['npm:test:watch', 'pnpm run test:watch']]);
    expect(parsePackageJson(JSON.stringify({ scripts: { dev: 'vite' } }), 'yarn')[0]!.command).toBe('yarn dev');
  });
});

describe('parseMakefile', () => {
  it('lists real targets in file order, without special, pattern or variable lines', () => {
    const items = parseMakefile([
      '.PHONY: up down',
      'PORT := 8080',
      'CC ::= gcc',
      'up: build',
      '\tdocker compose up',
      'down:',
      '%.o: %.c',
      'db-migrate : up',
      'up:',
    ].join('\n'));
    expect(items.map((i) => i.id)).toEqual(['make:up', 'make:down', 'make:db-migrate']);
    expect(items[0]!.command).toBe('make up');
  });
});

describe('parseComposerJson', () => {
  it('lists scripts but not the pre-/post- event hooks composer runs by itself', () => {
    const items = parseComposerJson(JSON.stringify({ scripts: { serve: 'php -S', test: 'phpunit', 'post-install-cmd': 'x', 'pre-update-cmd': 'y' } }));
    expect(items.map((i) => i.id)).toEqual(['composer:serve', 'composer:test']);
  });
});
