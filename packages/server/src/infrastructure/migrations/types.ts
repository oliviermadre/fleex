export type AdapterType = 'sqlite' | 'pgsql' | 'supabase';

export interface MigrationContext {
  adapter: AdapterType;
  exec(sql: string): Promise<void>;
  /**
   * Read rows. Needed by migrations that must inspect the existing schema —
   * notably SQLite table rebuilds, which have to read the current CREATE TABLE
   * statement because SQLite has no `ALTER COLUMN`.
   */
  query(sql: string): Promise<Record<string, unknown>[]>;
  /** Select SQL by dialect. Returns null for adapters without a matching key. */
  dialect(variants: Partial<Record<AdapterType, string | null>>): string | null;
}

export interface Migration {
  name: string;
  up(ctx: MigrationContext): Promise<void>;
  down(ctx: MigrationContext): Promise<void>;
}
