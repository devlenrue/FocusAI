# FocusAI implementation status

> Last updated: 2026-10-12 (UTC)
>
> Branch: `arena/753e4e83-focusai`
>
> Status labels: **Not Started** · **In Progress** · **Implemented** · **Tested** · **Blocked**

## Phase 0 — audit baseline

### Actual starting condition

At commit `328788ad34cc95f960fc1ac728513ec4adc46e3e`, the repository contained one file: a one-line `README.md` (`# FocusAI`). There were no application sources, dependency manifests, database files, environment configuration, mobile app, API, tests, CI workflows, authentication code, or existing user data.

| Audit question                  | Audit result                                                                        | Status at audit |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| What already worked?            | Git repository/remote and a project title only                                      | **Tested**      |
| What was partially implemented? | Nothing beyond the title                                                            | **Not Started** |
| What was missing?               | Every product, backend, database, AI, mobile, testing, and documentation capability | **Not Started** |
| What was broken?                | No application existed, so there was no runtime behavior to repair                  | **Not Started** |
| What could be reused?           | Repository identity, remote, branch, and name                                       | **Implemented** |
| What needed refactoring?        | No source existed; additive foundation was safer than a rewrite                     | **Implemented** |

Environment verified during audit: Node `v22.22.3`, npm `10.9.8`.

## Increment 1 — runnable local product foundation

**Objective:** Build a usable and honest local-development core for **Capture → Prioritize → Plan → Focus** with real persistence and a tested deterministic planning service. Do not represent unfinished authentication, hosted storage, mobile, LLM, calendar sync, or analytics as complete.

### Delivered scope

| Area                      | Current state                                                                                                                   | Status                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Workspace/tooling         | npm workspaces, TypeScript, ESLint, Prettier check command, Vite, Fastify, CI workflow                                          | **Tested**                                         |
| Visual identity           | Premium responsive graphite/cyan/violet system, FocusAI core mark, command-center/timeline/focus motifs, reduced-motion rules   | **Implemented**                                    |
| Web command center        | Persisted dashboard data, top priorities, next action, plan snapshot, real task counts, focus state, empty/loading/error states | **Tested**                                         |
| Task workspace            | Create, search, filter, complete, delete, local persistence, focus linking                                                      | **Tested**                                         |
| Daily planning            | Generate/review/approve persisted draft, capacity display, priority reasons, explicit deferrals                                 | **Tested**                                         |
| Recovery                  | Remaining-day recovery draft and configurable default 20% high-cognitive cap; history is retained                               | **Tested**                                         |
| Focus studio              | Start/pause/resume/complete/stop; timestamp-backed persisted session and history                                                | **Tested**                                         |
| Versioned API             | `/api/v1`, Zod validation, consistent errors, request IDs, Helmet/CORS, OpenAPI UI                                              | **Tested**                                         |
| Local relational data     | Normalized SQLite schema, foreign keys, indexes, transaction wrapper, additive migration ledger                                 | **Tested**                                         |
| Decision engine           | Deterministic scoring, reasons, fixed-commitment exclusion, dependency sequencing, capacity/deferrals, recovery rules           | **Tested**                                         |
| Unit/integration tests    | 4 decision-engine unit tests and 2 API integration tests                                                                        | **Tested**                                         |
| Security dependency check | `npm audit --audit-level=moderate`                                                                                              | **Tested** — 0 vulnerabilities in current lockfile |

### Actual implementation choices

- The API uses a **local SQLite development adapter** via Node 22 `node:sqlite`; it is not labelled as a hosted production database.
- A named local-development workspace identity enables real end-to-end data flow. It is **not authentication** and does not supply multi-user security.
- Fresh local workspaces start with no sample productivity records. Only required local identity/preferences rows are created.
- Navigation intentionally exposes only the four functional screens. Unsupported product areas are documented instead of appearing as dead controls.
- The web client uses relative API paths and Vite's proxy; the preview accepts Arena's generated hostname.

## Feature roadmap adapted to the repository reality

### Increment 2 — identity, production data, and security foundation

