# FocusAI

**FocusAI is an adaptive productivity workspace built around a deliberate loop:**

> Capture → Understand → Prioritize → Plan → Focus → Reflect → Adapt

This repository started as an empty project name. The current implementation is an intentionally honest local-development foundation: a polished web experience plus a versioned API, account registration/sign-in, opaque cookie sessions, ownership enforcement, IANA-time-zone planning preferences, real user-created commitments, editable owned tasks with user-confirmed breakdown steps, explicit projects/goals/milestones, user-controlled daily-draft scheduling, relational persistence, a deterministic decision engine, daily planning, and timestamp-safe focus sessions. It does **not** present cloud deployment, email recovery/verification, external calendar sync, LLM coaching, goal-aware planning analytics, habits, recurrence, tags, or mobile as complete features.

## What works today

- **Responsive web workspace** with a distinctive dark FocusAI visual system and functional Command Center, Task Workspace, Goals & Milestones, Planning Studio, Schedule & Capacity, and Focus Studio routes.
- **Task workspace and full editing**: quick capture, search/filter, edit every user-editable task field, deliberately link an owned goal, manage owned dependencies, complete/delete, and use actionable tasks as plan inputs. A goal link never silently changes the separate numeric goal-alignment planning signal.
- **Projects, goals, and milestones**: create/edit/delete user-owned project groupings, goals, and explicit milestones in a dedicated workspace; link actual tasks, filter to linked work, and view only recorded completion progress. Project deletion releases goals, and goal deletion releases task links while cascading its milestones.
- **User-confirmed breakdowns**: a task editor lets a person add and review step titles/estimates before a single atomic confirmation creates child records. The parent remains visible as a container but is excluded from future plan drafts, new dashboard recommendations, and focus starts so parent and steps are not double-booked. Child steps inherit the parent’s goal link server-side. Deleting a container releases its retained child steps back to standalone tasks.
- **Deterministic decision engine** that ranks active tasks, explains ranking signals, produces non-overlapping whole-task schedules, respects fixed commitments supplied to it, accounts for dependencies, and explicitly defers work that does not fit.
- **Daily plan drafts, reviewed adjustment, and approval**: generate a plan from real stored tasks, saved local working hours, and fixed commitments; inspect reasons/capacity/deferred work; then explicitly move/reorder a current daily draft in profile-local time. The server rechecks complete-draft availability, current fixed commitments, transition buffers, task actionability, and dependencies before saving. Accepted and recovery plans remain immutable/recalculated rather than silently rewritten.
- **Schedule & capacity**: configure an IANA time zone, working day, transition buffer, and recovery high-load cap; create, edit, and remove real commitments in local wall time. Fixed commitments are subtracted from future plan drafts, while flexible items remain visible without reducing capacity.
- **Zero-shame recovery guardrail**: a read-only current-day signal can surface an ended open plan block without marking it failed or moving anything automatically. A person explicitly chooses recovery, which uses only remaining working capacity and applies a configurable high-cognitive-load cap (20% by default) while preserving prior plan history.
- **Focus sessions**: start, pause, resume, complete, or stop a persisted session. Elapsed time is calculated from persisted timestamps and accumulated time, not a fragile browser interval.
- **Private account access**: create an account, sign in/out, and bootstrap an HTTP-only opaque session. Server-side ownership conditions protect tasks, plans, and focus sessions from other accounts.
- **CSRF-protected writes**: authenticated mutations require a session-bound double-submit CSRF token. The browser stores no long-lived token in local storage.
- **Local relational persistence**: a SQLite file is migrated on startup without reset or seed activity. New accounts begin with an empty workspace.
- **API safety foundation**: input validation, secure password hashing, session rotation/revocation routes, rate limits for sign-in/registration, minimal auth audit events, consistent errors, request IDs, CORS, Helmet headers, OpenAPI UI, and redacted sensitive request headers/body fields in logs.
- **Automated verification**: decision-engine unit tests and API integration tests.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the audited, feature-by-feature status.

## Architecture at a glance

```text
apps/
  web/                  Vite + React + TypeScript experience
  api/                  Fastify + TypeScript /api/v1 service
packages/
  decision-engine/      Pure, deterministic planning domain service
docs/                   Architecture, data model, decision rules, status
```

The web app makes relative `/api/v1` requests. Vite proxies those requests to the local API in development, so browser-facing code never calls `localhost` directly. The decision engine is server-side domain logic—not UI logic and not an LLM wrapper.

More detail:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- [`docs/DECISION_ENGINE.md`](docs/DECISION_ENGINE.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md)

## Prerequisites

