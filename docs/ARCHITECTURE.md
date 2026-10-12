# FocusAI architecture — current vertical slice

## Scope and design decision

The audited repository had no application code. Rather than inventing a full production stack without a runnable baseline, FocusAI now uses a small, testable monorepo that delivers one real end-to-end loop:

> capture a task → rank it → generate/review a plan → focus against it → persist the outcome

This is an additive foundation, not a claim that every future module already exists.

## Runtime topology

```text
┌───────────────────────────┐       relative /api/v1       ┌──────────────────────────────┐
│ apps/web                  │ ───────────────────────────► │ apps/api                     │
│ React + Vite + TS         │ ◄─────────────────────────── │ Fastify + TS                 │
│ React Query cache         │          JSON responses      │ validation / error boundary  │
└───────────────────────────┘                               └─────────────┬────────────────┘
                                                                      │
                                              ┌───────────────────────┼────────────────────────┐
                                              │                       │                        │
                                   ┌──────────▼──────────┐ ┌──────────▼──────────┐ ┌────────▼───────┐
                                   │ repositories        │ │ decision engine     │ │ local SQLite    │
                                   │ task / goal / plan  │ │ pure TS package     │ │ schema/migrate  │
                                   └─────────────────────┘ └─────────────────────┘ └────────────────┘
```

### Browser/API boundary

The web client uses `/api/v1/*`, never `localhost` or a hard-coded remote API host. In Vite development, the proxy targets `127.0.0.1:3001`; thus the browser stays same-origin from its perspective. Vite accepts Arena's preview host explicitly via `allowedHosts: true` because the preview address is generated per sandbox.

### Server modules

