# FocusAI current data model

> This document describes the persisted schema that exists today, not a speculative list of tables presented as implemented.

## Relationship map

```text
users 1 ─── 1 user_preferences
  │
  ├── * auth_sessions
  ├── * auth_audit_events
  ├── * projects ─── 0..* goals ─── * milestones
  ├── * goals (may have no project)
  ├── * tasks ─── * task_dependencies (task → prerequisite task)
  │       │
  │       ├── 0..1 goal
  │       ├── 0..1 parent task (confirmed breakdown step → container)
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

The migration ledger is created before the rest of the schema is inspected. Current schema version: **4**. Version 2 adds authentication/session tables and user columns; version 3 adds task breakdown metadata and its ownership-oriented index; version 4 adds owned projects, goals, milestones, and nullable task goal links. Every version is additive and does not reset existing local records.

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

| Column                                 | Notes                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `timezone`                             | Validated IANA zone; new users default to `UTC` and can update it through the authenticated Schedule & Capacity UI |
| `working_day_start`, `working_day_end` | Same-local-day planning window, defaults `09:00`/`18:00`; end must be later than start                             |
| `transition_minutes`                   | 0–60, default 10; passed to the deterministic planner                                                              |
| `high_cognitive_recovery_cap`          | 0–1, default 0.2; passed to recovery planning                                                                      |
| audit timestamps                       | UTC ISO timestamps                                                                                                 |

### `projects`

| Column                     | Notes                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `id`, `user_id`            | UUID/text primary key and owned user foreign key                |
| `title`, `description`     | Nonblank title up to 200 characters and optional stored context |
| `status`                   | `active` or `archived`                                          |
| `target_date`              | Optional ISO calendar date                                      |
| `created_at`, `updated_at` | UTC ISO timestamps                                              |

A project is an optional grouping for a user’s goals. New or moved goals can only be attached to an active project. Deleting a project preserves its goals by setting their `project_id` to null.

### `goals`

| Column                        | Notes                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `id`, `user_id`               | UUID/text primary key and owned user foreign key                        |
| `project_id`                  | Nullable project FK; set null when the grouping project is deleted      |
| `title`, `description`        | Nonblank title up to 200 characters and optional stored outcome context |
| `status`                      | `active`, `completed`, or `archived`                                    |
| `target_date`, `completed_at` | Optional ISO calendar date and completion timestamp                     |
| `created_at`, `updated_at`    | UTC ISO timestamps                                                      |

Goals are explicit context records, not inferred planner classifications. New task links and milestone edits require an active goal. A goal cannot move to `completed` while it has unfinished non-container linked tasks or pending milestones. Deleting a goal preserves linked tasks by setting `tasks.goal_id` to null and cascades only its milestones.

### `milestones`

| Column                        | Notes                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| `id`, `goal_id`               | UUID/text primary key and required cascade-owned goal foreign key |
| `title`                       | Nonblank title up to 200 characters                               |
| `status`                      | `pending` or `completed`                                          |
| `target_date`, `completed_at` | Optional ISO calendar date and completion timestamp               |
| `created_at`, `updated_at`    | UTC ISO timestamps                                                |

Milestones are reviewable goal checkpoints, not automatically generated subtasks. They are mutable only while their goal is active.

### `tasks`

| Column                                | Notes                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`, `user_id`                       | UUID and ownership foreign key                                                                                      |
| `title`, `description`                | Title is constrained to nonblank, max 200 characters                                                                |
| `status`                              | `backlog`, `todo`, `in_progress`, `done`                                                                            |
| `priority`                            | `low`, `medium`, `high`, `critical`                                                                                 |
| `impact`                              | Integer 1–5                                                                                                         |
| `estimate_minutes`                    | 1–720                                                                                                               |
| `actual_minutes`                      | Non-negative accumulated effort field                                                                               |
| `due_at`                              | Nullable UTC ISO timestamp                                                                                          |
| `cognitive_load`                      | `low`, `medium`, `high`                                                                                             |
| `goal_alignment`                      | Numeric 0–1 planning signal; it remains independent from the task’s explicit goal relationship                      |
| `goal_id`                             | Nullable owned-goal FK; deleting a goal sets this link to null while preserving the task                            |
| `blocked`                             | Boolean represented by constrained integer                                                                          |
| `parent_task_id`                      | Nullable self-reference; a confirmed step references its container; deleting that container sets this value to null |
| `is_decomposed`                       | Constrained boolean for an explicit breakdown container; defaults false so existing tasks remain actionable         |
| creation/update/completion timestamps | UTC ISO timestamps; completion is nullable                                                                          |

A decomposition is an explicit, transactional API action: reviewed child records are created first and the owned parent is marked as a container in the same transaction. The public general task update route cannot set either breakdown relationship field. Containers stay visible for history/context but are excluded from new planning candidates and focus starts; child records are ordinary independently editable tasks. A decomposition inherits the parent’s explicit `goal_id` server-side, while the user-authored `goal_alignment` value remains separate. Parent completion is rejected while any retained child is unfinished. Indexes support a user's status/update ordering, due-date lookups, goal lookup, and parent/child lookup.

### `task_dependencies`

A normalized self-join table.

| Column               | Rule                                       |
| -------------------- | ------------------------------------------ |
| `task_id`            | Required task FK, cascade deletion         |
| `depends_on_task_id` | Required prerequisite FK, cascade deletion |
| `created_at`         | UTC ISO timestamp                          |

The pair is unique and a task cannot directly depend on itself. Task create/update and confirmed-breakdown writes verify the referenced task belongs to the same user, reject non-actionable breakdown containers as prerequisites, and reject dependency cycles before any edge is replaced. The planner still reports ordinary unmet dependency sequencing as a deferred outcome.

