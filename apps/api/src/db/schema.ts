export interface SchemaMigration {
  version: number;
  sql: string;
}

/**
 * Migrations are intentionally additive. New workspaces apply each version in
 * order; existing v1 local workspaces receive only the v2 auth migration.
 */
export const SCHEMA_VERSION = 2;

const schemaV1Sql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  working_day_start TEXT NOT NULL DEFAULT '09:00',
  working_day_end TEXT NOT NULL DEFAULT '18:00',
  transition_minutes INTEGER NOT NULL DEFAULT 10 CHECK (transition_minutes >= 0 AND transition_minutes <= 60),
  high_cognitive_recovery_cap REAL NOT NULL DEFAULT 0.2 CHECK (high_cognitive_recovery_cap >= 0 AND high_cognitive_recovery_cap <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  impact INTEGER NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  estimate_minutes INTEGER NOT NULL DEFAULT 30 CHECK (estimate_minutes BETWEEN 1 AND 720),
  actual_minutes INTEGER NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  due_at TEXT,
  cognitive_load TEXT NOT NULL DEFAULT 'medium' CHECK (cognitive_load IN ('low', 'medium', 'high')),
  goal_alignment REAL NOT NULL DEFAULT 0 CHECK (goal_alignment BETWEEN 0 AND 1),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_updated ON tasks(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_at);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependency ON task_dependencies(depends_on_task_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  is_fixed INTEGER NOT NULL DEFAULT 1 CHECK (is_fixed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_time ON calendar_events(user_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'superseded')),
  type TEXT NOT NULL DEFAULT 'daily' CHECK (type IN ('daily', 'recovery')),
  readiness TEXT NOT NULL DEFAULT 'steady' CHECK (readiness IN ('low', 'steady', 'high')),
  generated_at TEXT NOT NULL,
  accepted_at TEXT,
  capacity_minutes INTEGER NOT NULL DEFAULT 0,
  scheduled_minutes INTEGER NOT NULL DEFAULT 0,
  context_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date_generated ON daily_plans(user_id, plan_date, generated_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_blocks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_plan_time ON scheduled_blocks(plan_id, start_at);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes BETWEEN 1 AND 240),
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'completed', 'stopped')),
  started_at TEXT NOT NULL,
  state_changed_at TEXT NOT NULL,
  completed_at TEXT,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_seconds >= 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_state ON focus_sessions(user_id, state, started_at DESC);
`;

const schemaV2Sql = `
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE users ADD COLUMN last_login_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(lower(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('registered', 'signed_in', 'sign_in_failed', 'signed_out', 'session_rotated', 'sessions_revoked', 'legacy_workspace_claimed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_events_user_time ON auth_audit_events(user_id, created_at DESC);
`;

export const migrations: readonly SchemaMigration[] = [
  { version: 1, sql: schemaV1Sql },
  { version: 2, sql: schemaV2Sql },
];
