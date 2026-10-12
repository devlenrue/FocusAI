# Testing FocusAI

## Automated suites currently present

### Decision engine unit tests

Location: `packages/decision-engine/src/index.test.ts`

| Case | What it proves |
| --- | --- |
| Urgent scoring | An overdue, high-impact task ranks above low-impact undated work |
| Fixed commitment capacity | A fixed event is subtracted and a task that cannot fit is explicitly deferred |
| Dependency order | A prerequisite is scheduled before a higher-ranked dependent task |
| Recovery cap | The configurable 20% high-cognitive recovery cap is enforced only in recovery mode |

### API integration tests

Location: `apps/api/src/app.integration.test.ts`

The suite creates a unique temporary SQLite file for each test. It injects requests directly into Fastify, then closes/removes the temporary data directory.

| Case | What it proves |
| --- | --- |
| Task → dashboard → plan → recovery → focus | Task persistence, dashboard ranking, plan block persistence, remaining-day recovery capacity, one-active-session protection, pause/complete state transitions |
| Invalid task request | Consistent 400 validation response shape |

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
```

Run all checks before describing a code change as verified. The current implementation's successful baseline is logged in `docs/IMPLEMENTATION_STATUS.md`; tests must still be rerun after environment or code changes.

## Manual smoke workflow

With `npm run dev` running:

1. Open the web app and confirm the command center shows its empty state in a fresh local workspace.
2. Open **Task workspace** and create a task with an estimate and priority.
3. Return to **Command center** and confirm the real task appears among the top signals.
4. Open **Planning studio**, select readiness, generate a draft, inspect capacity/reasons, and approve it.
5. Open **Focus studio**, link the task, start the session, pause/resume, and record it complete.
6. Reload the page while a session is active or paused and confirm the active session state is restored from the API.
7. In Planning Studio, choose **Recalculate remaining day** and confirm the recovery draft is reviewed before acceptance.

## What is not verified yet

No claim is made for the following until tests and supported environments are added:

- browser E2E / visual regression testing;
- keyboard/screen-reader accessibility audit;
- full time-zone/DST behavior;
- authenticated multi-user isolation;
- email/session/password flows;
- external calendar authorization;
- LLM provider timeout/schema/privacy behavior;
- React Native, Android/iOS, offline, or synchronization behavior;
- production load, backup/restore, observability, or deployment checks.
