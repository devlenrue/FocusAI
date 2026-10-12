# FocusAI authentication and session security

## Scope of this increment

FocusAI now has real registration, sign-in, sign-out, opaque sessions, server-side resource ownership, CSRF-protected mutations, session rotation/revocation routes, and audit events. This is an **authenticated local-development implementation**, not a claim that hosted production identity, email delivery, account recovery, or a production database deployment have been completed.

## Password handling

Passwords are never logged or returned by the API. The current local adapter uses Node's vetted memory-hard `scrypt` implementation with:

- a unique 16-byte random salt per password;
- `N = 32768`, `r = 8`, `p = 1`;
- a 64-byte derived key;
- a 64 MiB memory ceiling;
- constant-time derived-key comparison.

The stored format is a self-describing `$scrypt$...` string in `users.password_hash`. This satisfies the current “Argon2id or another appropriately configured vetted password hash” requirement without introducing an unverified native dependency. Argon2id may replace this behind the narrow password-service interface if selected for production deployment.

The password policy currently requires 12–1024 characters. There is no false claim of password-breach checking, email verification, or recovery support.

## Session model

After registration or sign-in, FocusAI issues two random values:

| Value             | Browser storage                  | Server storage                             | Purpose                                                                    |
| ----------------- | -------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `focusai_session` | HTTP-only, `SameSite=Lax` cookie | SHA-256 hash in `auth_sessions.token_hash` | Authenticates the request without exposing the session token to JavaScript |
| `focusai_csrf`    | Readable, `SameSite=Lax` cookie  | SHA-256 hash in `auth_sessions.csrf_hash`  | Bound double-submit CSRF token for unsafe requests                         |

Tokens are random 32-byte values encoded with Base64url. Only hashes are persisted. Session lifetime defaults to seven days and can be set with `FOCUSAI_SESSION_TTL_DAYS`. `FOCUSAI_COOKIE_SECURE` defaults to `true` under `NODE_ENV=production`; production must use HTTPS.

### Protected writes

All authenticated mutations require:

1. an unrevoked, unexpired opaque session cookie;
2. `X-CSRF-Token` matching the readable CSRF cookie; and
3. a server-side hash match bound to that session.

The React API client uses relative URLs, `credentials: 'include'`, and sends the header for unsafe methods. It stores no long-lived access token in local storage.

### Session lifecycle routes

| Route                                      | Purpose                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `POST /api/v1/auth/register`               | Create account, preferences, audit record, and session |
| `POST /api/v1/auth/login`                  | Verify password and issue a new session                |
| `GET /api/v1/auth/session`                 | Return authenticated user for app bootstrap            |
| `POST /api/v1/auth/logout`                 | Revoke current session and clear cookies               |
| `POST /api/v1/auth/session/rotate`         | Revoke current session and issue a new token pair      |
| `POST /api/v1/auth/sessions/revoke-others` | Revoke all other live sessions for the current user    |

Sign-in and registration are rate limited more aggressively than normal API routes. Successful/failed sign-ins, registration, logout, session rotation, revocation, and legacy workspace claims write minimal events to `auth_audit_events`. Passwords, session values, IP addresses, note contents, and email text are not copied into audit records.

## Ownership enforcement

Task, plan, and focus repositories no longer supply a default local user. Every protected route receives the authenticated user ID from server-side session context and passes it to data access. Resource lookups include `user_id` conditions; an attempted action against another user's task returns `404`, avoiding unnecessary confirmation that the record exists.

The API integration suite verifies:

- unauthenticated requests receive `401`;
- writes without a CSRF token receive `403`;
- one user cannot list or complete another user's tasks;
- old session tokens no longer work after rotation;
- logout revokes the current session.

## Legacy local workspace claim

Version 1 of FocusAI had one unauthenticated `local-development-user`. Migration 2 preserves its records. The **first** account registered on a database with that legacy workspace claims its tasks, plans, focus sessions, calendar events, and preferences in one transaction. The legacy user record is then removed only after its records have been reassigned. A later account cannot claim it.

This protects existing local data rather than deleting/resetting it, while making the transition explicit. The automated suite exercises both data preservation and the actual additive migration from schema version 1 to 2.

## Remaining security work

Before a hosted production claim, FocusAI still needs:

- email verification and password reset through a configured provider;
- account deactivation/deletion/export UX and retention policy;
- a production-supported relational database/ORM/backup plan;
- deployment-specific trusted-proxy, secure-cookie, CORS, CSP, and monitoring configuration;
- account/session device management UI;
- independent security review and browser E2E/accessibility testing.
