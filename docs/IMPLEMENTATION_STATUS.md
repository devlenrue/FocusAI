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
| Unit/integration tests    | 4 decision-engine unit tests and 10 API integration tests                                                                       | **Tested**                                         |
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
| Additive database migrations                 | **Tested**      | Version 1 → 4 preservation is covered; local SQLite remains intentionally limited                   |
| Production relational adapter                | **Not Started** | No hosted production database is configured or claimed                                              |
| Preference settings UI / IANA timezone       | **Tested**      | Authenticated Schedule & Capacity UI validates IANA zones and uses them for plan-day boundaries     |

### Increment 2 delivery — identity and secure ownership

**Objective:** Replace the single implicit local identity with real account/session flows and make all workspace access server-authorized before expanding shared product data.

| Area                      | Delivered behavior                                                                                               | Status     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| Registration/sign-in gate | Functional Create account / Sign in screen; no demo account or bypass route                                      | **Tested** |
| Password security         | 12+ character policy, unique salted memory-hard scrypt hash, constant-time compare, no password logging          | **Tested** |
| Session model             | Random opaque HTTP-only session cookie; only SHA-256 token hash persisted                                        | **Tested** |
| CSRF                      | Session-bound readable CSRF cookie plus required `X-CSRF-Token` on every unsafe workspace mutation               | **Tested** |
| Logout/revocation         | Current-session sign-out, session rotation, and revoke-other-session endpoint                                    | **Tested** |
| Ownership                 | Every task/plan/focus/dashboard query requires authenticated user context; no default repository user remains    | **Tested** |
| Migration safety          | Version 2/3/4 additive migrations; a v1 database upgrade and legacy local workspace claim are integration-tested | **Tested** |
| Rate limits/auditability  | Tighter registration/sign-in limits and minimal sensitive-data-free authentication audit events                  | **Tested** |

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
| Non-goals             | Automatic/AI decomposition, nested hierarchy, recurrence, tags, and human accessibility certification remain outside this increment; automated browser E2E/Axe is maintained separately                      | **Not Started** |

### Increment 3 — connected productivity records

| Feature                                  | Status          | Notes                                                                                                                                                                         |
| ---------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects/goals/milestones                | **Tested**      | User-owned V4 records, guarded lifecycle routes, factual progress, task links, and integration coverage are implemented; `goal_alignment` remains an independent engine input |
| Notes and conversion to task             | **Not Started** | No placeholder route                                                                                                                                                          |
| Habit tracking                           | **Not Started** | No placeholder route                                                                                                                                                          |
| Calendar event CRUD/views                | **Tested**      | Owned API/UI CRUD, local-zone display, and fixed/flexible capacity behavior are covered                                                                                       |
| Task editing and confirmed decomposition | **Tested**      | Full owned-task editing/dependencies plus explicit reviewed step creation; breakdown parents are excluded from future planning candidates                                     |
| Task recurrence and tags                 | **Not Started** | Neither recurrence rules nor tag records/UI are implemented                                                                                                                   |
| Analytics                                | **Not Started** | No fabricated charts                                                                                                                                                          |

### Increment 3 delivery — projects, goals, and milestones foundation

**Objective:** Add a real, authenticated ownership hierarchy for projects, goals, milestones, and optional task context without inventing progress, changing planner behavior, or overstating unsupported hierarchy features.

| Area                    | Delivered behavior                                                                                                                                                                                                   | Status          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Additive owned records  | Schema version 4 creates `projects`, `goals`, and `milestones`, plus nullable `tasks.goal_id`; existing task records are retained without reset                                                                      | **Tested**      |
| Ownership and lifecycle | Protected CRUD routes/repositories enforce owner lookups; goals only enter active projects, milestones are mutable only on active goals, and goal completion rejects unfinished linked actionable work or milestones | **Tested**      |
| Preservation semantics  | Deleting a project releases its goals; deleting a goal releases task links and cascades its milestones; task deletion does not fabricate progress                                                                    | **Tested**      |
| Honest progress         | Goal progress is an aggregation of stored done-task and completed-milestone records only; empty goals show no invented achievement                                                                                   | **Tested**      |
| Task context            | The full editor can deliberately choose/clear a goal and the Task Workspace can filter/display that context; server-side decomposition inherits the parent goal link                                                 | **Implemented** |
| Planning separation     | `goal_alignment` remains a separate numeric input; linking/unlinking a goal does not rewrite it or change planner/draft logic                                                                                        | **Implemented** |
| Goals workspace         | Authenticated Goals & Milestones navigation supports project/goal/milestone CRUD, lifecycle feedback, linked-task access, and release-aware deletion confirmation                                                    | **Implemented** |
| Non-goals               | Nested project/goal hierarchies, goal-aware planner weighting/analytics, automatic decomposition, recurrence, tags, browser E2E, and accessibility certification are not claimed                                     | **Not Started** |

