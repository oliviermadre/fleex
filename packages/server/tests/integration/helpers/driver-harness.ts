import type { HostFs } from '../../../src/infrastructure/host/types.js';
import type { LoggerPort } from '../../../src/application/ports/logger.port.js';

export const silentLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Each harness gets its own home so concurrent suites never share a JSON file. */
let homeCounter = 0;
export function uniqueHome(): string {
  homeCounter += 1;
  return `/tmp/fleex-contract-${process.pid}-${homeCounter}`;
}

/**
 * Migrates the shared test database at most once per worker.
 *
 * `runPendingMigrations` reads the applied-migrations table and then applies what
 * is missing. Two callers doing that at the same time both compute the same
 * "pending" list and collide on `CREATE TYPE` / `CREATE INDEX`. The contract
 * harness is rebuilt for every test, so without this memo each test re-entered
 * the migration runner. Across files, run the pgsql suites serially — see the
 * `test:pgsql` script.
 */
let pgMigration: Promise<void> | null = null;

export function migratePgsqlOnce(connection: unknown): Promise<void> {
  pgMigration ??= (async () => {
    const { runPendingMigrations } = await import('../../../src/infrastructure/migrations/run-migrations.js');
    await runPendingMigrations('pgsql', connection as never, silentLogger as never);
  })();
  return pgMigration;
}

/**
 * In-memory HostFs.
 *
 * Unlike tests/helpers/fakes.ts#FakeHostFs, a written file immediately reports
 * `exists() === true` — the JSON adapters gate loadFromDisk on exists(), so a
 * write-then-reload test needs faithful semantics here.
 */
export class MemoryHostFs implements HostFs {
  readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? '') + content);
  }

  async readdir(): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    return [];
  }

  async stat(): Promise<{ size: number; mtimeMs: number } | null> {
    return null;
  }

  async rm(path: string): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
  }

  async readTail(path: string): Promise<string> {
    return this.files.get(path) ?? '';
  }
}
