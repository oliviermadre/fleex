import { describe, expect, it } from 'vitest';
import { mergeWorktreeConfig } from './worktree-config-merge.js';
import type { DetectedItem } from './worktree-discovery.js';

const launch: DetectedItem[] = [{ id: 'launch:web', source: 'launch', label: 'web', command: 'pnpm dev', mode: 'terminal', port: 5173 }];
const detected: DetectedItem[] = [
  { id: 'npm:dev', source: 'npm', label: 'dev', command: 'pnpm run dev', mode: 'terminal' },
  { id: 'npm:prepare', source: 'npm', label: 'prepare', command: 'pnpm run prepare', mode: 'terminal' },
  { id: 'make:up', source: 'make', label: 'up', command: 'make up', mode: 'terminal' },
];

describe('mergeWorktreeConfig', () => {
  it('lists every detected command with no config at all', () => {
    // WHY: discovery is the differentiator — a repo nobody configured still gets its commands.
    const merged = mergeWorktreeConfig({ launch, detected });
    expect(merged.items.map((i) => [i.id, i.layer])).toEqual([
      ['launch:web', 'launch'], ['npm:dev', 'detected'], ['npm:prepare', 'detected'], ['make:up', 'detected'],
    ]);
    expect(merged.start).toBeNull();
    expect(merged.clickByState).toEqual({ stopped: 'start', starting: 'logs', running: 'open', error: 'logs' });
  });

  it('lets the personal layer mask a shared action of the same id, or hide it', () => {
    const merged = mergeWorktreeConfig({
      shared: { actions: [{ id: 'migrate', cmd: 'make db-migrate' }, { id: 'seed', cmd: 'make seed' }] },
      personal: { actions: [{ id: 'migrate', cmd: 'make db-migrate FAST=1', mode: 'terminal' }, { id: 'seed', cmd: '', hidden: true }] },
      launch: [], detected: [],
    });
    expect(merged.items).toEqual([
      { id: 'migrate', source: 'action', layer: 'personal', label: 'migrate', command: 'make db-migrate FAST=1', mode: 'terminal', pinned: false },
    ]);
  });

  it('adds up personal and shared pins', () => {
    const merged = mergeWorktreeConfig({ shared: { pins: ['npm:dev'] }, personal: { pins: ['make:up'] }, launch, detected });
    expect(merged.items.filter((i) => i.pinned).map((i) => i.id)).toEqual(['npm:dev', 'make:up']);
  });

  it('resolves a reference to a detected item, and a customised detected item stays in its group', () => {
    const merged = mergeWorktreeConfig({
      personal: { actions: [{ id: 'web-bg', label: 'web (bg)', cmd: 'launch:web' }, { id: 'npm:dev', cmd: 'npm:dev', mode: 'background' }] },
      launch, detected,
    });
    expect(merged.items.find((i) => i.id === 'web-bg')).toMatchObject({ command: 'pnpm dev', port: 5173, mode: 'background', source: 'action' });
    const dev = merged.items.filter((i) => i.id === 'npm:dev');
    expect(dev).toHaveLength(1);
    expect(dev[0]).toMatchObject({ source: 'npm', layer: 'personal', mode: 'background', command: 'pnpm run dev' });
  });

  it('honours discovery sources and hides', () => {
    const merged = mergeWorktreeConfig({ shared: { discovery: { sources: ['npm'], hide: ['npm:prepare'] } }, launch, detected });
    expect(merged.items.map((i) => i.id)).toEqual(['npm:dev']);
  });

  it('resolves server.start to an item (keeping its port) or a raw command; personal keys win', () => {
    const fromItem = mergeWorktreeConfig({ shared: { server: { start: 'launch:web', stop: 'docker compose stop' } }, personal: { server: { url: 'http://localhost:${port}/app' } }, launch, detected });
    expect(fromItem.start).toMatchObject({ id: 'launch:web', command: 'pnpm dev' });
    expect(fromItem.start?.item?.port).toBe(5173);
    expect(fromItem.server).toEqual({ start: 'launch:web', stop: 'docker compose stop', url: 'http://localhost:${port}/app' });
    expect(mergeWorktreeConfig({ personal: { server: { start: 'make serve' } }, launch, detected }).start).toEqual({ command: 'make serve', label: 'start' });
  });

  it('resolves Stop, Logs and the probe to the command of an existing action or detected item, like Start', () => {
    // One action written once ("stop instance") must serve as the Stop verb too, without copying its command.
    const merged = mergeWorktreeConfig({
      personal: {
        actions: [{ id: 'stop-instance', label: 'stop instance', cmd: './cli/fleex stop' }],
        server: { stop: 'stop-instance', logs: 'make:up', probe: { command: 'npm:dev', intervalSec: 15 } },
      },
      launch,
      detected,
    });
    expect(merged.server.stop).toBe('./cli/fleex stop');
    expect(merged.server.logs).toBe('make up');
    expect(merged.server.probe).toEqual({ command: 'pnpm run dev', intervalSec: 15 });
    // A raw command that is no id stays as is.
    const raw = mergeWorktreeConfig({ personal: { server: { stop: 'docker compose stop', logs: 'docker compose logs -f' } }, launch, detected });
    expect(raw.server).toMatchObject({ stop: 'docker compose stop', logs: 'docker compose logs -f' });
  });

  it('a background Start makes the server detached, whatever mode was saved', () => {
    // WHY: with no TTY there is nowhere for a server to stay — the command must hand back.
    expect(mergeWorktreeConfig({ personal: { server: { start: 'docker compose up -d', startIn: 'background', mode: 'foreground' } }, launch, detected }).server.mode).toBe('detached');
    expect(mergeWorktreeConfig({ personal: { server: { start: 'pnpm dev', startIn: 'terminal', mode: 'foreground' } }, launch, detected }).server.mode).toBe('foreground');
  });

  it('starts from a detected item even when discovery hides it from the menu', () => {
    const merged = mergeWorktreeConfig({ shared: { server: { start: 'make:up' }, discovery: { sources: ['npm'] } }, launch, detected });
    expect(merged.start).toMatchObject({ id: 'make:up', command: 'make up' });
  });
});