### Increment 4 delivery — user-controlled plan block editing and reordering

**Objective:** Let a person deliberately adjust a current daily draft without turning a generated recommendation into hidden or infeasible scheduling behavior, and without rewriting accepted/recovery history.

| Area                   | Delivered behavior                                                                                                                                                                         | Status          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Draft schedule editor  | Planning Studio exposes profile-local start-time fields plus adjacent move controls only for editable daily drafts                                                                         | **Tested**      |
| Explicit save boundary | The browser holds local changes until **Save schedule**; the API receives every current block together and applies no partial move                                                         | **Tested**      |
| Feasibility protection | Server validates ownership, exact block membership, saved availability, current fixed commitments, transition buffers, current task actionability, and dependency order in one transaction | **Tested**      |
| Historical protection  | Accepted/superseded plans are immutable; recovery drafts require recalculation; legacy drafts without saved feasibility context remain visible but require regeneration before edit        | **Tested**      |
| Time-zone safety       | Manual values are resolved in the authenticated profile IANA zone and reject impossible/ambiguous local times rather than using the browser machine zone                                   | **Tested**      |
| Non-goals              | Block splitting, cross-day moves, recurrence, drag-and-drop, and automatic conflict resolution are not claimed; the explicit one-block browser save flow is separately covered below       | **Not Started** |

### Increment 4 — adaptive/hybrid intelligence

| Feature                                 | Status          | Notes                                                                                                                                                       |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommendation feedback/personalization | **Not Started** | No inferred behavior claims                                                                                                                                 |
| Plan block editing/reordering           | **Tested**      | Owners can explicitly adjust/reorder full current daily drafts; server feasibility checks protect commitments, buffers, dependencies, and accepted history  |
| Missed-block detection                  | **Tested**      | A current-day, server-derived recovery signal offers an explicit recalculation choice for passed open blocks; it never marks work failed or changes history |
| Optional LLM provider abstraction       | **Not Started** | Deterministic engine is the current fallback and primary planner                                                                                            |
| AI coach                                | **Not Started** | No chatbot presented as implemented                                                                                                                         |

### Increment 4 delivery — non-punitive recovery signals

**Objective:** Detect a current-day planned block that has passed while its task remains open, then offer a realistic recovery choice without treating unfinished work as failure, silently changing user records, or rewriting plan history.

| Area                       | Delivered behavior                                                                                                                                                                                                         | Status     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Current-day signal         | The authenticated dashboard derives a signal only from the operative current local-day daily plan; historical/superseded plans are not resurfaced as a debt                                                                | **Tested** |
| Conservative eligibility   | A signal includes only open, unblocked, actionable linked tasks whose block has ended; a task with an active focus session is not presumed missed                                                                          | **Tested** |
| Explicit recovery boundary | The signal makes no database write, does not alter task status, and does not generate a plan. The person deliberately opens Planning Studio and chooses **Create recovery draft**                                          | **Tested** |
| Recovery capacity          | The existing remaining-day recovery generator still uses the authenticated user's configurable high-cognitive recovery cap and preserves the prior plan as history                                                         | **Tested** |
| Dashboard accessibility    | The task-completion meter now uses a semantic progressbar with explicit range/value attributes; Axe previously found the invalid ARIA label on its generic visual container                                                | **Tested** |
| API/browser evidence       | API integration proves signal/no-write/active-focus/completion behavior plus operative-recovery suppression; Chromium E2E verifies neutral copy, Plan Studio hand-off, recovery CTA, semantic progressbar, and an Axe scan | **Tested** |

### Increment 5 — mobile, offline, resilience

| Feature                                     | Status          | Notes                                            |
| ------------------------------------------- | --------------- | ------------------------------------------------ |
| Expo/React Native app                       | **Not Started** | No mobile project existed in audit               |
| Offline operation/synchronization/conflicts | **Not Started** | Cannot be claimed without implementation/testing |
| Android/iOS verification                    | **Blocked**     | No mobile app/emulator has been provisioned      |

