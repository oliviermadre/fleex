import { describe, it, expect } from 'vitest';
import { DEFAULT_STATUS_MODEL, type StatusModel } from '@fleex/shared';
import { JsonStatusModelStore } from '../../src/infrastructure/adapters/json-status-model-store.adapter.js';
import statusColumnsMigration from '../../src/infrastructure/migrations/migrations/021_add_status_columns.js';
import type { MigrationContext, AdapterType } from '../../src/infrastructure/migrations/types.js';
import type { HostFs } from '../../src/infrastructure/host/types.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

function fakeHostFs(): HostFs {
  const files = new Map<string, string>();
  return {
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p, c) { files.set(p, c); },
    async appendFile(p, c) { files.set(p, (files.get(p) ?? '') + c); },
    async readdir() { return []; },
    async stat() { return null; },
    async exists(p) { return files.has(p); },
    async mkdir() {},
    async rm(p) { files.delete(p); },
    async readTail() { return ''; },
  };
}

const noopLogger: LoggerPort = {
  info() {}, warn() {}, error() {}, debug() {},
} as unknown as LoggerPort;

describe('JsonStatusModelStore', () => {
  it('returns null when nothing is persisted (→ caller uses default)', async () => {
    const store = new JsonStatusModelStore(fakeHostFs(), '/home/test', noopLogger);
    expect(await store.getModel()).toBeNull();
  });

  it('round-trips a saved model', async () => {
    const store = new JsonStatusModelStore(fakeHostFs(), '/home/test', noopLogger);
    await store.saveModel(DEFAULT_STATUS_MODEL);
    const loaded = await store.getModel();
    expect(loaded).toEqual(DEFAULT_STATUS_MODEL);
  });

  it('persists a custom model verbatim', async () => {
    const store = new JsonStatusModelStore(fakeHostFs(), '/home/test', noopLogger);
    const model: StatusModel = {
      columns: [
        { key: 'icebox', label: 'Icebox', order: 0, startable: true, active: false, terminal: false, outcome: null, anchors: ['defaultNew', 'agentQueue'], collapsedByDefault: false },
        { key: 'wip', label: 'WIP', order: 1, startable: false, active: true, terminal: false, outcome: null, anchors: ['workStart'], collapsedByDefault: false },
        { key: 'shipped', label: 'Shipped', order: 2, startable: false, active: false, terminal: true, outcome: 'completed', anchors: ['mergeLanding'], collapsedByDefault: false },
      ],
    };
    await store.saveModel(model);
    expect(await store.getModel()).toEqual(model);
  });
});

function runMigrationUp(adapter: AdapterType): Promise<string[]> {
  const sql: string[] = [];
  const ctx: MigrationContext = {
    adapter,
    async exec(s) { sql.push(s); },
    dialect(v) { return v[adapter] ?? null; },
  };
  return statusColumnsMigration.up(ctx).then(() => sql);
}

describe('021_add_status_columns migration', () => {
  it('is a no-op on the json adapter', async () => {
    const sql = await runMigrationUp('json');
    expect(sql).toHaveLength(0);
  });

  it('creates the table and seeds the six default columns on sqlite', async () => {
    const sql = await runMigrationUp('sqlite');

    const creates = sql.filter((s) => s.includes('CREATE TABLE'));
    const inserts = sql.filter((s) => s.trim().startsWith('INSERT INTO status_columns'));
    expect(creates).toHaveLength(1);
    expect(inserts).toHaveLength(DEFAULT_STATUS_MODEL.columns.length);
    // sqlite booleans seeded as 1/0, not TRUE/FALSE
    expect(inserts.some((s) => /TRUE|FALSE/.test(s))).toBe(false);
    // every default key is seeded
    for (const c of DEFAULT_STATUS_MODEL.columns) {
      expect(inserts.some((s) => s.includes(`'${c.key}'`))).toBe(true);
    }
  });

  it('adds RLS policy only on supabase', async () => {
    const sql = await runMigrationUp('supabase');
    expect(sql.some((s) => s.includes('ROW LEVEL SECURITY'))).toBe(true);
    expect(sql.some((s) => s.includes('CREATE POLICY'))).toBe(true);
    // supabase booleans use TRUE/FALSE
    const inserts = sql.filter((s) => s.trim().startsWith('INSERT INTO status_columns'));
    expect(inserts.some((s) => /TRUE|FALSE/.test(s))).toBe(true);
  });
});
