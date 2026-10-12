import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { config } from "../config.js";
import { FocusDatabase } from "../db/database.js";
import { hashPassword, verifyPassword } from "../security/passwords.js";
import { ConflictError } from "./repositories.js";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthContext {
  sessionId: string;
  user: AuthenticatedUser;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  is_active: number;
  created_at: string;
}

interface SessionContextRow {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
}

interface CsrfRow {
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

interface CountRow {
  count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function rowToUser(
  row: Pick<UserRow, "id" | "email" | "display_name" | "created_at">,
): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

/**
 * Cookie sessions use random opaque tokens. Only SHA-256 token/CSRF hashes are
 * persisted, so a local database copy does not contain reusable browser
 * credentials.
 */
export class AuthService {
  constructor(private readonly database: FocusDatabase) {}

  async register(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<{
    user: AuthenticatedUser;
    session: IssuedSession;
    claimedLegacyWorkspace: boolean;
  }> {
    const email = normalizeEmail(input.email);
    if (this.findUserByEmail(email)) {
      throw new ConflictError("An account with that email already exists.");
    }

    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    const now = nowIso();

    return this.database.transaction(() => {
      if (this.findUserByEmail(email)) {
        throw new ConflictError("An account with that email already exists.");
      }

      const canClaimLegacyWorkspace = this.canClaimLegacyWorkspace();
      this.database.run(
        `INSERT INTO users(id, email, display_name, password_hash, is_active, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [id, email, input.displayName.trim(), passwordHash, now, now, now],
      );

      const legacyClaim = canClaimLegacyWorkspace
        ? this.claimLegacyWorkspace(id)
        : { claimed: false, preferencesTransferred: false };
      if (!legacyClaim.preferencesTransferred || !this.hasPreferences(id))
        this.createDefaultPreferences(id, now);
      this.recordAudit("registered", id, now);
      if (legacyClaim.claimed)
        this.recordAudit("legacy_workspace_claimed", id, now);

      const user: AuthenticatedUser = {
        id,
        email,
        displayName: input.displayName.trim(),
        createdAt: now,
      };
      return {
        user,
        session: this.issueSession(id, now),
        claimedLegacyWorkspace: legacyClaim.claimed,
      };
    });
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<{ user: AuthenticatedUser; session: IssuedSession }> {
    const email = normalizeEmail(input.email);
    const row = this.findUserByEmail(email);
    const validPassword = row?.password_hash
      ? await verifyPassword(input.password, row.password_hash)
      : false;

    // Consume comparable memory-hard work for an absent/legacy account to make
    // account enumeration through timing less useful.
    if (!row?.password_hash) await hashPassword(input.password);

    if (!row || row.is_active !== 1 || !validPassword) {
      this.recordAudit("sign_in_failed", row?.id ?? null, nowIso());
      throw new UnauthorizedError("Email or password is incorrect.");
    }

    const now = nowIso();
    return this.database.transaction(() => {
      this.database.run(
        "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
        [now, now, row.id],
      );
      this.recordAudit("signed_in", row.id, now);
      return { user: rowToUser(row), session: this.issueSession(row.id, now) };
    });
  }

  contextForToken(token: string | undefined): AuthContext | null {
    if (!token) return null;
    const now = nowIso();
    const row = this.database.get<SessionContextRow>(
      `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, u.created_at
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1`,
      [hashOpaqueToken(token), now],
    );
    if (!row) return null;

    this.database.run(
      "UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?",
      [now, row.session_id],
    );
    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        createdAt: row.created_at,
      },
    };
  }

  verifyCsrf(sessionId: string, csrfToken: string): boolean {
    const row = this.database.get<CsrfRow>(
      "SELECT csrf_hash, expires_at, revoked_at FROM auth_sessions WHERE id = ?",
      [sessionId],
    );
    return Boolean(
      row &&
      !row.revoked_at &&
      row.expires_at > nowIso() &&
      hashesMatch(row.csrf_hash, hashOpaqueToken(csrfToken)),
    );
  }

  logout(sessionId: string): void {
    const now = nowIso();
    const context = this.contextForSessionId(sessionId);
    this.database.transaction(() => {
      this.database.run(
        "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [now, sessionId],
      );
      this.recordAudit("signed_out", context?.user.id ?? null, now);
    });
  }

  rotate(sessionId: string): IssuedSession {
    const context = this.contextForSessionId(sessionId);
    if (!context)
      throw new UnauthorizedError("Your session is no longer available.");
    const now = nowIso();
    return this.database.transaction(() => {
      this.database.run(
        "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [now, sessionId],
      );
      this.recordAudit("session_rotated", context.user.id, now);
      return this.issueSession(context.user.id, now);
    });
  }

  revokeOtherSessions(sessionId: string, userId: string): void {
    const now = nowIso();
    this.database.transaction(() => {
      this.database.run(
        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
        [now, userId, sessionId],
      );
      this.recordAudit("sessions_revoked", userId, now);
    });
  }

  private issueSession(userId: string, now: string): IssuedSession {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.parse(now) + config.sessionTtlSeconds * 1000,
    ).toISOString();
    this.database.run(
      `INSERT INTO auth_sessions(id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        randomUUID(),
        userId,
        hashOpaqueToken(token),
        hashOpaqueToken(csrfToken),
        expiresAt,
        now,
        now,
      ],
    );
    return { token, csrfToken, expiresAt };
  }

  private findUserByEmail(email: string): UserRow | undefined {
    return this.database.get<UserRow>(
      `SELECT id, email, display_name, password_hash, is_active, created_at
       FROM users WHERE lower(email) = lower(?) LIMIT 1`,
      [email],
    );
  }

  private contextForSessionId(sessionId: string): AuthContext | null {
    const row = this.database.get<SessionContextRow>(
      `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, u.created_at
       FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1`,
      [sessionId, nowIso()],
    );
    return row
      ? {
          sessionId: row.session_id,
          user: {
            id: row.user_id,
            email: row.email,
            displayName: row.display_name,
            createdAt: row.created_at,
          },
        }
      : null;
  }

  private canClaimLegacyWorkspace(): boolean {
    const legacy = this.database.get<{ id: string }>(
      "SELECT id FROM users WHERE id = ? AND password_hash IS NULL",
      [config.legacyLocalUserId],
    );
    if (!legacy) return false;
    const securedAccountCount =
      this.database.get<CountRow>(
        "SELECT COUNT(*) AS count FROM users WHERE id <> ? AND password_hash IS NOT NULL",
        [config.legacyLocalUserId],
      )?.count ?? 0;
    return securedAccountCount === 0;
  }

  private claimLegacyWorkspace(newUserId: string): {
    claimed: boolean;
    preferencesTransferred: boolean;
  } {
    const legacy = this.database.get<{ id: string }>(
      "SELECT id FROM users WHERE id = ? AND password_hash IS NULL",
      [config.legacyLocalUserId],
    );
    if (!legacy) return { claimed: false, preferencesTransferred: false };

    const legacyRecordCount =
      this.database.get<CountRow>(
        `SELECT
        (SELECT COUNT(*) FROM tasks WHERE user_id = ?) +
        (SELECT COUNT(*) FROM calendar_events WHERE user_id = ?) +
        (SELECT COUNT(*) FROM daily_plans WHERE user_id = ?) +
        (SELECT COUNT(*) FROM focus_sessions WHERE user_id = ?) AS count`,
        [legacy.id, legacy.id, legacy.id, legacy.id],
      )?.count ?? 0;
    const hadWorkspaceData = legacyRecordCount > 0;
    const preferencesTransferred = this.hasPreferences(legacy.id);

    this.database.run("UPDATE tasks SET user_id = ? WHERE user_id = ?", [
      newUserId,
      legacy.id,
    ]);
    this.database.run(
      "UPDATE calendar_events SET user_id = ? WHERE user_id = ?",
      [newUserId, legacy.id],
    );
    this.database.run("UPDATE daily_plans SET user_id = ? WHERE user_id = ?", [
      newUserId,
      legacy.id,
    ]);
    this.database.run(
      "UPDATE focus_sessions SET user_id = ? WHERE user_id = ?",
      [newUserId, legacy.id],
    );
    this.database.run(
      "UPDATE user_preferences SET user_id = ? WHERE user_id = ?",
      [newUserId, legacy.id],
    );
    this.database.run("DELETE FROM users WHERE id = ?", [legacy.id]);
    return { claimed: hadWorkspaceData, preferencesTransferred };
  }

  private hasPreferences(userId: string): boolean {
    return Boolean(
      this.database.get<{ user_id: string }>(
        "SELECT user_id FROM user_preferences WHERE user_id = ?",
        [userId],
      ),
    );
  }

  private createDefaultPreferences(userId: string, now: string): void {
    this.database.run(
      `INSERT INTO user_preferences(
        user_id, timezone, working_day_start, working_day_end, transition_minutes,
        high_cognitive_recovery_cap, created_at, updated_at
      ) VALUES (?, 'UTC', '09:00', '18:00', 10, 0.2, ?, ?)`,
      [userId, now, now],
    );
  }

  private recordAudit(
    eventType:
      | "registered"
      | "signed_in"
      | "sign_in_failed"
      | "signed_out"
      | "session_rotated"
      | "sessions_revoked"
      | "legacy_workspace_claimed",
    userId: string | null,
    createdAt: string,
  ): void {
    this.database.run(
      "INSERT INTO auth_audit_events(id, user_id, event_type, created_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), userId, eventType, createdAt],
    );
  }
}