### Increment 6 — production hardening

| Feature                                 | Status          | Notes                                                                                                                                                                                                                                                             |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser E2E and automated accessibility | **Tested**      | Local isolated Chromium covers authenticated project/goal/task, recovery, protected-capacity planning, rejected-draft preservation, active/paused focus reloads, and non-UTC DST error flows with Axe; the earlier GitHub CI run covers its prior four-test scope |
| Responsive visual regression baselines  | **Tested**      | Desktop/mobile account and authenticated-goals baselines plus responsive keyboard checks passed locally and in clean GitHub-hosted Chromium CI                                                                                                                    |
| Manual screen-reader walkthrough        | **Blocked**     | The sandbox has no NVDA, VoiceOver, TalkBack, or equivalent human assistive-technology environment; a documented human protocol is ready                                                                                                                          |
| Backup/restore runbook for hosted data  | **Not Started** | Local copy guidance only                                                                                                                                                                                                                                          |
| Monitoring/error reporting/deployment   | **Not Started** | No deployment configuration supplied                                                                                                                                                                                                                              |
| External calendar integration           | **Not Started** | Never show connected status without real authorization                                                                                                                                                                                                            |

### Increment 6 delivery — authenticated browser verification

**Objective:** Exercise the owned project, goal, milestone, and task workflow in a real Chromium browser, while adding meaningful automated accessibility and keyboard coverage without changing the factual-progress or planner-boundary semantics.

| Area                                    | Delivered behavior                                                                                                                                                                                                     | Status          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Isolated browser environment            | Playwright starts an API on port `3101`, a Vite client on port `5174`, and a fresh `/tmp/focusai-e2e.db`; it never uses a developer database or a running product server in CI                                         | **Tested**      |
| Authenticated workflow                  | One browser flow registers an account, creates a project/goal/milestone/task, deliberately links the task to the goal, verifies both guarded goal-completion failures, completes recorded work, and completes the goal | **Tested**      |
| Planner boundary                        | The E2E flow deliberately sets and then rechecks `goal_alignment` across goal linking; links do not silently rewrite that value, task scoring, plans, or accepted schedule history                                     | **Tested**      |
| Keyboard navigation                     | The authenticated shell now exposes a visible-on-focus skip link that moves focus to the primary workspace landmark; the browser flow exercises it with the keyboard                                                   | **Tested**      |
| Automated accessibility                 | Axe scans the account-creation screen and the completed authenticated goal workspace with no rule suppression; both scans passed in Chromium                                                                           | **Tested**      |
| CI browser verification                 | GitHub Actions run `38246192999` installed Chromium, ran `npm run test:e2e` successfully, and is configured to retry once plus upload Playwright diagnostics on future failure                                         | **Tested**      |
| Manual assistive-tech and visual review | Responsive visual/keyboard baselines are now automated; human screen-reader and broader manual contrast/design review remain unavailable in this sandbox                                                               | **In Progress** |

### Increment 6 delivery — responsive visual and semantic review

**Objective:** Turn the focused browser accessibility coverage into repeatable desktop/mobile visual and keyboard checks, fix genuine semantic or focus-management findings, and avoid claiming that automated browser checks are a human screen-reader certification.

| Area                            | Delivered behavior                                                                                                                                                                                       | Status      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Visual baselines                | Six reviewed screenshots cover account access plus populated Goals & Milestones top/card states at `1440×960` and `390×844`; they are checked into `e2e/__visual-baselines__` and compared by Playwright | **Tested**  |
| Responsive checks               | The browser suite asserts no horizontal overflow, the mobile navigation/desktop-rail boundary, and readable mobile navigation labels                                                                     | **Tested**  |
| Account-mode semantics          | Auth mode uses a connected tablist/tabpanel, roving tab stop, selection state, and Arrow/Home/End keyboard behavior rather than presentation-only tab roles                                              | **Tested**  |
| Dialog keyboard behavior        | Quick capture and the task editor now set initial focus, trap Tab/Shift+Tab, handle Escape when safe, and restore focus to the trigger after dismissal                                                   | **Tested**  |
| Mobile capture naming           | The icon-only compact capture control retains the explicit accessible name “Capture a task”; mobile Axe no longer reports an unnamed button                                                              | **Tested**  |
| Automated CI visual result      | Local custom Chromium and GitHub Actions run `38249868995` each passed all four browser tests, including the checked-in visual comparisons                                                               | **Tested**  |
| Human screen-reader walkthrough | No human screen reader is available in the sandbox. `docs/ACCESSIBILITY_REVIEW.md` records a concrete NVDA/VoiceOver/mobile protocol and the evidence still needed                                       | **Blocked** |

