import { Database } from 'bun:sqlite';
import { SQLITE_SCHEMA } from './schema.js';

/**
 * Adapt better-sqlite3–style named-param objects ({ id: 1 })
 * to bun:sqlite style ({ "@id": 1 }).  Positional args pass through unchanged.
 */
function adaptArgs(args: unknown[]): unknown[] {
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0])
  ) {
    const obj = args[0] as Record<string, unknown>;
    const adapted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      adapted[`@${key}`] = value;
    }
    return [adapted];
  }
  return args;
}

function wrapStatement(stmt: ReturnType<Database['prepare']>) {
  return {
    all(...args: unknown[]) {
      return stmt.all(...adaptArgs(args));
    },
    get(...args: unknown[]) {
      return stmt.get(...adaptArgs(args));
    },
    run(...args: unknown[]) {
      return stmt.run(...adaptArgs(args));
    },
  };
}

export class SqliteConnection {
  private _db: Database | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    this._db = new Database(this.dbPath);
    this._db.exec('PRAGMA journal_mode = WAL');
    this._db.exec('PRAGMA foreign_keys = ON');

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

  get db() {
    if (!this._db) {
      throw new Error('SqliteConnection not initialized. Call init() first.');
    }
    const realDb = this._db;
    return {
      prepare(sql: string) {
        return wrapStatement(realDb.prepare(sql));
      },
      exec(sql: string) {
        realDb.exec(sql);
      },
    };
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}
