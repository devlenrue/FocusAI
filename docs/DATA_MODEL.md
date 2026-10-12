# FocusAI current data model

> This document describes the persisted schema that exists today, not a speculative list of tables presented as implemented.

## Relationship map

```text
users 1 ─── 1 user_preferences
  │
  ├── * auth_sessions
  ├── * auth_audit_events
  ├── * tasks ─── * task_dependencies (task → prerequisite task)
  │       │
  │       └── * scheduled_blocks
  │
  ├── * calendar_events
  ├── * daily_plans ─── * scheduled_blocks
  └── * focus_sessions ─── 0..1 task
```

All current tables use text UUID primary keys except the migration ledger. Every workspace record is now reached through a server-verified authenticated user ID; there is no default user context in repositories.

## Tables

### `schema_migrations`

| Column       | Type         | Rule        |
| ------------ | ------------ | ----------- |
| `version`    | integer      | Primary key |
| `applied_at` | UTC ISO text | Required    |

The migration ledger is created before the rest of the schema is inspected. Current schema version: **2**. Version 2 adds authentication/session tables and user columns without a destructive reset.

### `users`

| Column                     | Notes                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID/text primary key                                                                                       |
| `email`                    | Required; normalized case-insensitive unique index                                                          |
| `display_name`             | Required                                                                                                    |
| `password_hash`            | Nullable only for preserved version-1 local workspace migration; new accounts use memory-hard scrypt hashes |
| `is_active`                | Constrained boolean; active users may authenticate                                                          |
| `last_login_at`            | Nullable UTC ISO timestamp                                                                                  |
| `created_at`, `updated_at` | UTC ISO timestamps                                                                                          |

Passwords are never exposed through DTOs or logs. See [`AUTHENTICATION.md`](AUTHENTICATION.md) for the current security model.

### `auth_sessions`

| Column                                                   | Notes                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`, `user_id`                                          | Session ID and cascade-owned user foreign key                                              |
| `token_hash`                                             | Unique SHA-256 hash of an opaque HTTP-only cookie value; raw session token is never stored |
| `csrf_hash`                                              | SHA-256 hash of the session-bound CSRF token                                               |
| `expires_at`, `created_at`, `last_seen_at`, `revoked_at` | UTC ISO timestamps; revocation is nullable                                                 |

The active-session index supports owned session lookup/revocation.

### `auth_audit_events`

| Column          | Notes                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `id`, `user_id` | Event ID and nullable user reference (`SET NULL` on user deletion)                                  |
| `event_type`    | Constrained: registration, sign-in success/failure, sign-out, rotation, revocation, or legacy claim |
| `created_at`    | UTC ISO timestamp                                                                                   |

No password, reusable session/CSRF token, IP address, user-agent, note body, or email text is copied into this table.

### `user_preferences`

One row per user, foreign-keyed to `users` with cascade deletion.

| Column                                 | Notes                                         |
| -------------------------------------- | --------------------------------------------- |
| `timezone`                             | Current default `UTC`; settings UI is pending |
| `working_day_start`, `working_day_end` | Local adapter defaults `09:00`/`18:00`        |
| `transition_minutes`                   | 0–60, default 10                              |
| `high_cognitive_recovery_cap`          | 0–1, default 0.2                              |
| audit timestamps                       | UTC ISO timestamps                            |

### `tasks`

| Column                                | Notes                                                |
| ------------------------------------- | ---------------------------------------------------- |
| `id`, `user_id`                       | UUID and ownership foreign key                       |
| `title`, `description`                | Title is constrained to nonblank, max 200 characters |
| `status`                              | `backlog`, `todo`, `in_progress`, `done`             |
| `priority`                            | `low`, `medium`, `high`, `critical`                  |
| `impact`                              | Integer 1–5                                          |
| `estimate_minutes`                    | 1–720                                                |
| `actual_minutes`                      | Non-negative accumulated effort field                |
| `due_at`                              | Nullable UTC ISO timestamp                           |
| `cognitive_load`                      | `low`, `medium`, `high`                              |
| `goal_alignment`                      | Numeric 0–1; no goal CRUD exists yet                 |
| `blocked`                             | Boolean represented by constrained integer           |
| creation/update/completion timestamps | UTC ISO timestamps; completion is nullable           |

Indexes currently support a user's status/update ordering and due-date lookups.

### `task_dependencies`

A normalized self-join table.

| Column               | Rule                                       |
| -------------------- | ------------------------------------------ |
| `task_id`            | Required task FK, cascade deletion         |
| `depends_on_task_id` | Required prerequisite FK, cascade deletion |
| `created_at`         | UTC ISO timestamp                          |

The pair is unique and a task cannot directly depend on itself. Cycle detection is handled during planning as a deferred dependency outcome; an editor that prevents cycles is pending.

### `calendar_events`

| Column                   | Notes                                               |
| ------------------------ | --------------------------------------------------- |
| `id`, `user_id`, `title` | Standard ownership fields                           |
| `start_at`, `end_at`     | Required UTC ISO timestamps; end must be later      |
| `is_fixed`               | Fixed events are excluded from automatic plan slots |
| audit timestamps         | UTC ISO timestamps                                  |

The schema exists because the planning service already consumes fixed commitments. Calendar event CRUD/UI/external sync are not built yet and must not be advertised as connected calendar support.

### `daily_plans`

| Column                                  | Notes                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`, `user_id`, `plan_date`            | Plan identity and date                                                                                 |
| `status`                                | `draft`, `accepted`, `superseded`                                                                      |
| `type`                                  | `daily` or `recovery`                                                                                  |
| `readiness`                             | `low`, `steady`, `high`                                                                                |
| `generated_at`, `accepted_at`           | Auditable timestamps; acceptance nullable                                                              |
| `capacity_minutes`, `scheduled_minutes` | Real calculation totals                                                                                |
| `context_json`                          | Stores structured engine explanation snapshot only; it does **not** replace normalized task/block data |