See [`ACCESSIBILITY_REVIEW.md`](ACCESSIBILITY_REVIEW.md) for screenshot governance, resolved findings, and the manual assistive-technology procedure.

### Increment 6 delivery — schedule, planning, and focus browser verification

**Objective:** Exercise the already-implemented Schedule & Capacity, Planning Studio, and Focus Studio boundaries in a real browser, including explicit conflict/no-write, reload-persistence, and non-UTC daylight-saving failure paths, without pretending that browser automation replaces human assistive-technology review.

| Area                           | Delivered behavior                                                                                                                                                                                                                                                | Status     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Profile and protected capacity | The browser saves UTC working hours/zero transition buffer, creates a future fixed commitment, and verifies the generated daily draft exposes the resulting 90-minute available capacity                                                                          | **Tested** |
| Explicit schedule boundary     | The browser edits a draft block from 09:00 to 10:00, saves the whole draft, then attempts an overlap with the protected commitment. It sees the server conflict and reads the plan back to prove the last saved schedule/history remains at 10:00 before approval | **Tested** |
| Focus lifecycle                | The browser links the still-open task, starts, reloads while active, pauses, reloads while paused with its persisted timer frozen, resumes, and records completion; history records completion without silently completing the task                               | **Tested** |
| Non-UTC/DST safety             | In `America/New_York`, the Schedule UI surfaces the server's clear rejection for a spring-forward nonexistent local time and a fall-back ambiguous local time; neither creates a commitment                                                                       | **Tested** |
| Automated accessibility        | Axe scans pass on Schedule & Capacity, Planning Studio in the rejected-conflict state, and Focus Studio after persisted reload states, without rule suppression                                                                                                   | **Tested** |

**Scope limit:** This covers one protected-capacity/save/conflict/focus path and two DST error cases. It does not certify all zones, dependency/buffer/capacity conflict variants, deferrals, long-running/offline timing, or a human screen-reader experience.

## Files and architectural areas added across Increments 1–6

- `apps/web`: React/Vite responsive product surfaces/design system, private registration/sign-in gate/account header, Goals & Milestones UI, and Schedule & Capacity UI.
- `apps/api`: Fastify `/api/v1`, additive schema migration, authenticated route guards, password/session services, IANA-time conversion, owned project/goal/milestone/task/plan/focus repositories, and API integration tests.
- `packages/decision-engine`: pure scoring/scheduling/recovery package and unit tests.
- `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISION_ENGINE.md`, `docs/TESTING.md`, and `docs/AUTHENTICATION.md`.
- Root workspace/tooling, `.env.example`, `.gitignore`, and `.github/workflows/ci.yml`.
- `e2e/authenticated-workspace.spec.ts`, `e2e/accessibility-visual.spec.ts`, and `playwright.config.ts`: isolated real-browser account creation, semantic keyboard/dialog checks, desktop/mobile visual baselines, project/goal/milestone/task lifecycle, recovery hand-off, protected-capacity planning/manual save plus rejected-conflict preservation, active/paused focus reload persistence, explicit non-UTC DST rejection, and Axe checks.
- `apps/web/src/hooks/useDialogFocus.ts` and `docs/ACCESSIBILITY_REVIEW.md`: reusable modal focus management plus the responsive visual/manual assistive-technology review record.
- `PlanRepository.recoverySignal`, `DashboardPage`, and `PlanPage`: read-only current-day recovery detection plus an explicit neutral hand-off to the existing remaining-day recovery draft flow.

### Database migrations added

- Schema version **1** in `apps/api/src/db/schema.ts`, tracked in `schema_migrations`.
- Schema version **2** adds user credential metadata, `auth_sessions`, normalized email uniqueness, and `auth_audit_events` additively.
- Schema version **3** adds nullable `tasks.parent_task_id`, constrained `tasks.is_decomposed`, and an owned parent lookup index for user-confirmed breakdowns.
- Schema version **4** adds owned `projects`, `goals`, and `milestones`, plus nullable `tasks.goal_id`; project deletion releases goals and goal deletion releases task links while cascading milestones.
- No destructive reset was used. The normal local database is ignored by Git. Tests use temporary throwaway databases.

