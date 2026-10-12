# Testing FocusAI

## Automated suites currently present

### Decision engine unit tests

Location: `packages/decision-engine/src/index.test.ts`

| Case                      | What it proves                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Urgent scoring            | An overdue, high-impact task ranks above low-impact undated work                   |
| Fixed commitment capacity | A fixed event is subtracted and a task that cannot fit is explicitly deferred      |
| Dependency order          | A prerequisite is scheduled before a higher-ranked dependent task                  |
| Recovery cap              | The configurable 20% high-cognitive recovery cap is enforced only in recovery mode |

### API integration tests

Location: `apps/api/src/app.integration.test.ts`

The suite creates a unique temporary SQLite file for each test. It injects requests directly into Fastify, then closes/removes the temporary data directory.

| Case                                     | What it proves                                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated core workflow              | Account registration, HTTP-only session issue, CSRF rejection/success, task persistence, dashboard ranking, plan/recovery persistence, and focus transitions                                                                        |
| Data isolation and rotation              | One user cannot list or mutate another user’s task; an old opaque token fails after session rotation                                                                                                                                |
| Legacy claim                             | A first secure registration claims preserved version-1 local records transactionally                                                                                                                                                |
| Additive migration                       | A real v1 database upgrades through schema v4 without resetting preserved user/task data; breakdown and nullable goal-link columns default safely                                                                                   |
| Task editor and confirmed breakdown      | Full task-field/dependency update, ownership rejection, reviewed step creation, inherited parent goal link, parent planning/focus exclusion, dependency-cycle rejection, and safe parent deletion recovery                          |
| Projects, goals, and milestones          | Owned project/goal/milestone CRUD, cross-user rejection, factual task/milestone progress, guarded completion/reopening, active-project guard, goal-link filtering, decomposition inheritance, and release/cascade deletion behavior |
| Reviewed plan scheduling                 | Owner-only whole-draft schedule save, profile-local conversion, feasible reorder, DST gap/ambiguity rejection, preference-change regeneration requirement, dependency/commitment rejection, and immutable accepted-plan history     |
| Preferences, commitments, and time zones | CSRF protection, IANA zone/working-window update, owned calendar CRUD, fixed-capacity subtraction, flexible-event behavior, and DST gap rejection                                                                                   |
| Non-punitive recovery signal             | A current passed block is surfaced without writes; active focus and an operative recovery plan suppress a false/repeated signal, and completing the task clears it                                                                  |
| Invalid registration                     | Consistent 400 validation response shape                                                                                                                                                                                            |

### Chromium browser E2E and automated accessibility

Location: `e2e/authenticated-workspace.spec.ts`

The Playwright configuration starts a dedicated API at `127.0.0.1:3101`, a Vite client at `127.0.0.1:5174`, and a fresh temporary SQLite database at `/tmp/focusai-e2e.db`. CI never reuses a developer server or database. The authenticated browser flow covers:

- account creation and the authenticated shell's keyboard-operable skip link;
- project, goal, and milestone creation;
- task capture, deliberate task-to-goal linking in the full editor, preservation of an explicitly set `goal_alignment` value, and linked-goal filtering;
- both factual completion guards (unfinished linked task, then unfinished milestone), followed by recorded task/milestone/goal completion;
- a server-derived current-day recovery prompt for a passed open block, neutral no-penalty wording, its explicit hand-off to Planning Studio, and the recovery-draft CTA;
- a profile-UTC future plan around a protected commitment, including a lower-priority prerequisite scheduled before its higher-priority dependent task, an explicit feasible two-block daily-draft adjustment that preserves that order, a rejected overlap that leaves the last saved schedule unchanged, and plan approval;
- a 90-minute lower-priority prerequisite deferred across fragmented remaining capacity, plus its higher-priority dependent task separately deferred with the factual dependency explanation; the planner does not force either task into the day, and Task Workspace confirms both remain actionable with their dependency link intact;
- linked focus-session start, active reload, pause, paused reload with frozen persisted time, resume, and recorded completion, while confirming the linked task is not silently completed;
- a non-UTC (`America/New_York`) calendar flow that rejects both a spring-forward nonexistent time and a fall-back ambiguous time without creating a commitment;
- Axe scans of the account-creation screen, recovery-prompt dashboard, Schedule & Capacity, Planning Studio in its capacity/dependency-deferred and rejected-conflict states, Focus Studio, and completed authenticated goal workspace, without rule suppression.

Run it after Chromium is available:

```bash
npx playwright install chromium
npm run test:e2e
```

The GitHub Actions `Browser E2E and accessibility` job installs Chromium with system dependencies and uploads Playwright diagnostics when a browser test fails. The default Playwright browser cache is absent in the current Arena sandbox, but the suite passed locally against a temporary compatible Chromium executable supplied through `PLAYWRIGHT_EXECUTABLE_PATH` and in GitHub Actions run `38246192999`; exact commands and results are recorded in `docs/IMPLEMENTATION_STATUS.md`.

