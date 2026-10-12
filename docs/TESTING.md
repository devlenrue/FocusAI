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

| Case                                     | What it proves                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated core workflow              | Account registration, HTTP-only session issue, CSRF rejection/success, task persistence, dashboard ranking, plan/recovery persistence, and focus transitions |
| Data isolation and rotation              | One user cannot list or mutate another user’s task; an old opaque token fails after session rotation                                                         |
| Legacy claim                             | A first secure registration claims preserved version-1 local records transactionally                                                                         |
| Additive migration                       | A real v1 database upgrades to schema v2 without resetting the existing user record                                                                          |
| Preferences, commitments, and time zones | CSRF protection, IANA zone/working-window update, owned calendar CRUD, fixed-capacity subtraction, flexible-event behavior, and DST gap rejection            |
| Invalid registration                     | Consistent 400 validation response shape                                                                                                                     |

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
```

Run all checks before describing a code change as verified. The full command set passed for the authenticated schedule/capacity increment on 2026-10-12, as logged in `docs/IMPLEMENTATION_STATUS.md`. Rerun it after environment or code changes.

## Manual smoke workflow

With `npm run dev` running:

1. Open the web app and confirm the private sign-up/sign-in gate appears for a fresh browser session.
2. Create an account with a 12+ character passphrase and confirm the command center opens.
3. Reload the app and confirm the HTTP-only session restores the workspace without a local-storage token.
4. Open **Schedule & capacity**, set an IANA time zone and working window, then save it.
5. Add a fixed commitment in that local time zone and verify it appears as **Protected** in the commitment view.
6. Open **Task workspace** and create a task with an estimate and priority.
7. Open **Planning studio**, select readiness, generate a draft, and confirm fixed commitment time is excluded from capacity/block placement; approve it if it is useful.
8. Change the commitment to **Flexible**, regenerate, and confirm capacity is no longer reserved for it.
9. Open **Focus studio**, link the task, start the session, pause/resume, and record it complete.
10. Use the sign-out control and confirm the app returns to the sign-in gate; reload to confirm protected API data is no longer accessible through that revoked session.

## What is not verified yet

No claim is made for the following until tests and supported environments are added:

- browser E2E / visual regression testing;
- keyboard/screen-reader accessibility audit;
- email verification, password reset, account deletion/export UX;
- browser E2E coverage across IANA zones, ambiguous DST fall-back times, and visual/calendar accessibility;
- production cookie/proxy/CORS/CSP deployment configuration;
- external calendar authorization;
- LLM provider timeout/schema/privacy behavior;
- React Native, Android/iOS, offline, or synchronization behavior;
- production load, backup/restore, observability, or deployment checks.
