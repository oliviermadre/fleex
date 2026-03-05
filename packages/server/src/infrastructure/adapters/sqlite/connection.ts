import Database from 'better-sqlite3';
import { SQLITE_SCHEMA } from './schema.js';

export class SqliteConnection {
  private _db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    this._db = new Database(this.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');

    for (const statement of SQLITE_SCHEMA) {
      this._db.exec(statement);
    }

    // Safe column migrations for existing databases
    this.migrateColumns();
  }

  private migrateColumns(): void {
    const db = this._db!;
    const migrations: [string, string][] = [
      ['boards', 'ALTER TABLE boards ADD COLUMN next_display_id INTEGER NOT NULL DEFAULT 1'],
      ['tickets', 'ALTER TABLE tickets ADD COLUMN display_id INTEGER NOT NULL DEFAULT 0'],
      ['agent_event_executions', 'ALTER TABLE agent_event_executions ADD COLUMN sdk_session_id TEXT'],
      ['agent_event_executions', 'ALTER TABLE agent_event_executions ADD COLUMN last_event_at TEXT'],
    ];

    for (const [table, sql] of migrations) {
      try {
        db.exec(sql);
      } catch (err: unknown) {
        // Ignore "duplicate column" errors — column already exists
        if (err instanceof Error && err.message.includes('duplicate column')) continue;
        throw err;
      }
    }
  }

  get db(): Database.Database {
    if (!this._db) {
      throw new Error('SqliteConnection not initialized. Call init() first.');
    }
    return this._db;
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}