### Responsive visual and semantic regression checks

Location: `e2e/accessibility-visual.spec.ts`

This focused suite creates a stable project/goal/milestone workspace and compares six reviewed screenshots at desktop (`1440×960`) and phone (`390×844`) widths. It also verifies account-mode tab semantics and keyboard behavior, modal focus trapping/return, the responsive navigation boundary, no horizontal overflow, and mobile/desktop Axe scans. The screenshots live under `e2e/__visual-baselines__/` and are committed intentionally.

Run only this review suite with:

```bash
npm run test:e2e -- e2e/accessibility-visual.spec.ts
```

Refresh a screenshot only after reviewing an intended change:

```bash
npm run test:e2e -- e2e/accessibility-visual.spec.ts --update-snapshots
```

Do not use a snapshot refresh to conceal a visual regression. See [`ACCESSIBILITY_REVIEW.md`](ACCESSIBILITY_REVIEW.md) for screenshot governance, findings, and the still-required human NVDA/VoiceOver/mobile procedure.

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e # E2E, Axe, keyboard, and visual-baseline checks; requires Chromium
npm run build
npm audit --audit-level=moderate
```

Run all available checks before describing a code change as verified. The prior two-test Chromium browser suite and its expanded four-test visual/semantic suite passed on 2026-10-12, including clean GitHub-hosted Chromium CI run `38249868995`. The current seven-test browser suite adds recovery, protected-capacity planning with dependency sequencing and honest capacity/dependency deferrals, rejected-conflict preservation, active/paused focus reload persistence, and non-UTC daylight-saving error coverage; its latest result is recorded in `docs/IMPLEMENTATION_STATUS.md`. Rerun the appropriate suite after environment or code changes.

## Manual smoke workflow

With `npm run dev` running:

1. Open the web app and confirm the private sign-up/sign-in gate appears for a fresh browser session.
2. Create an account with a 12+ character passphrase and confirm the command center opens.
3. Reload the app and confirm the HTTP-only session restores the workspace without a local-storage token.
4. Open **Schedule & capacity**, set an IANA time zone and working window, then save it.
5. Add a fixed commitment in that local time zone and verify it appears as **Protected** in the commitment view.
6. Open **Goals & milestones**, create a project, a goal, and one milestone. Confirm the milestone and goal only show recorded progress, not sample analytics.
7. Open **Task workspace** and quick-capture a task with an estimate and priority. Open its edit control, deliberately choose the goal, change a field, and save it. Confirm the goal link does not alter the separate goal-alignment value.
8. Return to **Goals & milestones**, use the task link to filter the Task Workspace, complete the linked task and milestone, then complete the goal. Try completing a goal with unfinished work first to confirm the server explains the guard.
9. In the task editor, open **Break into steps**, enter and review at least two titles/estimates, then use **Confirm and create steps**. Confirm the parent is labeled as a breakdown container, its steps are visible/actionable, and they retain the parent’s goal link.
10. Open **Planning studio**, select readiness, generate a daily draft, and confirm fixed commitment time is excluded from capacity/block placement while the breakdown parent itself is not scheduled.
11. Choose **Edit schedule**, adjust a block start or use the adjacent move controls, then save. Confirm the draft updates only when no fixed commitment, transition buffer, or dependency is violated; discard a draft edit to confirm nothing changes until save.
12. Approve a useful plan, then confirm it no longer exposes manual editing. Change a commitment to **Flexible**, regenerate, and confirm capacity is no longer reserved for it.
13. Open **Focus studio**, link an actionable task step, start the session, pause/resume, and record it complete. A breakdown container should not be accepted as a focus target.
14. Use the sign-out control and confirm the app returns to the sign-in gate; reload to confirm protected API data is no longer accessible through that revoked session.

## What is not verified yet

No claim is made for the following until tests and supported environments are added:

- manual screen-reader walkthroughs and a full visual accessibility audit across all routes/breakpoints (focused account/goals keyboard, Axe, and visual baselines are automated; human assistive-technology validation is still blocked here);
- email verification, password reset, account deletion/export UX;
- broad browser E2E coverage across additional IANA zones/DST cases, dependency/buffer/capacity conflict variants, broader multi-task/dependency/recovery sequencing and deferral patterns, long-running/offline focus timing, visual/calendar states, and responsive states beyond the covered UTC planning flow, one ordered prerequisite/dependent pair, one fragmented-capacity prerequisite/dependent deferral, one protected-commitment conflict, active/paused reloads, and `America/New_York` DST rejection;
- production cookie/proxy/CORS/CSP deployment configuration;
- external calendar authorization;
- LLM provider timeout/schema/privacy behavior;
- React Native, Android/iOS, offline, or synchronization behavior;
- production load, backup/restore, observability, or deployment checks.