## Verification log

| Date       | Command / check                                                             | Actual result                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | `git status --short --branch`, `git log --oneline -8`, repository inventory | Passed — clean one-commit baseline with only README                                                                                                                                                                                                                                                                                                                     |
| 2026-10-12 | `node --version && npm --version`                                           | Passed — Node `v22.22.3`, npm `10.9.8`                                                                                                                                                                                                                                                                                                                                  |
| 2026-10-12 | `npm ci`                                                                    | Passed — clean lockfile install, 0 audit vulnerabilities reported                                                                                                                                                                                                                                                                                                       |
| 2026-10-12 | Baseline `npm run test` before Increment 2                                  | Passed — 2 API integration tests + 4 decision-engine unit tests                                                                                                                                                                                                                                                                                                         |
| 2026-10-12 | `npm run typecheck`                                                         | Passed — API, web, and decision-engine TypeScript checks                                                                                                                                                                                                                                                                                                                |
| 2026-10-12 | `npm run lint`                                                              | Passed — zero warnings allowed                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-12 | `npm run test`                                                              | Passed — 5 authenticated API integration tests + 4 decision-engine unit tests                                                                                                                                                                                                                                                                                           |
| 2026-10-12 | `npm run build`                                                             | Passed — decision-engine/API compilation and Vite production build                                                                                                                                                                                                                                                                                                      |
| 2026-10-12 | `npm run format:check`                                                      | Passed — all matched files use Prettier style                                                                                                                                                                                                                                                                                                                           |
| 2026-10-12 | `npm audit --audit-level=moderate`                                          | Passed — 0 vulnerabilities in installed lockfile                                                                                                                                                                                                                                                                                                                        |
| 2026-10-12 | Existing local SQLite migration inspection                                  | Passed — schema migrations 1 and 2 present; user credential columns added without deleting existing local data                                                                                                                                                                                                                                                          |
| 2026-10-12 | Isolated real-HTTP auth smoke                                               | Passed — register 201, HTTP-only cookie, CSRF rejection 403, protected task creation 201, logout 204, revoked-session dashboard 401; temporary database removed afterward                                                                                                                                                                                               |
| 2026-10-12 | Vite preview/proxy smoke                                                    | Passed — preview root 200 and relative proxied unauthenticated dashboard 401                                                                                                                                                                                                                                                                                            |
| 2026-10-12 | Clean-artifact typecheck/test simulation                                    | Passed — removed generated decision-engine artifacts; API typecheck resolved source and API pretest rebuilt runtime artifacts                                                                                                                                                                                                                                           |
| 2026-10-12 | Schedule increment command suite                                            | Passed — typecheck, lint, 6 authenticated API integration tests + 4 engine tests, build, format check, and moderate audit                                                                                                                                                                                                                                               |
| 2026-10-12 | Isolated real-HTTP schedule smoke                                           | Passed — preference 200, event 201, fixed capacity 120, flexible capacity 180, preserved UTC instant after zone change, DST gap 409; temporary database removed                                                                                                                                                                                                         |
| 2026-10-12 | Schedule preview/proxy smoke                                                | Passed — `/schedule` served 200; direct and relative-proxy unauthenticated preferences returned 401                                                                                                                                                                                                                                                                     |
| 2026-10-12 | GitHub Actions run `38235014038`                                            | Passed — clean `npm ci`, lint, typecheck, tests, build, and moderate audit on the pull request branch                                                                                                                                                                                                                                                                   |
| 2026-10-12 | Task editing/decomposition command suite                                    | Passed — zero-warning lint; API/web/engine typecheck; 7 authenticated API integration tests + 4 engine tests; production build; Prettier check; moderate audit with 0 vulnerabilities                                                                                                                                                                                   |
| 2026-10-12 | Isolated real-HTTP task-edit/decomposition smoke                            | Passed — authenticated full-field edit, explicit 2-step confirmation, parent focus rejection, planner parent exclusion/step scheduling, and child release after container deletion                                                                                                                                                                                      |
| 2026-10-12 | Local additive V3 migration and preview/proxy smoke                         | Passed — normal local database advanced to version 3 with new task columns (no records existed to rewrite); API health 200; Vite `/tasks` 200 and relative protected API proxy 401                                                                                                                                                                                      |
| 2026-10-12 | GitHub Actions run `38237130440`                                            | Passed — clean `npm ci`, lint, typecheck, tests, build, and moderate audit for the task-editing/decomposition implementation commit; only external Node 20/Ubuntu runner deprecation annotations remained                                                                                                                                                               |
| 2026-10-12 | Reviewed plan-scheduling implementation suite                               | Passed — clean `npm ci`; Prettier write/check; zero-warning lint; API/web/engine typecheck; production build; full root test (8 authenticated API integration tests + 4 decision-engine unit tests)                                                                                                                                                                     |
| 2026-10-12 | Isolated real-HTTP reviewed-plan scheduling smoke                           | Passed — registration/session/CSRF flow, two persisted tasks, editable daily draft, `PATCH /plans/:id/blocks`, profile-local block times, and manual-edit audit timestamp; temporary SQLite database removed afterward                                                                                                                                                  |
| 2026-10-12 | Planning Studio preview/proxy smoke                                         | Passed — Vite `/plan` shell returned 200 and its relative unauthenticated `/api/v1/plans` proxy returned the expected 401; temporary API database removed afterward                                                                                                                                                                                                     |
| 2026-10-12 | GitHub Actions runs `38241770223` and `38241775664`                         | Passed — clean CI lint, typecheck, API/decision-engine tests, and production build for the schedule-editing commit on both push and pull-request events                                                                                                                                                                                                                 |
| 2026-10-12 | Projects/goals/milestones foundation command suite                          | Passed — zero-warning lint; API/web/engine typecheck; 9 authenticated API integration tests + 4 decision-engine tests; production build; Prettier check; moderate audit with 0 vulnerabilities                                                                                                                                                                          |
| 2026-10-12 | Isolated real-HTTP projects/goals/milestones smoke                          | Passed — registration, project/goal/task/milestone CRUD, guarded premature goal completion 409, recorded completion, and linked-task filtering; temporary SQLite database removed afterward                                                                                                                                                                             |
| 2026-10-12 | Goals route preview/proxy smoke                                             | Passed — Vite `/goals` shell returned 200 and its relative unauthenticated `/api/v1/goals` proxy returned 401; a separate empty preview database is used                                                                                                                                                                                                                |
| 2026-10-12 | Browser-verification command suite                                          | Passed — zero-warning lint; API/web/engine/E2E TypeScript checks; 9 API integration tests + 4 decision-engine tests; production build; Prettier check; moderate audit with 0 vulnerabilities                                                                                                                                                                            |
| 2026-10-12 | `npm run test:e2e -- --list`                                                | Passed — Playwright loaded the isolated-server configuration and discovered the account-creation accessibility scan plus authenticated project/goal/task/milestone flow                                                                                                                                                                                                 |
| 2026-10-12 | Default local `npm run test:e2e`                                            | **Blocked by environment** — source servers started, but this sandbox has no bundled Playwright Chromium executable at `/home/user/.cache/ms-playwright`; no application assertion ran in that attempt                                                                                                                                                                  |
| 2026-10-12 | Isolated Chromium browser E2E and Axe run                                   | Passed — with a temporary Chromium 143 executable provided through `PLAYWRIGHT_EXECUTABLE_PATH`, both Playwright tests passed: account-creation Axe scan plus keyboard/project/goal/milestone/task workflow and Axe scan                                                                                                                                                |
| 2026-10-12 | GitHub Actions run `38246192999`                                            | Passed — clean `npm ci`, lint, typecheck, API/decision-engine tests, build, audit, Chromium installation, and both browser E2E/Axe tests; the failure-artifact step was correctly skipped                                                                                                                                                                               |
| 2026-10-12 | Local responsive visual/accessibility browser suite                         | Passed — temporary Chromium 143 ran 4 browser tests: visual baselines at desktop/mobile, tab semantics, modal focus management, responsive overflow/navigation checks, and Axe scans; a mobile unnamed Capture button was found and fixed                                                                                                                               |
| 2026-10-12 | GitHub Actions run `38249868995`                                            | Passed — clean `npm ci`, lint, typecheck, 9 API + 4 decision-engine tests, production build, moderate audit, Chromium install, and all 4 browser E2E/Axe/visual-baseline tests; failure-artifact upload was correctly skipped                                                                                                                                           |
| 2026-10-12 | Non-punitive recovery implementation suite                                  | Passed — Prettier check, zero-warning lint, API/web/engine/E2E TypeScript checks, 10 API integration tests, 4 decision-engine tests, production build, and moderate audit with 0 vulnerabilities                                                                                                                                                                        |
| 2026-10-12 | Full Chromium recovery/accessibility/visual suite                           | Passed — temporary Chromium 143 ran all 5 tests: two reviewed visual/semantic tests plus account, recovery hand-off, and project-to-goal browser flows. The recovery dashboard Axe scan exposed an invalid generic-div ARIA label; it was fixed as a semantic progressbar and the rerun passed                                                                          |
| 2026-10-12 | Schedule/planning/focus browser-verification suite                          | Passed — temporary Chromium 143 ran the expanded 5-test authenticated browser suite: real UTC protected-capacity planning, complete-draft manual save/approval, linked focus start/pause/resume/completion with task-state preservation, and `America/New_York` nonexistent/ambiguous DST rejection. Axe scans passed for Schedule, Plan, and Focus                     |
| 2026-10-12 | Full Chromium browser, Axe, and visual-baseline suite                       | Passed — temporary Chromium 143 ran all 7 tests: two reviewed responsive visual/semantic baselines plus five authenticated workflows covering account, recovery, schedule/plan/focus, non-UTC DST errors, and project-to-goal lifecycle                                                                                                                                 |
| 2026-10-12 | Conflict-preservation and focus-reload verification                         | Passed — Prettier check, typecheck, zero-warning lint, 10 API integration tests, 4 decision-engine tests, production build, moderate audit with 0 vulnerabilities, and all 7 Chromium browser/Axe/visual tests. A rejected fixed-commitment overlap left the saved block/history intact; active then paused focus sessions survived reload with the paused timer frozen |