| Feature                                      | Status          | Notes                                                                                               |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| Registration/login/logout                    | **Tested**      | Real web gate and `/auth` API routes issue/revoke opaque cookie sessions                            |
| Password hashing/session rotation/revocation | **Tested**      | Memory-hard scrypt, HTTP-only opaque cookies, rotation and revoke-other-session routes              |
| Server authorization/ownership enforcement   | **Tested**      | Protected routes pass verified server user IDs to repositories; cross-user access tests return 404  |
| CSRF/rate limiting/auth audit log            | **Tested**      | Session-bound double-submit CSRF, stricter auth rate limits, and minimal non-sensitive audit events |
| Additive database migrations                 | **Tested**      | Version 1 → 3 preservation is covered; local SQLite remains intentionally limited                   |
| Production relational adapter                | **Not Started** | No hosted production database is configured or claimed                                              |
| Preference settings UI / IANA timezone       | **Tested**      | Authenticated Schedule & Capacity UI validates IANA zones and uses them for plan-day boundaries     |

### Increment 2 delivery — identity and secure ownership

**Objective:** Replace the single implicit local identity with real account/session flows and make all workspace access server-authorized before expanding shared product data.

| Area                      | Delivered behavior                                                                                             | Status     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| Registration/sign-in gate | Functional Create account / Sign in screen; no demo account or bypass route                                    | **Tested** |
| Password security         | 12+ character policy, unique salted memory-hard scrypt hash, constant-time compare, no password logging        | **Tested** |
| Session model             | Random opaque HTTP-only session cookie; only SHA-256 token hash persisted                                      | **Tested** |
| CSRF                      | Session-bound readable CSRF cookie plus required `X-CSRF-Token` on every unsafe workspace mutation             | **Tested** |
| Logout/revocation         | Current-session sign-out, session rotation, and revoke-other-session endpoint                                  | **Tested** |
| Ownership                 | Every task/plan/focus/dashboard query requires authenticated user context; no default repository user remains  | **Tested** |
| Migration safety          | Version 2/3 additive migrations; a v1 database upgrade and legacy local workspace claim are integration-tested | **Tested** |
| Rate limits/auditability  | Tighter registration/sign-in limits and minimal sensitive-data-free authentication audit events                | **Tested** |

See [`AUTHENTICATION.md`](AUTHENTICATION.md) for exact cookie, CSRF, password, and legacy-data behavior.

### Increment 2 delivery — schedule, capacity, and time zones

**Objective:** Make plan availability truthful for each authenticated user before extending productivity modules: configurable local working hours, explicit commitments, and correct UTC persistence.

| Area                       | Delivered behavior                                                                                                | Status     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| IANA preferences           | Authenticated UI/API for IANA zone, same-day working window, transition buffer, and recovery high-load cap        | **Tested** |
| Time-zone planning         | Server converts local work hours into UTC plan availability; dashboard/current-plan date follows the profile zone | **Tested** |
| Commitment CRUD            | Users can create, list, edit, and remove owned local calendar commitments in profile-local wall time              | **Tested** |
| Capacity behavior          | Fixed commitments subtract from new plan drafts; flexible entries stay visible but do not reserve capacity        | **Tested** |
| DST safety                 | Invalid/ambiguous local transition times are rejected rather than silently shifted                                | **Tested** |
| Event instant preservation | Existing UTC event instant is not rewritten when the profile time zone changes                                    | **Tested** |

This is manual local calendar data, not a connected provider, recurring-event system, or conflict-resolution UI.

### Increment 3 delivery — richer task editing and user-confirmed decomposition

**Objective:** Make task details and prerequisite relationships deliberately editable, then support a human-reviewed task breakdown without automatically inventing work or double-booking a parent alongside its steps.