### `calendar_events`

| Column                   | Notes                                               |
| ------------------------ | --------------------------------------------------- |
| `id`, `user_id`, `title` | Standard ownership fields                           |
| `start_at`, `end_at`     | Required UTC ISO timestamps; end must be later      |
| `is_fixed`               | Fixed events are excluded from automatic plan slots |
| audit timestamps         | UTC ISO timestamps                                  |

Authenticated users can create, list, update, and delete these local records through the Schedule & Capacity UI/API. Creation/update accepts a `datetime-local` wall-time value in the user's configured IANA zone; the API converts it to the persisted UTC instant and rejects ambiguous/nonexistent daylight-saving times. Fixed events are supplied to new plan drafts as commitments. Flexible events are stored/viewable but deliberately do not consume capacity. This is **manual local calendar data**, not external-calendar connection or sync support.

### `daily_plans`

| Column                                  | Notes                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `user_id`, `plan_date`            | Plan identity and date                                                                                                                                                                                             |
| `status`                                | `draft`, `accepted`, `superseded`                                                                                                                                                                                  |
| `type`                                  | `daily` or `recovery`                                                                                                                                                                                              |
| `readiness`                             | `low`, `steady`, `high`                                                                                                                                                                                            |
| `generated_at`, `accepted_at`           | Auditable timestamps; acceptance nullable                                                                                                                                                                          |
| `capacity_minutes`, `scheduled_minutes` | Real calculation totals                                                                                                                                                                                            |
| `context_json`                          | Stores the structured engine explanation snapshot plus, for new daily drafts, a saved editable-schedule feasibility context and optional manual-edit timestamp; it does **not** replace normalized task/block data |

A new draft supersedes earlier drafts for the same owned user/date. Accepting a plan supersedes any other accepted plan for that date. New daily drafts persist their resolved availability, profile-zone/workday/transition settings in `context_json` so a later whole-schedule edit can be checked without guessing. Existing plans keep their prior context and history; a legacy draft without this metadata is intentionally read-only until regenerated. Recovery drafts do not expose manual movement because recalculation is the honest remaining-day workflow.

### `scheduled_blocks`

| Column                      | Notes                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `id`, `plan_id`             | UUID/text primary/plan FK                                               |
| `task_id`                   | Nullable task FK; null on task deletion preserves historical block text |
| `title`                     | Snapshot title used for honest history                                  |
| `start_at`, `end_at`        | UTC ISO timestamps, end after start                                     |
| `duration_minutes`, `score` | Deterministic schedule result                                           |
| `created_at`                | UTC ISO timestamp                                                       |

The decision engine prevents generated overlap. A current daily draft can now receive one explicit complete-schedule update: the repository transaction checks ownership, exact block set, saved availability, current fixed commitments, transition spacing, actionability, and dependency ordering before updating these UTC instants. Accepted/superseded plans and recovery drafts are not editable. The database does not currently use a cross-row exclusion constraint; a production adapter should retain or strengthen this transaction-level conflict check.

### Derived current-day recovery signal

No table, migration, or audit record is created for a recovery signal. On an authenticated dashboard read, the repository combines the current IANA-local plan date, the operative daily plan, its stored blocks, owned task state, and active focus sessions. It returns only passed blocks whose task remains actionable, then the dashboard offers an explicit recovery action.

The derivation deliberately does **not** alter `tasks.status`, `completed_at`, `daily_plans`, `scheduled_blocks`, or focus history. Completed, blocked, deleted, decomposition-container, and actively focused tasks are excluded. If a recovery plan is already the operative current plan, the old daily plan does not produce a repeated signal. The user must explicitly create a recovery draft; that write preserves prior plan/block history.

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

The API prevents starting a second active/paused session for each authenticated user via a transaction-level service check and rejects a breakdown container as a focus target; a person should select one of its actionable steps. A database partial uniqueness constraint should accompany the production multi-user adapter.

## Deletion behavior

- Deleting a user cascades to their projects, goals, tasks, events, plans, and sessions; audit events retain a null user reference.
- Deleting a project preserves its goals with `project_id = NULL`; deleting a goal preserves linked tasks with `goal_id = NULL` and cascades its milestones.
- Deleting a task cascades its dependency rows; scheduled blocks and focus sessions preserve their historical record with `task_id = NULL` where configured. Deleting a breakdown container sets each retained child’s `parent_task_id` to `NULL`, releasing those records as standalone actionable tasks rather than deleting user-authored work.
- Deleting a plan cascades its scheduled blocks.

Formal account-deletion, export, retention, and restore workflows are not yet implemented.

## Timestamp and time-zone rules

- Persisted instants use ISO-8601 UTC text (`...Z`).
- Each user has a validated IANA `timezone` preference; plans use that zone to determine the planning date and convert `working_day_start`/`working_day_end` into UTC availability.
- Calendar UI values are local wall times in that preference zone. The server uses Temporal conversion and rejects a local time that is nonexistent or occurs twice during a daylight-saving transition instead of guessing.
- Changing the preference zone is a display/planning preference change, not a rewrite of historical UTC event/plan instants. An existing commitment can appear at a different wall time after the change because its actual moment is preserved. A manually editable draft is conservatively rejected after a relevant planning-preference change; regenerate it instead of reinterpreting old local values.
- Manual plan schedule inputs are profile-local `YYYY-MM-DDTHH:mm` values resolved by the API with the same Temporal/DST rejection rules as calendar events. Browser locale still controls language/number presentation. Broader browser and DST E2E coverage remains future work.
