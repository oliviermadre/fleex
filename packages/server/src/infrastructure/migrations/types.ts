export type AdapterType = 'json' | 'sqlite' | 'pgsql' | 'supabase';

export interface MigrationContext {
  adapter: AdapterType;
  exec(sql: string): Promise<void>;
  /** Select SQL by dialect. Returns null for adapters without a matching key. */
  dialect(variants: Partial<Record<AdapterType, string | null>>): string | null;
}

export interface Migration {
  name: string;
  up(ctx: MigrationContext): Promise<void>;
  down(ctx: MigrationContext): Promise<void>;
}