| Area                  | Delivered behavior                                                                                                                                                                                           | Status          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Full task editor      | The Task Workspace retains quick capture and adds an editor for title, context, status, priority, impact, estimate/actual time, due instant, cognitive load, goal alignment, blocked state, and dependencies | **Tested**      |
| Owned dependencies    | API/UI dependency updates are ownership-enforced; self-links, cycles, and container prerequisites return safe conflicts                                                                                      | **Tested**      |
| Confirmed breakdown   | A user adds/reviews step titles and estimates locally, then explicitly confirms one transaction that creates child records and marks the parent as a container                                               | **Tested**      |
| Planner-safe behavior | Containers are excluded from new plan drafts and new dashboard rankings; focus starts reject containers, while ordinary child steps remain editable/actionable                                               | **Tested**      |
| Data preservation     | Schema version 3 adds nullable parent references and a container flag without resetting existing records; deleting a container releases rather than deletes retained steps                                   | **Tested**      |
| Non-goals             | Automatic/AI decomposition, recurrence, tags, projects/goals, and browser E2E/accessibility certification remain outside this increment                                                                      | **Not Started** |

### Increment 3 — connected productivity records

| Feature                                  | Status          | Notes                                                                                                                                     |
| ---------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Projects/goals/milestones                | **Not Started** | `goal_alignment` exists as an engine input only                                                                                           |
| Notes and conversion to task             | **Not Started** | No placeholder route                                                                                                                      |
| Habit tracking                           | **Not Started** | No placeholder route                                                                                                                      |
| Calendar event CRUD/views                | **Tested**      | Owned API/UI CRUD, local-zone display, and fixed/flexible capacity behavior are covered                                                   |
| Task editing and confirmed decomposition | **Tested**      | Full owned-task editing/dependencies plus explicit reviewed step creation; breakdown parents are excluded from future planning candidates |
| Task recurrence and tags                 | **Not Started** | Neither recurrence rules nor tag records/UI are implemented                                                                               |
| Analytics                                | **Not Started** | No fabricated charts                                                                                                                      |

### Increment 4 delivery — user-controlled plan block editing and reordering

**Objective:** Let a person deliberately adjust a current daily draft without turning a generated recommendation into hidden or infeasible scheduling behavior, and without rewriting accepted/recovery history.

| Area                   | Delivered behavior                                                                                                                                                                         | Status          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Draft schedule editor  | Planning Studio exposes profile-local start-time fields plus adjacent move controls only for editable daily drafts                                                                         | **Tested**      |
| Explicit save boundary | The browser holds local changes until **Save schedule**; the API receives every current block together and applies no partial move                                                         | **Tested**      |
| Feasibility protection | Server validates ownership, exact block membership, saved availability, current fixed commitments, transition buffers, current task actionability, and dependency order in one transaction | **Tested**      |
| Historical protection  | Accepted/superseded plans are immutable; recovery drafts require recalculation; legacy drafts without saved feasibility context remain visible but require regeneration before edit        | **Tested**      |
| Time-zone safety       | Manual values are resolved in the authenticated profile IANA zone and reject impossible/ambiguous local times rather than using the browser machine zone                                   | **Tested**      |
| Non-goals              | Block splitting, cross-day moves, recurrence, drag-and-drop/browser E2E certification, and automatic conflict resolution are not claimed                                                   | **Not Started** |

### Increment 4 — adaptive/hybrid intelligence

| Feature                                 | Status          | Notes                                                                                                                                                      |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommendation feedback/personalization | **Not Started** | No inferred behavior claims                                                                                                                                |
| Plan block editing/reordering           | **Tested**      | Owners can explicitly adjust/reorder full current daily drafts; server feasibility checks protect commitments, buffers, dependencies, and accepted history |
| Missed-block detection                  | **In Progress** | Explicit recovery request is implemented; automatic detection is pending                                                                                   |
| Optional LLM provider abstraction       | **Not Started** | Deterministic engine is the current fallback and primary planner                                                                                           |
| AI coach                                | **Not Started** | No chatbot presented as implemented                                                                                                                        |

### Increment 5 — mobile, offline, resilience

| Feature                                     | Status          | Notes                                            |
| ------------------------------------------- | --------------- | ------------------------------------------------ |
| Expo/React Native app                       | **Not Started** | No mobile project existed in audit               |
| Offline operation/synchronization/conflicts | **Not Started** | Cannot be claimed without implementation/testing |
| Android/iOS verification                    | **Blocked**     | No mobile app/emulator has been provisioned      |