- **Node.js 22.13+** (the local development datastore uses Node's experimental `node:sqlite` module)
- **npm 10+**

No database server, API key, Docker daemon, or demo account is required. Start the app and create a local account through the real registration screen.

> `node:sqlite` emits an experimental-runtime warning on Node 22. This is documented as a current development constraint, not hidden as production readiness. The database abstraction and schema are designed to be replaced by a supported production relational adapter in the authentication/data-hardening phase.

## Quick start

```bash
# 1. Install workspace dependencies
npm install

# 2. Optionally copy documented local configuration
cp .env.example .env

# 3. Start both services
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API listens on port `3001` by default and serves:

- health: `GET /api/v1/health`
- OpenAPI UI: `http://localhost:3001/api/docs`

To run services separately:

```bash
npm run dev:api
npm run dev:web
```

The first API start creates `apps/api/data/focusai.db` and applies the current additive schema migrations. It does **not** create an account, sample task, fake focus session, or fabricated analytics. Create your account in the web app; the database file is git-ignored.

## Environment variables

Use [`.env.example`](.env.example) as the complete current reference.

| Variable                   | Default                                      | Purpose                                            |
| -------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `FOCUSAI_API_HOST`         | `0.0.0.0`                                    | API bind address                                   |
| `FOCUSAI_API_PORT`         | `3001`                                       | API port                                           |
| `FOCUSAI_DATABASE_PATH`    | `./data/focusai.db` (relative to `apps/api`) | Local SQLite datastore path                        |
| `FOCUSAI_CORS_ORIGIN`      | `http://localhost:5173`                      | Allowed development web origin(s), comma separated |
| `FOCUSAI_SESSION_TTL_DAYS` | `7`                                          | Opaque session lifetime in days                    |
| `FOCUSAI_COOKIE_SECURE`    | `true` when `NODE_ENV=production`            | Require HTTPS-only cookies in deployment           |

See [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) for the implemented password/session/CSRF model. Optional AI provider values remain reserved and must not be configured as if an integration were active.

## Commands and verification

```bash
npm run lint       # ESLint, zero warnings allowed
npm run typecheck  # TypeScript across API, web, decision engine, and E2E sources
npm run test       # API integration + decision-engine unit tests
npm run test:e2e   # Chromium E2E, Axe, keyboard, and focused visual baselines
npm run build      # Engine/API compilation + Vite production build
npm audit --audit-level=moderate
```

`npm run test:e2e` starts isolated API and Vite servers plus a temporary browser-test database. It includes focused account/goals visual baselines, accessibility checks, the explicit recovery-signal hand-off, protected-capacity planning with honest capacity and dependency deferrals, saved-schedule adjustment and rejected-conflict preservation, focus-session reload persistence, and explicit non-UTC daylight-saving rejection. Install a local browser with `npx playwright install chromium`; GitHub Actions installs Chromium for its separate browser E2E/accessibility job. See [`docs/ACCESSIBILITY_REVIEW.md`](docs/ACCESSIBILITY_REVIEW.md) before refreshing a screenshot baseline. The most recent verified baseline is recorded in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). Do not infer that a command passed on another machine unless you run it there.

## Current API surface

All currently implemented endpoints are under `/api/v1`.

| Area           | Endpoints                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service        | `GET /health`, `GET /meta`, `GET /dashboard`                                                                                                                                                                 |
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /auth/session`, `POST /auth/logout`, `POST /auth/session/rotate`, `POST /auth/sessions/revoke-others`                                                        |
| User           | `GET /users/me`, `GET/PATCH /preferences`                                                                                                                                                                    |
| Calendar       | `GET/POST /calendar-events`, `PATCH/DELETE /calendar-events/:eventId`                                                                                                                                        |
| Projects/goals | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:projectId`, `GET/POST /goals`, `GET/PATCH/DELETE /goals/:goalId`, `POST /goals/:goalId/milestones`, `PATCH/DELETE /goals/:goalId/milestones/:milestoneId` |
| Tasks          | `GET/POST /tasks` (optional `goalId` filter/link), `GET/PATCH/DELETE /tasks/:taskId`, `POST /tasks/:taskId/complete`, `POST /tasks/:taskId/decompose`                                                        |
| Plans          | `GET /plans`, `POST /plans/generate`, `PATCH /plans/:planId/blocks`, `POST /plans/:planId/accept`                                                                                                            |
| Focus          | `GET /focus-sessions`, `GET /focus-sessions/active`, `POST /focus-sessions`, `POST /focus-sessions/:sessionId/transition`                                                                                    |

The API's `/meta` route explicitly reports `authenticated-local-development` mode. There is no misleading “connected” or “production” status.

## Data and migration policy

- Timestamp fields are stored as ISO-8601 UTC strings in the current local datastore.
- The runtime migration ledger is `schema_migrations`; startup applies additive schema version(s) without a destructive reset. Version 4 adds user-owned projects, goals, milestones, and nullable task goal links.
- Local test databases are created in a temporary directory and removed by tests.
- Session and CSRF **hashes**, not reusable tokens, are stored in the local database. Never commit `apps/api/data/*.db`, `.env`, credentials, or user activity data.
- Back up a local workspace by stopping the API and copying the SQLite database plus its `-wal` sidecar if present. Restoration procedures for hosted production storage are not yet implemented; see limitations below.

## Honest limitations and next work

The project is **not production ready yet**. Important work remains:

1. Email verification/password reset, account deactivation/export/deletion UX, and a production datastore adapter.
2. Multiple availability windows/breaks, recurring commitments, calendar-conflict guidance, and external calendar authorization/sync.
3. Notes and conversion to tasks, habits, task recurrence/tags, and goal-aware analytics/planning behavior with explicit semantics.
4. Recommendation feedback, richer multi-day/block-splitting and conflict-resolution workflows, optional LLM-provider abstraction with privacy controls and schema validation, and AI coach actions with confirmations.
5. React Native/Expo mobile client, offline queue/synchronization/conflict tests, and Android/iOS verification.
6. Production deployment, backups/restores, monitoring, deployment-specific security review, broad all-route visual regression, and manual screen-reader accessibility reviews.

The ordered implementation plan and risks are maintained in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).
