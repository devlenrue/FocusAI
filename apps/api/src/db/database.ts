import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./schema.js";

type SqlParameter = string | number | null;

/**
 * Thin local relational adapter. It owns additive schema migration and a small
 * transaction API; application services never compose raw connection state.
 */
export class FocusDatabase {
  private readonly connection: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.connection = new DatabaseSync(filename);
    this.connection.exec("PRAGMA foreign_keys = ON;");
    this.connection.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate(): void {
    // The ledger precedes every versioned migration so an interrupted upgrade
    // never needs a destructive database reset.
    this.connection.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    const current =
      this.get<{ version: number | null }>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      )?.version ?? 0;

    for (const migration of migrations) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.run(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          [migration.version, new Date().toISOString()],
        );
      });
    }
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
    this.connection.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.connection.exec("COMMIT;");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK;");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