A new draft supersedes earlier drafts for the same owned user/date. Accepting a plan supersedes any other accepted plan for that date.

### `scheduled_blocks`

| Column                      | Notes                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `id`, `plan_id`             | UUID/text primary/plan FK                                               |
| `task_id`                   | Nullable task FK; null on task deletion preserves historical block text |
| `title`                     | Snapshot title used for honest history                                  |
| `start_at`, `end_at`        | UTC ISO timestamps, end after start                                     |
| `duration_minutes`, `score` | Deterministic schedule result                                           |
| `created_at`                | UTC ISO timestamp                                                       |

The decision engine prevents generated overlap. The database does not currently use a cross-row exclusion constraint; external calendar/block editing will need a transaction-level conflict check in the production adapter.

### `focus_sessions`

| Column                                           | Notes                                         |
| ------------------------------------------------ | --------------------------------------------- |
| `id`, `user_id`, `task_id`                       | Standard ownership and optional linked task   |
| `planned_minutes`                                | 1–240                                         |
| `state`                                          | `active`, `paused`, `completed`, `stopped`    |
| `started_at`, `state_changed_at`, `completed_at` | Timestamp-backed state model                  |
| `accumulated_seconds`                            | Persisted duration excluding paused intervals |
| `note`                                           | Optional intentional focus note               |
| audit timestamps                                 | UTC ISO timestamps                            |

The API prevents starting a second active/paused session for each authenticated user via a transaction-level service check. A database partial uniqueness constraint should accompany the production multi-user adapter.

## Deletion behavior

- Deleting a user cascades to their preferences, tasks, events, plans, and sessions; audit events retain a null user reference.
- Deleting a task cascades its dependency rows; scheduled blocks and focus sessions preserve their historical record with `task_id = NULL` where configured.
- Deleting a plan cascades its scheduled blocks.

Formal account-deletion, export, retention, and restore workflows are not yet implemented.

## Timestamp and timezone rule today

- Persisted instants use ISO-8601 UTC text (`...Z`).
- The UI uses the browser locale for display.
- The local planning default is explicitly 09:00–18:00 **UTC**, not a fake representation of per-user local working hours.
- A future IANA timezone preference must define planning-day boundaries, DST behavior, and calendar conversion before timezone-aware planning can be claimed.
