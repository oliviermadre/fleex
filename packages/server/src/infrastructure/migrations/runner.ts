import type { Migration, MigrationContext, AdapterType } from './types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class MigrationRunner {
  constructor(
    private readonly adapter: AdapterType,
    private readonly ctx: MigrationContext,
    private readonly migrations: Migration[],
    private readonly logger: LoggerPort,
  ) {}

  async migrate(): Promise<void> {
    await this.ensureTrackingStore();
    const applied = await this.getApplied();
    const pending = this.migrations.filter((m) => !applied.includes(m.name));

    if (pending.length === 0) {
      this.logger.info('No pending migrations');
      return;
    }

    for (const migration of pending) {
      this.logger.info('Applying migration', { name: migration.name });
      await migration.up(this.ctx);
      await this.recordApplied(migration.name);
      this.logger.info('Migration applied', { name: migration.name });
    }
  }

  async rollback(toName?: string): Promise<void> {
    await this.ensureTrackingStore();
    const applied = await this.getApplied();

    if (applied.length === 0) {
      this.logger.info('No migrations to rollback');
      return;
    }

    // Reverse order: most recent first
    const toRollback = [...applied].reverse();
    for (const name of toRollback) {
      const migration = this.migrations.find((m) => m.name === name);
      if (!migration) {
        this.logger.info('Skipping unknown migration during rollback', { name });
        continue;
      }

      this.logger.info('Rolling back migration', { name });
      await migration.down(this.ctx);
      await this.removeApplied(name);
      this.logger.info('Migration rolled back', { name });

      if (toName && name === toName) break;
    }
  }

  async getApplied(): Promise<string[]> {
    const result = await this.queryRows('SELECT name FROM _migrations ORDER BY name');
    return result.map((r: { name: string }) => r.name);
  }

  private async ensureTrackingStore(): Promise<void> {
    const sql =
      this.adapter === 'sqlite'
        ? `CREATE TABLE IF NOT EXISTS _migrations (
             name       TEXT PRIMARY KEY,
             applied_at TEXT NOT NULL
           )`
        : `CREATE TABLE IF NOT EXISTS _migrations (
             name       TEXT PRIMARY KEY,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )`;
    await this.ctx.exec(sql);
  }

  private async recordApplied(name: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.adapter === 'sqlite') {
      await this.ctx.exec(
        `INSERT INTO _migrations (name, applied_at) VALUES ('${this.escapeSql(name)}', '${now}')`,
      );
    } else {
      await this.ctx.exec(
        `INSERT INTO _migrations (name, applied_at) VALUES ('${this.escapeSql(name)}', now())`,
      );
    }
  }

  private async removeApplied(name: string): Promise<void> {
    await this.ctx.exec(`DELETE FROM _migrations WHERE name = '${this.escapeSql(name)}'`);
  }

  private escapeSql(value: string): string {
    return value.replace(/'/g, "''");
  }

  // ── Query helper for reading rows (used by getApplied) ──

  private _queryRowsFn: ((sql: string) => Promise<{ name: string }[]>) | null = null;

  setQueryRowsFn(fn: (sql: string) => Promise<{ name: string }[]>): void {
    this._queryRowsFn = fn;
  }

  private async queryRows(sql: string): Promise<{ name: string }[]> {
    if (!this._queryRowsFn) {
      throw new Error('queryRowsFn not set on MigrationRunner');
    }
    return this._queryRowsFn(sql);
  }
}