### Increment 6 — production hardening

| Feature                                | Status          | Notes                                                    |
| -------------------------------------- | --------------- | -------------------------------------------------------- |
| Browser E2E and accessibility audit    | **Not Started** | API/domain tests exist; browser suite is next-level work |
| Backup/restore runbook for hosted data | **Not Started** | Local copy guidance only                                 |
| Monitoring/error reporting/deployment  | **Not Started** | No deployment configuration supplied                     |
| External calendar integration          | **Not Started** | Never show connected status without real authorization   |

## Files and architectural areas added across Increments 1–4

- `apps/web`: React/Vite responsive product surfaces/design system, private registration/sign-in gate/account header, and Schedule & Capacity UI.
- `apps/api`: Fastify `/api/v1`, additive schema migration, authenticated route guards, password/session services, IANA-time conversion, preference/calendar/task/plan/focus repositories, and API integration tests.
- `packages/decision-engine`: pure scoring/scheduling/recovery package and unit tests.
- `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISION_ENGINE.md`, `docs/TESTING.md`, and `docs/AUTHENTICATION.md`.
- Root workspace/tooling, `.env.example`, `.gitignore`, and `.github/workflows/ci.yml`.

### Database migrations added

- Schema version **1** in `apps/api/src/db/schema.ts`, tracked in `schema_migrations`.
- Schema version **2** adds user credential metadata, `auth_sessions`, normalized email uniqueness, and `auth_audit_events` additively.
- Schema version **3** adds nullable `tasks.parent_task_id`, constrained `tasks.is_decomposed`, and an owned parent lookup index for user-confirmed breakdowns.
- No destructive reset was used. The normal local database is ignored by Git. Tests use temporary throwaway databases.

## Verification log

