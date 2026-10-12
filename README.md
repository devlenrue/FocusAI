# FocusAI

**FocusAI is an adaptive productivity workspace built around a deliberate loop:**

> Capture → Understand → Prioritize → Plan → Focus → Reflect → Adapt

This repository started as an empty project name. The current implementation is an intentionally honest first vertical slice: a polished web experience plus a versioned local API, relational persistence, a deterministic decision engine, daily planning, and timestamp-safe focus sessions. It does **not** present unimplemented authentication, cloud sync, LLM coaching, external calendar sync, analytics, habits, projects, or mobile as complete features.

## What works today

- **Responsive web workspace** with a distinctive dark FocusAI visual system and functional Command Center, Task Workspace, Planning Studio, and Focus Studio routes.
- **Task capture and lifecycle basics**: create, search, filter, complete, delete, persist, and use tasks as plan inputs.
- **Deterministic decision engine** that ranks active tasks, explains ranking signals, produces non-overlapping whole-task schedules, respects fixed commitments supplied to it, accounts for dependencies, and explicitly defers work that does not fit.
- **Daily plan drafts and approval**: generate a plan from real stored tasks, inspect reasons/capacity/deferred work, approve it, regenerate it, or calculate a remaining-day recovery draft.
- **Zero-shame recovery guardrail**: recovery uses only remaining working capacity and applies a configurable high-cognitive-load cap (20% by default) without erasing history or punishing missed work.
- **Focus sessions**: start, pause, resume, complete, or stop a persisted session. Elapsed time is calculated from persisted timestamps and accumulated time, not a fragile browser interval.
- **Local relational persistence**: a SQLite file is migrated on startup without reset or seed activity. New workspaces begin empty.
- **API safety foundation**: input validation, ownership-shaped repository boundaries ready for authenticated context, consistent errors, request IDs, CORS, Helmet headers, OpenAPI UI, and redacted sensitive request headers in logs.
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

## Prerequisites

- **Node.js 22.13+** (the local development datastore uses Node's experimental `node:sqlite` module)
- **npm 10+**

No database server, API key, Docker daemon, or demo account is required for the current local-development increment.

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

The first API start creates `apps/api/data/focusai.db`, applies the current schema migration, and creates only the required local-development workspace identity/preferences. It does **not** create sample tasks, fake focus sessions, or fabricated analytics. The database file is git-ignored.

## Environment variables

Use [`.env.example`](.env.example) as the complete current reference.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FOCUSAI_API_HOST` | `0.0.0.0` | API bind address |
| `FOCUSAI_API_PORT` | `3001` | API port |
| `FOCUSAI_DATABASE_PATH` | `./data/focusai.db` (relative to `apps/api`) | Local SQLite datastore path |
| `FOCUSAI_CORS_ORIGIN` | `http://localhost:5173` | Allowed development web origin(s), comma separated |

The commented authentication/AI variables in `.env.example` are reserved only; those integrations are not implemented and should not be configured as if they were active.

## Commands and verification

```bash
npm run lint       # ESLint, zero warnings allowed
npm run typecheck  # TypeScript across API, web, and decision engine
npm run test       # API integration + decision-engine unit tests
npm run build      # Engine/API compilation + Vite production build
npm audit --audit-level=moderate
```

The most recent verified baseline is recorded in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). Do not infer that a command passed on another machine unless you run it there.

## Current API surface

All currently implemented endpoints are under `/api/v1`.

| Area | Endpoints |
| --- | --- |
| Service | `GET /health`, `GET /meta`, `GET /dashboard` |
| Tasks | `GET/POST /tasks`, `PATCH/DELETE /tasks/:taskId`, `POST /tasks/:taskId/complete` |
| Plans | `GET /plans`, `POST /plans/generate`, `POST /plans/:planId/accept` |
| Focus | `GET /focus-sessions`, `GET /focus-sessions/active`, `POST /focus-sessions`, `POST /focus-sessions/:sessionId/transition` |

The API's `/meta` route explicitly reports `local-development` mode. There is no misleading “connected” or “production” status.

## Data and migration policy

- Timestamp fields are stored as ISO-8601 UTC strings in the current local datastore.
- The runtime migration ledger is `schema_migrations`; startup applies additive schema version(s) without a destructive reset.
- Local test databases are created in a temporary directory and removed by tests.
- Never commit `apps/api/data/*.db`, `.env`, credentials, or user activity data.
- Back up a local workspace by stopping the API and copying the SQLite database plus its `-wal` sidecar if present. Restoration procedures for hosted production storage are not yet implemented; see limitations below.

## Honest limitations and next work

The project is **not production ready yet**. Important work remains:

1. Real registration, login, secure sessions, password reset/verification, authorization, data export/deletion, and a production datastore adapter.
2. User preferences UI, IANA time zones, working-hour/break editing, user-created calendar event CRUD, conflict UI, and external calendar authorization.
3. Projects, goals, notes, habits, richer task editing/relationships/recurrence, and analytics sourced from persisted records.
4. Recommendation feedback, plan editing/reordering, optional LLM-provider abstraction with privacy controls and schema validation, and AI coach actions with confirmations.
5. React Native/Expo mobile client, offline queue/synchronization/conflict tests, and Android/iOS verification.
6. Production deployment, backups/restores, monitoring, rate limiting for authenticated/sensitive routes, E2E/browser accessibility tests, and CI execution in GitHub.

The ordered implementation plan and risks are maintained in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).
