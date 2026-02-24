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
