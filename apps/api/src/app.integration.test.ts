import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutgoingHttpHeaders } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { FocusDatabase } from "./db/database.js";
import { migrations } from "./db/schema.js";

let database: FocusDatabase;
let cleanupDirectory = "";
let app: Awaited<ReturnType<typeof buildApp>>;

interface AuthCookies {
  session: string;
  csrf: string;
  csrfToken: string;
  raw: string[];
}

function cookiesFrom(response: { headers: OutgoingHttpHeaders }): AuthCookies {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const session = values
    .find((value) => value.startsWith("focusai_session="))
    ?.split(";")[0];
  const csrf = values
    .find((value) => value.startsWith("focusai_csrf="))
    ?.split(";")[0];
  if (!session || !csrf)
    throw new Error("Expected both session and CSRF cookies.");
  return {
    session,
    csrf,
    csrfToken: csrf.split("=").slice(1).join("="),
    raw: values,
  };
}

function authHeaders(
  cookies: AuthCookies,
  csrf = true,
): Record<string, string> {
  return {
    cookie: `${cookies.session}; ${cookies.csrf}`,
    ...(csrf ? { "x-csrf-token": cookies.csrfToken } : {}),
  };
}

async function register(
  displayName: string,
  email: string,
  password = "a-strong-test-passphrase",
): Promise<{
  cookies: AuthCookies;
  user: { id: string };
  claimedLegacyWorkspace: boolean;
}> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { displayName, email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as {
    user: { id: string };
    claimedLegacyWorkspace: boolean;
  };
  return {
    cookies: cookiesFrom(response),
    user: body.user,
    claimedLegacyWorkspace: body.claimedLegacyWorkspace,
  };
}

beforeEach(async () => {
  cleanupDirectory = mkdtempSync(join(tmpdir(), "focusai-api-"));
  database = new FocusDatabase(join(cleanupDirectory, "focusai.db"));
  app = await buildApp({ database });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  database.close();
  rmSync(cleanupDirectory, { recursive: true, force: true });
});