| Module                                  | Responsibility                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts`                   | Fastify construction, opaque cookie/session wiring, CSRF guard, rate limits, headers/CORS, OpenAPI UI, routes, consistent errors and request IDs         |
| `apps/api/src/services/auth.ts`         | Registration/sign-in, opaque session issue/rotation/revocation, ownership context, minimal audit events, legacy local-data claim                         |
| `apps/api/src/security/passwords.ts`    | Memory-hard scrypt hashing and constant-time password verification                                                                                       |
| `apps/api/src/db/database.ts`           | Local connection lifecycle, migration ledger, foreign-key/WAL pragmas, transaction wrapper                                                               |
| `apps/api/src/db/schema.ts`             | Versioned current schema definition                                                                                                                      |
| `apps/api/src/services/repositories.ts` | Repository/service boundaries for owned projects/goals/milestones, preferences, calendar events, tasks, focus sessions, plans, and dashboard aggregation |
| `apps/api/src/services/time.ts`         | IANA zone validation plus Temporal-backed local-wall-time ↔ UTC conversion with daylight-saving ambiguity rejection                                      |
| `packages/decision-engine`              | Pure ranking/scheduling/recovery rules; no HTTP, database, or provider dependency                                                                        |

## Why the decision engine is separate

Feasibility should never depend on a language model response. The `@focusai/decision-engine` package receives plain task, availability, commitment, and preference values and returns structured recommendations. It owns:

- ranking / reason generation;
- time interval subtraction and non-overlap;
- dependency ordering;
- capacity and explicit deferral;
- recovery capacity rules.

It does **not** query a database, access a user identity, call an LLM, or mutate a plan. The API converts owned database records to domain inputs, invokes it, and persists a draft transactionally. This prevents a UI or optional AI provider from bypassing essential feasibility logic.

## Local persistence and migration strategy

The current adapter uses Node 22's `node:sqlite` module and opens a git-ignored development file. It is intentionally contained behind `FocusDatabase` and repository classes.

1. Startup enables foreign keys and WAL mode.
2. It ensures a migration ledger exists.
3. It checks the latest applied schema version.
4. It applies the additive schema SQL in a transaction and records the version.
5. It does not create an account or sample activity; a user registers through the real authentication flow.

No startup reset, seed task, migration deletion, or test data is directed at the normal local database. API integration tests inject a separate temporary database instance.

### Why not claim MySQL/Prisma today?

The repository had no database service, credentials, database driver, or existing ORM. Node's built-in SQLite made a real, testable relational persistence slice possible without pretending a database server was provisioned. It is a **development adapter**, not a production selection. Increment 2 has introduced authenticated request context; a supported production relational adapter/migration workflow remains planned. The current normalized schema/repositories are designed to make that replacement bounded.

## Authentication and authorization boundary

FocusAI now exposes a real registration/sign-in experience and uses server-verified opaque cookie sessions. `onRequest` resolves a session hash to an `AuthContext`; every workspace route has a read or write auth pre-handler. Repository methods require a user ID—there is no longer a default local user context.

Unsafe routes additionally verify a session-bound double-submit CSRF token. The readable CSRF cookie must match the `X-CSRF-Token` header and a hash stored against the session. Session values themselves are HTTP-only and only hashes are persisted. Registration/sign-in routes have stricter rate limits, and minimal audit events exclude passwords/tokens/private note bodies.

See [`AUTHENTICATION.md`](AUTHENTICATION.md) for the exact current protocol, password parameters, legacy claim behavior, and remaining hosted-production requirements.

## Availability, calendar, and time-zone boundary

`user_preferences` now contains an authenticated user's IANA zone, same-day working window, transition buffer, and recovery cap. The API validates IANA zone identifiers and uses `@js-temporal/polyfill` on the server to convert preference-local working hours and calendar-event wall times into persisted UTC instants. It rejects ambiguous or nonexistent daylight-saving transition times rather than silently moving a commitment.

Calendar event CRUD is server-owned like every other workspace record. `is_fixed = true` commitments are passed into the deterministic engine and subtracted from generated **future drafts**. Flexible events remain visible in the schedule but do not consume planning capacity. Existing event instants are preserved when a user changes display time zone; their wall-clock rendering and future workday calculation change deliberately. Approved plans and historical records are not rewritten.

## Task editing and confirmed breakdown boundary

The Task Workspace keeps rapid capture separate from richer editing. An editor can update every supported task field and owned prerequisite list. Repository writes validate ownership for every referenced dependency and reject self-dependencies, dependency cycles, and breakdown containers as prerequisites.

A breakdown is intentionally **not** automatic or AI-generated. The client holds locally reviewed step drafts until the user presses the explicit confirmation control. `POST /tasks/:taskId/decompose` then runs one owned transaction: it creates the supplied child tasks and marks the parent `is_decomposed = true`. The parent remains in task history/context, while both `PlanRepository` and dashboard ranking remove it from new planning candidates. Focus starts reject the container. This avoids booking an aggregate task alongside the actual steps without rewriting historical accepted plans or blocks. Child steps are normal tasks: users can edit their fields/dependencies after creation. Their goal link is inherited from the parent server-side, while their user-authored goal-alignment score is unchanged. Deleting a container preserves those child records by setting their parent reference to null.

## Projects, goals, and milestones boundary

The Goals & Milestones workspace persists user-owned projects, goals, and milestones rather than presenting inferred or sample goal progress. A project optionally groups goals; deleting it releases its goals rather than deleting them. A goal may link real owned tasks and explicit milestones. Deleting a goal releases task links and cascades only its milestones.

Lifecycle checks are server-side: new/moved goals need an active project, new task links and milestone edits need an active goal, and a goal cannot complete while persisted non-container task work or milestones remain unfinished. Existing completed task history can remain linked to a completed/archived goal, but work cannot be silently reopened under a completed goal. `goal_alignment` remains a separate numeric decision-engine input: linking a goal never changes planner ranking, drafts, or accepted schedules automatically.

## Manual daily-draft scheduling boundary

A plan is still generated by the deterministic engine first. A user can then enter an explicit edit mode for a current **daily draft** and submit the complete set of block start positions via `PATCH /plans/:planId/blocks`. The browser sends `datetime-local` values, but the API resolves them against the authenticated user's IANA preference rather than the browser machine zone.

The repository writes no partial move. In one transaction it verifies that the request contains every current block exactly once, then checks the complete proposed schedule against the draft's saved availability snapshot, current fixed commitments, configured transition buffer, current task actionability, and dependency ordering. It only persists the times if every check succeeds. The engine's generation timestamp/reasons remain a snapshot; `context_json` records a manual-edit timestamp rather than pretending the engine regenerated the result. The browser suite exercises a feasible save, a fixed-commitment overlap rejection, and a dependent task's transparent deferral when its prerequisite cannot be scheduled; it then reads the plan back to prove the previously saved schedule/history was not overwritten.

Accepted/superseded plans are immutable history, and recovery drafts deliberately use recalculation instead of manual movement. Drafts created before this saved feasibility context are shown but cannot be edited; regenerating produces an editable daily draft. This preserves existing plans and avoids guessing how legacy constraints should be reconstructed.

## Current-day recovery signal boundary

`DashboardService` asks `PlanRepository` for a derived recovery signal on every authenticated dashboard read. It is intentionally a **read-only** check, not a background job or a productivity score: it looks only at the operative plan for the user's current IANA-local date and finds ended blocks whose owned task is still actionable. Completed, blocked, deleted, breakdown-container, and actively focused tasks do not produce the signal.

The response supplies the affected block snapshot and planned minutes only. It does not mutate a task, plan, or focus session. The dashboard uses neutral language and routes the person to Planning Studio, where a separate explicit **Create recovery draft** action invokes the existing remaining-capacity generator. The prior plan is preserved as history and the user's configurable recovery high-cognitive cap remains authoritative. A current recovery plan suppresses the original daily prompt rather than repeatedly framing it as overdue work.

## API conventions

- Version prefix: `/api/v1`.
- JSON input is validated with Zod before calling services.
- Structured errors contain `code`, safe `message`, and Fastify `requestId`.
- `401` represents missing/revoked sessions, `403` a rejected CSRF write, `404` an owned-resource absence, `409` impossible transitions/concurrent focus, and `400` validation.
- Helmet supplies security headers. API logs redact authorization/cookie headers and password request fields.
- `/api/docs` exposes the currently registered OpenAPI interface.

Current routes are listed in the README; endpoint coverage grows only when the corresponding workflow is implemented.

## Current timer model

Focus sessions store:

- `started_at`;
- `state_changed_at`;
- `accumulated_seconds`;
- terminal state/completion timestamp.

When a session pauses or ends, the server calculates the elapsed interval from `state_changed_at`, adds it to accumulated time, and persists the transition. The client only redraws the countdown; it does not authoritatively decide elapsed time. Chromium coverage now verifies an active session continues from its server timestamp after reload and a paused session reload preserves its frozen persisted value. This handles reload and ordinary page inactivity far better than a JavaScript interval alone. Background/mobile lifecycle and offline semantics are future work.

## Web UX foundations

The web app starts at a real registration/sign-in gate, then intentionally exposes six implemented workspace navigation surfaces:

1. **Command center** — real task counts, persisted top priorities, next action, plan blocks, and focus status.
2. **Task workspace** — rapid capture plus full task editing, explicit optional goal links, owned dependencies, user-confirmed step breakdown, search/filter, completion/deletion, and focus on actionable tasks.
3. **Goals & milestones** — owned project/goal/milestone CRUD, factual task/milestone progress, lifecycle feedback, and linked-task filtering.
4. **Planning studio** — plan input, draft generation, capacity/deferred explanation, explicit feasible daily-draft time adjustment/reordering, approval, and recovery recalculation in the configured time zone.
5. **Schedule & capacity** — IANA zone/working-window/recovery-cap settings and owned commitment CRUD with an explicit fixed/flexible distinction.
6. **Focus studio** — session setup/control/history backed by the API.

The empty, error, loading, disabled, confirmation, and success states are part of these flows. Unsupported modules are documented rather than added as dead navigation items.

## Known architectural risks

| Risk                                      | Current mitigation                                                                                                                         | Planned resolution                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `node:sqlite` is experimental in Node 22  | Isolated behind one adapter; test database injection                                                                                       | Supported production driver/ORM in production hardening                      |
| Local adapter is not a hosted deployment  | Auth/ownership/CSRF work in local mode, with explicit `/meta` disclosure                                                                   | Production database, HTTPS/proxy, email, backup and monitoring configuration |
| DST/local-time edge cases                 | Server validates IANA zones and rejects ambiguous/nonexistent local times; Chromium covers the `America/New_York` gap/ambiguity error path | Broader time-zone/DST E2E coverage and explicit user disambiguation choices  |
| Calendar is manual, not connected         | Owned local event CRUD and fixed-capacity subtraction are real                                                                             | External authorization/sync, recurrence, conflict guidance                   |
| Breakdown metadata is local and one-level | Explicit user confirmation, atomic child creation, inherited goal link, and parent exclusion prevent double-booking                        | Add recurrence/tags and, only if justified, richer hierarchy rules           |
| Goal context is not planner logic         | Goal links and factual progress are persisted, but `goal_alignment` deliberately remains a separate planner signal                         | Define goal-aware planning/analytics only with explicit behavior and tests   |
| Manual schedule adjustment is draft-only  | Complete-draft server validation preserves feasibility and accepted/recovery history                                                       | Consider multi-day/block-splitting only with explicit conflict-resolution UX |
| No optional LLM provider                  | Deterministic engine fully works alone                                                                                                     | Provider interface, timeout/privacy/schema controls                          |