## Risks, limitations, and next highest-priority action

| Item                                   | Risk / limitation                                                                                                                                                                           | Next action                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local development deployment           | Auth/ownership is implemented, but the SQLite adapter is not a hosted production database                                                                                                   | Add supported production database and deployment security configuration                               |
| Experimental `node:sqlite`             | Not an appropriate unqualified production datastore claim                                                                                                                                   | Add supported production relational adapter and migration tooling                                     |
| DST ambiguity / nonexistent local time | The API and browser flow reject tested `America/New_York` gap/ambiguous values without guessing, but do not offer an explicit disambiguation choice or exhaustively cover all zones         | Design user-facing disambiguation choices and broaden zone/date coverage                              |
| Manual local calendar only             | No external provider authorization, sync, recurrence, or conflict guidance exists                                                                                                           | Design explicit calendar connection and recurrence workflows                                          |
| Confirmed one-level breakdown          | Steps are explicitly user-authored and safe for new drafts, but nested hierarchy, recurrence, and tags are intentionally absent                                                             | Evaluate richer hierarchy or recurrence only with explicit data-model and planning semantics          |
| Goal context vs. planning              | Goal records and factual progress exist, but goal links deliberately do not change deterministic planner weighting or analytics                                                             | Define any goal-aware recommendation behavior explicitly, then add tests                              |
| Manual daily-draft scheduling          | Edits are safely constrained to one day/current draft and do not split blocks or resolve conflicts automatically                                                                            | Design explicit multi-day/block-splitting conflict-resolution rules before expanding controls         |
| Read-time recovery signal              | It intentionally detects only current-day completed-time blocks and offers one explicit draft action; it has no background notifications, inferred excuses, or automatic task mutation      | Consider opt-in reminders/notification semantics only with privacy, delivery, and user-control design |
| No mobile/offline                      | Cross-device/offline acceptance criteria are unverified                                                                                                                                     | Stabilize auth/API contracts, then add Expo client and sync design                                    |
| Local browser availability             | The default Playwright cache is absent in this Arena sandbox, but a temporary compatible Chromium executable and clean GitHub Chromium both passed the suite                                | Use the standard Playwright browser install for future local reruns                                   |
| Automated versus manual accessibility  | Axe, semantic keyboard checks, and focused visual baselines now catch regressions on account/goals surfaces but do not replace a human screen-reader review or broad all-route visual audit | Run the documented NVDA/VoiceOver/mobile walkthrough in a supported environment                       |

**Next highest-priority action: run the documented NVDA/VoiceOver/mobile human walkthrough in a supported environment.** The focused browser visual/semantic suite is now tested in local and GitHub-hosted Chromium, but it does not certify real assistive-technology output. The tested suite intentionally verifies stored project/goal/task/milestone progress and goal-link filtering without changing task scoring, plans, or accepted schedule history. No manual screen-reader certification is claimed yet.