describe("FocusAI authenticated API", () => {
  it("creates an HTTP-only session, requires CSRF for writes, and persists the core workflow", async () => {
    const unauthenticatedDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
    });
    expect(unauthenticatedDashboard.statusCode).toBe(401);

    const account = await register("Asha", "asha@example.com");
    const setCookies = account.cookies;
    expect(
      setCookies.raw.find((cookie) => cookie.startsWith("focusai_session=")),
    ).toContain("HttpOnly");

    const currentSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: authHeaders(setCookies, false),
    });
    expect(currentSession.statusCode).toBe(200);
    expect(
      (currentSession.json() as { user: { email: string } }).user.email,
    ).toBe("asha@example.com");

    const csrfRejected = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(setCookies, false),
      payload: { title: "Should not be written" },
    });
    expect(csrfRejected.statusCode).toBe(403);
    expect(csrfRejected.json()).toMatchObject({
      error: { code: "CSRF_REJECTED" },
    });

    const createTask = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(setCookies),
      payload: {
        title: "Prepare the release brief",
        priority: "high",
        impact: 5,
        estimateMinutes: 30,
        cognitiveLoad: "medium",
      },
    });
    expect(createTask.statusCode).toBe(201);
    const task = createTask.json() as { id: string; title: string };
    expect(task.title).toBe("Prepare the release brief");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(setCookies, false),
    });
    expect(dashboard.statusCode).toBe(200);
    expect(
      (dashboard.json() as { topPriorities: Array<{ task: { id: string } }> })
        .topPriorities[0]?.task.id,
    ).toBe(task.id);

    const generatedPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(setCookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T08:00:00.000Z",
        availability: [
          {
            startAt: "2026-10-12T09:00:00.000Z",
            endAt: "2026-10-12T10:00:00.000Z",
          },
        ],
      },
    });
    expect(generatedPlan.statusCode).toBe(201);
    const plan = generatedPlan.json() as {
      id: string;
      blocks: Array<{ taskId: string; startAt: string; endAt: string }>;
    };
    expect(plan.blocks).toEqual([
      expect.objectContaining({
        taskId: task.id,
        startAt: "2026-10-12T09:00:00.000Z",
        endAt: "2026-10-12T09:30:00.000Z",
      }),
    ]);

    const acceptedPlan = await app.inject({
      method: "POST",
      url: `/api/v1/plans/${plan.id}/accept`,
      headers: authHeaders(setCookies),
    });
    expect(acceptedPlan.statusCode).toBe(200);
    expect((acceptedPlan.json() as { status: string }).status).toBe("accepted");

    const recoveryPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(setCookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T16:00:00.000Z",
        recovery: true,
      },
    });
    expect(recoveryPlan.statusCode).toBe(201);
    const recovery = recoveryPlan.json() as {
      id: string;
      type: string;
      capacityMinutes: number;
    };
    expect(recovery).toMatchObject({ type: "recovery", capacityMinutes: 120 });

    const latestPlan = await app.inject({
      method: "GET",
      url: "/api/v1/plans?planDate=2026-10-12",
      headers: authHeaders(setCookies, false),
    });
    expect(
      (latestPlan.json() as { plan: { id: string; status: string } }).plan,
    ).toMatchObject({ id: recovery.id, status: "draft" });

    const startFocus = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: authHeaders(setCookies),
      payload: { taskId: task.id, plannedMinutes: 25 },
    });
    expect(startFocus.statusCode).toBe(201);
    const session = startFocus.json() as { id: string; state: string };
    expect(session.state).toBe("active");

    const secondStart = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: authHeaders(setCookies),
      payload: { taskId: task.id, plannedMinutes: 25 },
    });
    expect(secondStart.statusCode).toBe(409);

    const pause = await app.inject({
      method: "POST",
      url: `/api/v1/focus-sessions/${session.id}/transition`,
      headers: authHeaders(setCookies),
      payload: { action: "pause" },
    });
    expect(pause.statusCode).toBe(200);
    expect((pause.json() as { state: string }).state).toBe("paused");

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/focus-sessions/${session.id}/transition`,
      headers: authHeaders(setCookies),
      payload: { action: "complete" },
    });
    expect(complete.statusCode).toBe(200);
    expect(
      (complete.json() as { state: string; completedAt: string | null })
        .completedAt,
    ).toBeTruthy();

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authHeaders(setCookies),
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(setCookies, false),
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("isolates users by ownership and rotates opaque session tokens", async () => {
    const asha = await register("Asha", "asha@example.com");
    const ren = await register("Ren", "ren@example.com");

    const ashaTask = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: { title: "Asha private task", estimateMinutes: 25 },
    });
    const taskId = (ashaTask.json() as { id: string }).id;

    const renTasks = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authHeaders(ren.cookies, false),
    });
    expect(renTasks.statusCode).toBe(200);
    expect((renTasks.json() as { items: unknown[] }).items).toEqual([]);

    const renCannotComplete = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: authHeaders(ren.cookies),
      payload: {},
    });
    expect(renCannotComplete.statusCode).toBe(404);

    const rotated = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session/rotate",
      headers: authHeaders(asha.cookies),
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedCookies = cookiesFrom(rotated);
    expect(rotatedCookies.session).not.toBe(asha.cookies.session);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies, false),
    });
    expect(oldSession.statusCode).toBe(401);
    const newSession = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authHeaders(rotatedCookies, false),
    });
    expect(
      (newSession.json() as { items: Array<{ id: string }> }).items,
    ).toEqual([expect.objectContaining({ id: taskId })]);
  });

  it("claims v1 local workspace records only for the first secured registration", async () => {
    const now = new Date().toISOString();
    database.run(
      `INSERT INTO users(id, email, display_name, password_hash, is_active, last_login_at, created_at, updated_at)
       VALUES ('local-development-user', 'local@focusai.invalid', 'FocusAI local workspace', NULL, 1, NULL, ?, ?)`,
      [now, now],
    );
    database.run(
      `INSERT INTO user_preferences(user_id, timezone, working_day_start, working_day_end, transition_minutes, high_cognitive_recovery_cap, created_at, updated_at)
       VALUES ('local-development-user', 'UTC', '09:00', '18:00', 10, 0.2, ?, ?)`,
      [now, now],
    );
    database.run(
      `INSERT INTO tasks(id, user_id, title, status, priority, impact, estimate_minutes, actual_minutes, cognitive_load, goal_alignment, blocked, created_at, updated_at)
       VALUES ('legacy-task', 'local-development-user', 'Preserved local task', 'todo', 'medium', 3, 25, 0, 'medium', 0, 0, ?, ?)`,
      [now, now],
    );

    const account = await register("Maya", "maya@example.com");
    expect(account.claimedLegacyWorkspace).toBe(true);
    const registration = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: authHeaders(account.cookies, false),
    });
    expect(registration.statusCode).toBe(200);
    const tasks = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authHeaders(account.cookies, false),
    });
    expect((tasks.json() as { items: Array<{ title: string }> }).items).toEqual(
      [expect.objectContaining({ title: "Preserved local task" })],
    );
    expect(
      database.get<{ id: string }>("SELECT id FROM users WHERE id = ?", [
        "local-development-user",
      ]),
    ).toBeUndefined();
  });

  it("upgrades a v1 database without resetting preserved records", () => {
    const migrationPath = join(cleanupDirectory, "v1-workspace.db");
    const v1 = new DatabaseSync(migrationPath);
    const firstMigration = migrations[0];
    if (!firstMigration) throw new Error("Expected the v1 migration.");
    v1.exec(firstMigration.sql);
    const now = new Date().toISOString();
    v1.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
    ).run(1, now);
    v1.prepare(
      "INSERT INTO users(id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("legacy-user", "legacy@example.com", "Legacy", now, now);
    v1.close();

    const upgraded = new FocusDatabase(migrationPath);
    expect(
      upgraded.get<{ version: number }>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      ),
    ).toEqual({ version: 2 });
    expect(
      upgraded.get<{ email: string; password_hash: string | null }>(
        "SELECT email, password_hash FROM users WHERE id = ?",
        ["legacy-user"],
      ),
    ).toEqual({
      email: "legacy@example.com",
      password_hash: null,
    });
    upgraded.close();
  });

  it("rejects malformed registration input with a consistent validation response", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { displayName: "", email: "not-an-email", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
