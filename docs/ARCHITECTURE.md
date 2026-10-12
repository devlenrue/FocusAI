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
                                   │ task / plan / focus │ │ pure TS package     │ │ schema/migrate  │
                                   └─────────────────────┘ └─────────────────────┘ └────────────────┘
```

### Browser/API boundary

The web client uses `/api/v1/*`, never `localhost` or a hard-coded remote API host. In Vite development, the proxy targets `127.0.0.1:3001`; thus the browser stays same-origin from its perspective. Vite accepts Arena's preview host explicitly via `allowedHosts: true` because the preview address is generated per sandbox.

### Server modules

| Module | Responsibility |
| --- | --- |
| `apps/api/src/app.ts` | Fastify construction, headers/CORS, OpenAPI UI, routes, consistent errors and request IDs |
| `apps/api/src/db/database.ts` | Local connection lifecycle, migration ledger, foreign-key/WAL pragmas, transaction wrapper |
| `apps/api/src/db/schema.ts` | Versioned current schema definition |
| `apps/api/src/services/repositories.ts` | Repository/service boundaries for tasks, focus sessions, plans, and dashboard aggregation |
| `packages/decision-engine` | Pure ranking/scheduling/recovery rules; no HTTP, database, or provider dependency |

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
5. It creates only a local-development identity/preferences row required for the current single-workspace mode.

No startup reset, seed task, migration deletion, or test data is directed at the normal local database. API integration tests inject a separate temporary database instance.

### Why not claim MySQL/Prisma today?

The repository had no database service, credentials, database driver, or existing ORM. Node's built-in SQLite made a real, testable relational persistence slice possible without pretending a database server was provisioned. It is a **development adapter**, not a production selection. Increment 2 will introduce authenticated request context and a supported production relational adapter/migration workflow; the current normalized schema/repositories are designed to make that replacement bounded.

## Authentication and authorization boundary

There is deliberately no authentication UI or secure multi-user claim in this increment. The API uses a named `local-development-user` internally and exposes the limitation through `/api/v1/meta`. Repository methods take a `userId` argument now so endpoint authentication middleware can replace that context later rather than rewriting all data access.

Before any hosted deployment, this must be replaced with:

- Argon2id-compatible credential handling or an approved external identity provider;
- secure HTTP-only session/cookie or token rotation architecture;
- endpoint authentication and resource ownership checks;
- CSRF/CORS policy appropriate to the selected session design;
- rate limits on auth and sensitive mutation endpoints;
- audit logging and privacy controls.

## API conventions

- Version prefix: `/api/v1`.
- JSON input is validated with Zod before calling services.
- Structured errors contain `code`, safe `message`, and Fastify `requestId`.
- `404` is used for owned-resource absence, `409` for impossible transitions/concurrent focus, and `400` for validation.
- Helmet supplies security headers. API logs redact authorization/cookie headers.
- `/api/docs` exposes the currently registered OpenAPI interface.

Current routes are listed in the README; endpoint coverage grows only when the corresponding workflow is implemented.

## Current timer model

Focus sessions store:

- `started_at`;
- `state_changed_at`;
- `accumulated_seconds`;
- terminal state/completion timestamp.

When a session pauses or ends, the server calculates the elapsed interval from `state_changed_at`, adds it to accumulated time, and persists the transition. The client only redraws the countdown; it does not authoritatively decide elapsed time. This handles reload and ordinary page inactivity far better than a JavaScript interval alone. Background/mobile lifecycle and offline semantics are future work.

## Web UX foundations

The web app intentionally exposes only four implemented navigation surfaces:

1. **Command center** — real task counts, persisted top priorities, next action, plan blocks, and focus status.
2. **Task workspace** — capture, search, filter, complete, delete, and focus a task.
3. **Planning studio** — plan input, draft generation, capacity/deferred explanation, approval, and recovery recalculation.
4. **Focus studio** — session setup/control/history backed by the API.

The empty, error, loading, disabled, confirmation, and success states are part of these flows. Unsupported modules are documented rather than added as dead navigation items.

## Known architectural risks

| Risk | Current mitigation | Planned resolution |
| --- | --- | --- |
| `node:sqlite` is experimental in Node 22 | Isolated behind one adapter; test database injection | Supported production driver/ORM in Increment 2 |
| Single local workspace is not authorization | `/meta` truthfully identifies it; repositories already accept user IDs | Auth middleware + ownership integration tests |
| Schedule uses UTC working-window defaults | UI disclosure and explicit availability API input | IANA time-zone preferences and calendar UI |
| Whole-task scheduler cannot yet split tasks | Explicit capacity deferral instead of hidden overbooking | Task decomposition and user-approved splitting |
| No optional LLM provider | Deterministic engine fully works alone | Provider interface, timeout/privacy/schema controls |
