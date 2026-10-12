import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_DEVELOPMENT_USER_ID } from '../config.js';
import { SCHEMA_VERSION, schemaSql } from './schema.js';

type SqlParameter = string | number | null;

export class FocusDatabase {
  private readonly connection: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.connection = new DatabaseSync(filename);
    this.connection.exec('PRAGMA foreign_keys = ON;');
    this.connection.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
    this.ensureLocalDevelopmentUser();
  }

  migrate(): void {
    // The migration ledger has to exist before its version can be queried.
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
    );
    const current = this.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations');
    if ((current?.version ?? 0) >= SCHEMA_VERSION) return;

    this.transaction(() => {
      this.connection.exec(schemaSql);
      this.run('INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)', [
        SCHEMA_VERSION,
        new Date().toISOString(),
      ]);
    });
  }

  ensureLocalDevelopmentUser(): void {
    const now = new Date().toISOString();
    this.run(
      `INSERT OR IGNORE INTO users(id, email, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [LOCAL_DEVELOPMENT_USER_ID, 'local@focusai.invalid', 'FocusAI local workspace', now, now],
    );
    this.run(
      `INSERT OR IGNORE INTO user_preferences(
        user_id, timezone, working_day_start, working_day_end, transition_minutes,
        high_cognitive_recovery_cap, created_at, updated_at
      ) VALUES (?, 'UTC', '09:00', '18:00', 10, 0.2, ?, ?)`,
      [LOCAL_DEVELOPMENT_USER_ID, now, now],
    );
  }

  run(sql: string, parameters: SqlParameter[] = []): void {
    this.connection.prepare(sql).run(...parameters);
  }

  get<T>(sql: string, parameters: SqlParameter[] = []): T | undefined {
    return this.connection.prepare(sql).get(...parameters) as T | undefined;
  }

  all<T>(sql: string, parameters: SqlParameter[] = []): T[] {
    return this.connection.prepare(sql).all(...parameters) as T[];
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      this.connection.exec('COMMIT;');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