| Date       | Command / check                                                             | Actual result                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | `git status --short --branch`, `git log --oneline -8`, repository inventory | Passed — clean one-commit baseline with only README                                                                                                                                                                    |
| 2026-10-12 | `node --version && npm --version`                                           | Passed — Node `v22.22.3`, npm `10.9.8`                                                                                                                                                                                 |
| 2026-10-12 | `npm ci`                                                                    | Passed — clean lockfile install, 0 audit vulnerabilities reported                                                                                                                                                      |
| 2026-10-12 | Baseline `npm run test` before Increment 2                                  | Passed — 2 API integration tests + 4 decision-engine unit tests                                                                                                                                                        |
| 2026-10-12 | `npm run typecheck`                                                         | Passed — API, web, and decision-engine TypeScript checks                                                                                                                                                               |
| 2026-10-12 | `npm run lint`                                                              | Passed — zero warnings allowed                                                                                                                                                                                         |
| 2026-10-12 | `npm run test`                                                              | Passed — 5 authenticated API integration tests + 4 decision-engine unit tests                                                                                                                                          |
| 2026-10-12 | `npm run build`                                                             | Passed — decision-engine/API compilation and Vite production build                                                                                                                                                     |
| 2026-10-12 | `npm run format:check`                                                      | Passed — all matched files use Prettier style                                                                                                                                                                          |
| 2026-10-12 | `npm audit --audit-level=moderate`                                          | Passed — 0 vulnerabilities in installed lockfile                                                                                                                                                                       |
| 2026-10-12 | Existing local SQLite migration inspection                                  | Passed — schema migrations 1 and 2 present; user credential columns added without deleting existing local data                                                                                                         |
| 2026-10-12 | Isolated real-HTTP auth smoke                                               | Passed — register 201, HTTP-only cookie, CSRF rejection 403, protected task creation 201, logout 204, revoked-session dashboard 401; temporary database removed afterward                                              |
| 2026-10-12 | Vite preview/proxy smoke                                                    | Passed — preview root 200 and relative proxied unauthenticated dashboard 401                                                                                                                                           |
| 2026-10-12 | Clean-artifact typecheck/test simulation                                    | Passed — removed generated decision-engine artifacts; API typecheck resolved source and API pretest rebuilt runtime artifacts                                                                                          |
| 2026-10-12 | Schedule increment command suite                                            | Passed — typecheck, lint, 6 authenticated API integration tests + 4 engine tests, build, format check, and moderate audit                                                                                              |
| 2026-10-12 | Isolated real-HTTP schedule smoke                                           | Passed — preference 200, event 201, fixed capacity 120, flexible capacity 180, preserved UTC instant after zone change, DST gap 409; temporary database removed                                                        |
| 2026-10-12 | Schedule preview/proxy smoke                                                | Passed — `/schedule` served 200; direct and relative-proxy unauthenticated preferences returned 401                                                                                                                    |
| 2026-10-12 | GitHub Actions run `38235014038`                                            | Passed — clean `npm ci`, lint, typecheck, tests, build, and moderate audit on the pull request branch                                                                                                                  |
| 2026-10-12 | Task editing/decomposition command suite                                    | Passed — zero-warning lint; API/web/engine typecheck; 7 authenticated API integration tests + 4 engine tests; production build; Prettier check; moderate audit with 0 vulnerabilities                                  |
| 2026-10-12 | Isolated real-HTTP task-edit/decomposition smoke                            | Passed — authenticated full-field edit, explicit 2-step confirmation, parent focus rejection, planner parent exclusion/step scheduling, and child release after container deletion                                     |
| 2026-10-12 | Local additive V3 migration and preview/proxy smoke                         | Passed — normal local database advanced to version 3 with new task columns (no records existed to rewrite); API health 200; Vite `/tasks` 200 and relative protected API proxy 401                                     |
| 2026-10-12 | GitHub Actions run `38237130440`                                            | Passed — clean `npm ci`, lint, typecheck, tests, build, and moderate audit for the task-editing/decomposition implementation commit; only external Node 20/Ubuntu runner deprecation annotations remained              |
| 2026-10-12 | Reviewed plan-scheduling implementation suite                               | Passed — clean `npm ci`; Prettier write/check; zero-warning lint; API/web/engine typecheck; production build; full root test (8 authenticated API integration tests + 4 decision-engine unit tests)                    |
| 2026-10-12 | Isolated real-HTTP reviewed-plan scheduling smoke                           | Passed — registration/session/CSRF flow, two persisted tasks, editable daily draft, `PATCH /plans/:id/blocks`, profile-local block times, and manual-edit audit timestamp; temporary SQLite database removed afterward |
| 2026-10-12 | Planning Studio preview/proxy smoke                                         | Passed — Vite `/plan` shell returned 200 and its relative unauthenticated `/api/v1/plans` proxy returned the expected 401; temporary API database removed afterward                                                    |

## Risks, limitations, and next highest-priority action

| Item                                   | Risk / limitation                                                                                                               | Next action                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Local development deployment           | Auth/ownership is implemented, but the SQLite adapter is not a hosted production database                                       | Add supported production database and deployment security configuration                       |
| Experimental `node:sqlite`             | Not an appropriate unqualified production datastore claim                                                                       | Add supported production relational adapter and migration tooling                             |
| DST ambiguity / nonexistent local time | The API intentionally rejects a time it cannot resolve without guessing                                                         | Add browser E2E coverage and a user-facing disambiguation design                              |
| Manual local calendar only             | No external provider authorization, sync, recurrence, or conflict guidance exists                                               | Design explicit calendar connection and recurrence workflows                                  |
| Confirmed one-level breakdown          | Steps are explicitly user-authored and safe for new drafts, but nested hierarchy, recurrence, and tags are intentionally absent | Evaluate projects/goals or recurrence only with explicit data-model and planning semantics    |
| Manual daily-draft scheduling          | Edits are safely constrained to one day/current draft and do not split blocks or resolve conflicts automatically                | Design explicit multi-day/block-splitting conflict-resolution rules before expanding controls |
| No mobile/offline                      | Cross-device/offline acceptance criteria are unverified                                                                         | Stabilize auth/API contracts, then add Expo client and sync design                            |

**Next highest-priority action: projects/goals/milestones foundation.** Task-level goal alignment is currently only a planning signal; the next connected-record slice should add explicit user-owned goal structure before claiming goal-aware workflows or analytics.
