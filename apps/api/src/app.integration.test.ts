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

  it("lets an owner review and save a feasible draft schedule without rewriting accepted history", async () => {
    const asha = await register("Asha", "asha@example.com");
    const ren = await register("Ren", "ren@example.com");

    const prerequisiteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Schedule prerequisite",
        priority: "critical",
        impact: 5,
        estimateMinutes: 20,
      },
    });
    const prerequisite = prerequisiteResponse.json() as { id: string };
    const dependentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Schedule dependent",
        priority: "high",
        impact: 4,
        estimateMinutes: 20,
        dependencies: [prerequisite.id],
      },
    });
    const dependent = dependentResponse.json() as { id: string };
    const independentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Schedule independent",
        priority: "medium",
        estimateMinutes: 20,
      },
    });
    const independent = independentResponse.json() as { id: string };

    const generated = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T08:00:00.000Z",
        availability: [
          {
            startAt: "2026-10-12T09:00:00.000Z",
            endAt: "2026-10-12T11:00:00.000Z",
          },
        ],
      },
    });
    expect(generated.statusCode).toBe(201);
    const draft = generated.json() as {
      id: string;
      canEditSchedule: boolean;
      scheduleEditedAt: string | null;
      blocks: Array<{
        id: string;
        taskId: string;
        startAt: string;
        startLocal: string;
      }>;
    };
    expect(draft.canEditSchedule).toBe(true);
    expect(draft.scheduleEditedAt).toBeNull();
    expect(draft.blocks).toHaveLength(3);
    const blockForTask = new Map(
      draft.blocks.map((block) => [block.taskId, block]),
    );
    const prerequisiteBlock = blockForTask.get(prerequisite.id);
    const dependentBlock = blockForTask.get(dependent.id);
    const independentBlock = blockForTask.get(independent.id);
    if (!prerequisiteBlock || !dependentBlock || !independentBlock) {
      throw new Error("Expected all planned task blocks.");
    }

    const reviewedPositions = [
      { id: prerequisiteBlock.id, startLocal: "2026-10-12T09:00" },
      { id: independentBlock.id, startLocal: "2026-10-12T09:30" },
      { id: dependentBlock.id, startLocal: "2026-10-12T10:00" },
    ];
    const renCannotMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(ren.cookies),
      payload: { blocks: reviewedPositions },
    });
    expect(renCannotMove.statusCode).toBe(404);

    const incompleteSchedule = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: { blocks: reviewedPositions.slice(0, 1) },
    });
    expect(incompleteSchedule.statusCode).toBe(409);

    const saved = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: { blocks: reviewedPositions },
    });
    expect(saved.statusCode).toBe(200);
    const savedDraft = saved.json() as {
      scheduleEditedAt: string | null;
      blocks: Array<{ taskId: string; startAt: string; startLocal: string }>;
    };
    expect(savedDraft.scheduleEditedAt).toBeTruthy();
    expect(savedDraft.blocks.map((block) => block.taskId)).toEqual([
      prerequisite.id,
      independent.id,
      dependent.id,
    ]);
    expect(savedDraft.blocks.map((block) => block.startLocal)).toEqual([
      "2026-10-12T09:00",
      "2026-10-12T09:30",
      "2026-10-12T10:00",
    ]);

    const changedPreferences = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies),
      payload: { transitionMinutes: 15 },
    });
    expect(changedPreferences.statusCode).toBe(200);
    const preferenceChangedPlan = await app.inject({
      method: "GET",
      url: "/api/v1/plans?planDate=2026-10-12",
      headers: authHeaders(asha.cookies, false),
    });
    expect(
      (preferenceChangedPlan.json() as { plan: { canEditSchedule: boolean } })
        .plan.canEditSchedule,
    ).toBe(false);
    const preferenceChangedCannotMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: { blocks: reviewedPositions },
    });
    expect(preferenceChangedCannotMove.statusCode).toBe(409);
    const restoredPreferences = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies),
      payload: { transitionMinutes: 10 },
    });
    expect(restoredPreferences.statusCode).toBe(200);

    const dependencyViolation = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: {
        blocks: [
          { id: dependentBlock.id, startLocal: "2026-10-12T09:00" },
          { id: prerequisiteBlock.id, startLocal: "2026-10-12T09:30" },
          { id: independentBlock.id, startLocal: "2026-10-12T10:00" },
        ],
      },
    });
    expect(dependencyViolation.statusCode).toBe(409);

    const currentPlan = await app.inject({
      method: "GET",
      url: "/api/v1/plans?planDate=2026-10-12",
      headers: authHeaders(asha.cookies, false),
    });
    expect(
      (
        currentPlan.json() as {
          plan: { blocks: Array<{ taskId: string; startLocal: string }> };
        }
      ).plan.blocks.map((block) => block.taskId),
    ).toEqual([prerequisite.id, independent.id, dependent.id]);

    const commitment = await app.inject({
      method: "POST",
      url: "/api/v1/calendar-events",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Late fixed review",
        startLocal: "2026-10-12T10:30",
        endLocal: "2026-10-12T11:00",
        isFixed: true,
      },
    });
    expect(commitment.statusCode).toBe(201);
    const commitmentViolation = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: {
        blocks: [
          { id: prerequisiteBlock.id, startLocal: "2026-10-12T09:00" },
          { id: independentBlock.id, startLocal: "2026-10-12T10:00" },
          { id: dependentBlock.id, startLocal: "2026-10-12T10:30" },
        ],
      },
    });
    expect(commitmentViolation.statusCode).toBe(409);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/plans/${draft.id}/accept`,
      headers: authHeaders(asha.cookies),
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedCannotMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${draft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: { blocks: reviewedPositions },
    });
    expect(acceptedCannotMove.statusCode).toBe(409);
  });

  it("edits tasks and only creates reviewed breakdown steps that planners can act on", async () => {
    const asha = await register("Asha", "asha@example.com");
    const ren = await register("Ren", "ren@example.com");

    const prerequisiteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Confirm release scope",
        priority: "medium",
        estimateMinutes: 20,
      },
    });
    expect(prerequisiteResponse.statusCode).toBe(201);
    const prerequisite = prerequisiteResponse.json() as { id: string };

    const parentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: { title: "Prepare release", estimateMinutes: 90 },
    });
    expect(parentResponse.statusCode).toBe(201);
    const parent = parentResponse.json() as { id: string };

    const editedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${parent.id}`,
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Prepare the release",
        description: "Coordinate the final customer-facing release work.",
        status: "in_progress",
        priority: "critical",
        impact: 5,
        estimateMinutes: 90,
        actualMinutes: 15,
        dueAt: "2026-10-15T12:00:00.000Z",
        cognitiveLoad: "high",
        goalAlignment: 0.9,
        blocked: true,
        dependencies: [prerequisite.id],
      },
    });
    expect(editedResponse.statusCode).toBe(200);
    expect(editedResponse.json()).toMatchObject({
      title: "Prepare the release",
      description: "Coordinate the final customer-facing release work.",
      status: "in_progress",
      priority: "critical",
      impact: 5,
      estimateMinutes: 90,
      actualMinutes: 15,
      dueAt: "2026-10-15T12:00:00.000Z",
      cognitiveLoad: "high",
      goalAlignment: 0.9,
      blocked: true,
      dependencies: [prerequisite.id],
      parentTaskId: null,
      isDecomposed: false,
    });

    const renCannotRead = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${parent.id}`,
      headers: authHeaders(ren.cookies, false),
    });
    expect(renCannotRead.statusCode).toBe(404);

    const renCannotDecompose = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${parent.id}/decompose`,
      headers: authHeaders(ren.cookies),
      payload: { steps: [{ title: "Private step", estimateMinutes: 20 }] },
    });
    expect(renCannotDecompose.statusCode).toBe(404);

    const confirmedBreakdown = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${parent.id}/decompose`,
      headers: authHeaders(asha.cookies),
      payload: {
        steps: [
          { title: "Draft release notes", estimateMinutes: 20 },
          { title: "Review the launch checklist", estimateMinutes: 25 },
        ],
      },
    });
    expect(confirmedBreakdown.statusCode).toBe(201);
    const breakdown = confirmedBreakdown.json() as {
      parent: { id: string; isDecomposed: boolean; dependencies: string[] };
      steps: Array<{
        id: string;
        title: string;
        parentTaskId: string | null;
        estimateMinutes: number;
        priority: string;
        blocked: boolean;
        dependencies: string[];
      }>;
    };
    expect(breakdown.parent).toMatchObject({
      id: parent.id,
      isDecomposed: true,
      dependencies: [prerequisite.id],
    });
    expect(breakdown.steps).toEqual([
      expect.objectContaining({
        title: "Draft release notes",
        parentTaskId: parent.id,
        estimateMinutes: 20,
        priority: "medium",
        blocked: false,
        dependencies: [],
      }),
      expect.objectContaining({
        title: "Review the launch checklist",
        parentTaskId: parent.id,
        estimateMinutes: 25,
        priority: "medium",
        blocked: false,
        dependencies: [],
      }),
    ]);

    const parentCannotFocus = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: authHeaders(asha.cookies),
      payload: { taskId: parent.id, plannedMinutes: 25 },
    });
    expect(parentCannotFocus.statusCode).toBe(409);

    const parentCannotCompleteEarly = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${parent.id}/complete`,
      headers: authHeaders(asha.cookies),
      payload: {},
    });
    expect(parentCannotCompleteEarly.statusCode).toBe(409);

    const planResponse = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T08:00:00.000Z",
        availability: [
          {
            startAt: "2026-10-12T09:00:00.000Z",
            endAt: "2026-10-12T10:30:00.000Z",
          },
        ],
      },
    });
    expect(planResponse.statusCode).toBe(201);
    const plannedTaskIds = (
      planResponse.json() as { blocks: Array<{ taskId: string | null }> }
    ).blocks.map((block) => block.taskId);
    expect(plannedTaskIds).not.toContain(parent.id);
    expect(plannedTaskIds).toEqual(
      expect.arrayContaining(breakdown.steps.map((step) => step.id)),
    );

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(dashboard.statusCode).toBe(200);
    const dashboardPayload = dashboard.json() as {
      nextAction: { task: { id: string } } | null;
      topPriorities: Array<{ task: { id: string } }>;
    };
    expect(dashboardPayload.nextAction?.task.id).not.toBe(parent.id);
    expect(
      dashboardPayload.topPriorities.map((item) => item.task.id),
    ).not.toContain(parent.id);

    const taskAResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: { title: "Dependency A", estimateMinutes: 10 },
    });
    const taskBResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: { title: "Dependency B", estimateMinutes: 10 },
    });
    const taskA = taskAResponse.json() as { id: string };
    const taskB = taskBResponse.json() as { id: string };
    const firstDependency = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskA.id}`,
      headers: authHeaders(asha.cookies),
      payload: { dependencies: [taskB.id] },
    });
    expect(firstDependency.statusCode).toBe(200);
    const cyclicDependency = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskB.id}`,
      headers: authHeaders(asha.cookies),
      payload: { dependencies: [taskA.id] },
    });
    expect(cyclicDependency.statusCode).toBe(409);

    const deleteContainer = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${parent.id}`,
      headers: authHeaders(asha.cookies),
    });
    expect(deleteContainer.statusCode).toBe(204);
    const remainingTasks = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies, false),
    });
    expect(remainingTasks.statusCode).toBe(200);
    const remainingSteps = (
      remainingTasks.json() as {
        items: Array<{ id: string; parentTaskId: string | null }>;
      }
    ).items.filter((item) =>
      breakdown.steps.some((step) => step.id === item.id),
    );
    expect(remainingSteps).toHaveLength(breakdown.steps.length);
    expect(remainingSteps).toEqual(
      expect.arrayContaining(
        breakdown.steps.map((step) =>
          expect.objectContaining({ id: step.id, parentTaskId: null }),
        ),
      ),
    );
  });

  it("keeps projects, goals, milestones, and task links user-owned and lifecycle-safe", async () => {
    const asha = await register("Asha", "asha@example.com");
    const ren = await register("Ren", "ren@example.com");

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "First release",
        description: "A real project grouping.",
        targetDate: "2026-11-01",
      },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json() as { id: string; status: string };
    expect(project).toMatchObject({ status: "active" });

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: authHeaders(asha.cookies),
      payload: {
        projectId: project.id,
        title: "Release a usable workflow",
        description: "The stored outcome is deliberate, not inferred.",
        targetDate: "2026-10-30",
      },
    });
    expect(goalResponse.statusCode).toBe(201);
    const goal = goalResponse.json() as {
      id: string;
      projectId: string | null;
      projectTitle: string | null;
      status: string;
      progress: { totalTasks: number; totalMilestones: number };
    };
    expect(goal).toMatchObject({
      projectId: project.id,
      projectTitle: "First release",
      status: "active",
      progress: { totalTasks: 0, totalMilestones: 0 },
    });

    const projectDetail = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(projectDetail.statusCode).toBe(200);
    expect(projectDetail.json()).toMatchObject({
      progress: { totalGoals: 1, completedGoals: 0, activeGoals: 1 },
    });

    const renCannotReadProject = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(ren.cookies, false),
    });
    expect(renCannotReadProject.statusCode).toBe(404);
    const renCannotAttachToAshaProject = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: authHeaders(ren.cookies),
      payload: { title: "Not Ren's project", projectId: project.id },
    });
    expect(renCannotAttachToAshaProject.statusCode).toBe(404);

    const linkedTaskResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Ship the first usable flow",
        estimateMinutes: 45,
        goalAlignment: 0.37,
        goalId: goal.id,
      },
    });
    expect(linkedTaskResponse.statusCode).toBe(201);
    const linkedTask = linkedTaskResponse.json() as {
      id: string;
      goalId: string | null;
      goalTitle: string | null;
      goalAlignment: number;
    };
    expect(linkedTask).toMatchObject({
      goalId: goal.id,
      goalTitle: "Release a usable workflow",
      goalAlignment: 0.37,
    });

    const goalTaskList = await app.inject({
      method: "GET",
      url: `/api/v1/tasks?goalId=${goal.id}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(goalTaskList.statusCode).toBe(200);
    expect(
      (goalTaskList.json() as { items: Array<{ id: string }> }).items,
    ).toEqual([expect.objectContaining({ id: linkedTask.id })]);

    const renCannotLinkToAshaGoal = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(ren.cookies),
      payload: { title: "Private link attempt", goalId: goal.id },
    });
    expect(renCannotLinkToAshaGoal.statusCode).toBe(404);

    const milestoneResponse = await app.inject({
      method: "POST",
      url: `/api/v1/goals/${goal.id}/milestones`,
      headers: authHeaders(asha.cookies),
      payload: { title: "Review the release flow", targetDate: "2026-10-25" },
    });
    expect(milestoneResponse.statusCode).toBe(201);
    const milestone = milestoneResponse.json() as {
      id: string;
      status: string;
      goalId: string;
    };
    expect(milestone).toMatchObject({ goalId: goal.id, status: "pending" });

    const renCannotUpdateMilestone = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}/milestones/${milestone.id}`,
      headers: authHeaders(ren.cookies),
      payload: { status: "completed" },
    });
    expect(renCannotUpdateMilestone.statusCode).toBe(404);

    const incompleteGoal = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "completed" },
    });
    expect(incompleteGoal.statusCode).toBe(409);

    const completeTask = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${linkedTask.id}/complete`,
      headers: authHeaders(asha.cookies),
      payload: { actualMinutes: 42 },
    });
    expect(completeTask.statusCode).toBe(200);

    const pendingMilestoneGoal = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "completed" },
    });
    expect(pendingMilestoneGoal.statusCode).toBe(409);

    const completeMilestone = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}/milestones/${milestone.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "completed" },
    });
    expect(completeMilestone.statusCode).toBe(200);
    expect(
      (completeMilestone.json() as { completedAt: string | null }).completedAt,
    ).toBeTruthy();

    const completeGoal = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "completed" },
    });
    expect(completeGoal.statusCode).toBe(200);
    expect(completeGoal.json()).toMatchObject({
      status: "completed",
      progress: {
        totalTasks: 1,
        completedTasks: 1,
        totalMilestones: 1,
        completedMilestones: 1,
      },
    });

    const noNewWorkOnCompletedGoal = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: { title: "Late scope", goalId: goal.id },
    });
    expect(noNewWorkOnCompletedGoal.statusCode).toBe(409);
    const noReopenOnCompletedGoal = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${linkedTask.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "todo" },
    });
    expect(noReopenOnCompletedGoal.statusCode).toBe(409);

    const activeBreakdownGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: authHeaders(asha.cookies),
      payload: { title: "Review a linked breakdown" },
    });
    expect(activeBreakdownGoalResponse.statusCode).toBe(201);
    const activeBreakdownGoal = activeBreakdownGoalResponse.json() as {
      id: string;
    };
    const parentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Prepare an explicitly linked breakdown",
        goalId: activeBreakdownGoal.id,
        goalAlignment: 0.2,
      },
    });
    expect(parentResponse.statusCode).toBe(201);
    const parent = parentResponse.json() as {
      id: string;
      goalId: string | null;
    };
    const breakdownResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${parent.id}/decompose`,
      headers: authHeaders(asha.cookies),
      payload: {
        steps: [
          {
            title: "Reviewed child work",
            estimateMinutes: 15,
            goalId: null,
            goalAlignment: 0.9,
          },
        ],
      },
    });
    expect(breakdownResponse.statusCode).toBe(201);
    const breakdown = breakdownResponse.json() as {
      steps: Array<{
        id: string;
        goalId: string | null;
        goalAlignment: number;
      }>;
    };
    expect(breakdown.steps).toEqual([
      expect.objectContaining({
        goalId: activeBreakdownGoal.id,
        goalAlignment: 0.9,
      }),
    ]);

    const archivedProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authHeaders(asha.cookies),
      payload: { title: "Archived context" },
    });
    const archivedProject = archivedProjectResponse.json() as { id: string };
    const archiveProject = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${archivedProject.id}`,
      headers: authHeaders(asha.cookies),
      payload: { status: "archived" },
    });
    expect(archiveProject.statusCode).toBe(200);
    const noGoalOnArchivedProject = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: authHeaders(asha.cookies),
      payload: { title: "Blocked grouping", projectId: archivedProject.id },
    });
    expect(noGoalOnArchivedProject.statusCode).toBe(409);

    const deleteProject = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(asha.cookies),
    });
    expect(deleteProject.statusCode).toBe(204);
    const releasedGoal = await app.inject({
      method: "GET",
      url: `/api/v1/goals/${goal.id}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(releasedGoal.statusCode).toBe(200);
    expect(releasedGoal.json()).toMatchObject({
      projectId: null,
      projectTitle: null,
    });

    const deleteGoal = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${goal.id}`,
      headers: authHeaders(asha.cookies),
    });
    expect(deleteGoal.statusCode).toBe(204);
    const releasedTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${linkedTask.id}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(releasedTask.statusCode).toBe(200);
    expect(releasedTask.json()).toMatchObject({
      goalId: null,
      goalTitle: null,
    });
    expect(
      database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM milestones WHERE goal_id = ?",
        [goal.id],
      ),
    ).toEqual({ count: 0 });
  });

  it("uses IANA preferences and user-owned fixed commitments in plans", async () => {
    const asha = await register("Asha", "asha@example.com");

    const defaults = await app.inject({
      method: "GET",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies, false),
    });
    expect(defaults.statusCode).toBe(200);
    expect((defaults.json() as { timezone: string }).timezone).toBe("UTC");

    const missingCsrf = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies, false),
      payload: { timezone: "Africa/Nairobi" },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const preferences = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies),
      payload: {
        timezone: "Africa/Nairobi",
        workingDayStart: "09:00",
        workingDayEnd: "12:00",
        transitionMinutes: 0,
        highCognitiveRecoveryCap: 0.35,
      },
    });
    expect(preferences.statusCode).toBe(200);
    expect(preferences.json()).toMatchObject({
      timezone: "Africa/Nairobi",
      workingDayStart: "09:00",
      workingDayEnd: "12:00",
      transitionMinutes: 0,
      highCognitiveRecoveryCap: 0.35,
    });

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar-events",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Client check-in",
        startLocal: "2026-10-12T10:00",
        endLocal: "2026-10-12T11:00",
        isFixed: true,
      },
    });
    expect(eventResponse.statusCode).toBe(201);
    const event = eventResponse.json() as {
      id: string;
      startAt: string;
      endAt: string;
      startLocal: string;
      isFixed: boolean;
    };
    expect(event).toMatchObject({
      startAt: "2026-10-12T07:00:00Z",
      endAt: "2026-10-12T08:00:00Z",
      startLocal: "2026-10-12T10:00",
      isFixed: true,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/calendar-events?startDate=2026-10-12&endDate=2026-10-12",
      headers: authHeaders(asha.cookies, false),
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: Array<{ id: string }> }).items).toEqual([
      expect.objectContaining({ id: event.id }),
    ]);

    const privateTask = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Prepare check-in notes",
        estimateMinutes: 60,
        priority: "high",
      },
    });
    expect(privateTask.statusCode).toBe(201);

    const protectedPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T05:00:00.000Z",
      },
    });
    expect(protectedPlan.statusCode).toBe(201);
    const fixedPlan = protectedPlan.json() as {
      capacityMinutes: number;
      blocks: Array<{ startAt: string; endAt: string }>;
    };
    expect(fixedPlan.capacityMinutes).toBe(120);
    expect(fixedPlan.blocks).toEqual([
      expect.objectContaining({
        startAt: "2026-10-12T06:00:00.000Z",
        endAt: "2026-10-12T07:00:00.000Z",
      }),
    ]);

    const ren = await register("Ren", "ren@example.com");
    const renCannotUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar-events/${event.id}`,
      headers: authHeaders(ren.cookies),
      payload: { title: "Not Ren's event" },
    });
    expect(renCannotUpdate.statusCode).toBe(404);

    const unprotected = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar-events/${event.id}`,
      headers: authHeaders(asha.cookies),
      payload: { isFixed: false },
    });
    expect(unprotected.statusCode).toBe(200);
    expect((unprotected.json() as { isFixed: boolean }).isFixed).toBe(false);

    const flexiblePlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate: "2026-10-12",
        readiness: "steady",
        now: "2026-10-12T05:00:00.000Z",
      },
    });
    expect(flexiblePlan.statusCode).toBe(201);
    expect(
      (flexiblePlan.json() as { capacityMinutes: number }).capacityMinutes,
    ).toBe(180);

    const setNewYork = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies),
      payload: { timezone: "America/New_York" },
    });
    expect(setNewYork.statusCode).toBe(200);
    const sameInstantAfterZoneChange = await app.inject({
      method: "GET",
      url: "/api/v1/calendar-events?startDate=2026-10-12&endDate=2026-10-12",
      headers: authHeaders(asha.cookies, false),
    });
    expect(
      (
        sameInstantAfterZoneChange.json() as {
          items: Array<{ startAt: string; startLocal: string }>;
        }
      ).items,
    ).toEqual([
      expect.objectContaining({
        startAt: "2026-10-12T07:00:00Z",
        startLocal: "2026-10-12T03:00",
      }),
    ]);

    const daylightSavingGap = await app.inject({
      method: "POST",
      url: "/api/v1/calendar-events",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Impossible local time",
        startLocal: "2026-03-08T02:30",
        endLocal: "2026-03-08T03:30",
      },
    });
    expect(daylightSavingGap.statusCode).toBe(409);

    const daylightSavingPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate: "2026-03-08",
        readiness: "steady",
        now: "2026-03-08T12:00:00.000Z",
        availability: [
          {
            startAt: "2026-03-08T13:00:00.000Z",
            endAt: "2026-03-08T15:00:00.000Z",
          },
        ],
      },
    });
    expect(daylightSavingPlan.statusCode).toBe(201);
    const daylightSavingDraft = daylightSavingPlan.json() as {
      id: string;
      canEditSchedule: boolean;
      blocks: Array<{ id: string }>;
    };
    expect(daylightSavingDraft.canEditSchedule).toBe(true);
    const [daylightSavingBlock] = daylightSavingDraft.blocks;
    if (!daylightSavingBlock)
      throw new Error("Expected an editable daylight-saving plan block.");
    const daylightSavingSchedule = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${daylightSavingDraft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: {
        blocks: [
          { id: daylightSavingBlock.id, startLocal: "2026-03-08T02:30" },
        ],
      },
    });
    expect(daylightSavingSchedule.statusCode).toBe(409);
    const daylightSavingAmbiguity = await app.inject({
      method: "PATCH",
      url: `/api/v1/plans/${daylightSavingDraft.id}/blocks`,
      headers: authHeaders(asha.cookies),
      payload: {
        blocks: [
          { id: daylightSavingBlock.id, startLocal: "2026-11-01T01:30" },
        ],
      },
    });
    expect(daylightSavingAmbiguity.statusCode).toBe(409);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar-events/${event.id}`,
      headers: authHeaders(asha.cookies),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("offers a non-punitive recovery signal for a current passed block without rewriting work", async () => {
    const asha = await register("Asha", "asha@example.com");
    const referenceTime = Date.now();
    const planDate = new Date(referenceTime).toISOString().slice(0, 10);
    const availabilityStart = new Date(
      referenceTime - 20 * 60_000,
    ).toISOString();
    const availabilityEnd = new Date(referenceTime - 5 * 60_000).toISOString();
    const generationNow = new Date(referenceTime - 25 * 60_000).toISOString();

    const preferenceResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences",
      headers: authHeaders(asha.cookies),
      payload: { timezone: "UTC", transitionMinutes: 0 },
    });
    expect(preferenceResponse.statusCode).toBe(200);

    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authHeaders(asha.cookies),
      payload: {
        title: "Reconsider the release outline",
        estimateMinutes: 5,
        priority: "high",
        impact: 4,
      },
    });
    expect(taskResponse.statusCode).toBe(201);
    const task = taskResponse.json() as { id: string };

    const planResponse = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate,
        readiness: "steady",
        now: generationNow,
        availability: [{ startAt: availabilityStart, endAt: availabilityEnd }],
      },
    });
    expect(planResponse.statusCode).toBe(201);
    const plan = planResponse.json() as { id: string; type: string };
    expect(plan.type).toBe("daily");

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(
      (
        dashboardResponse.json() as {
          recoverySignal: {
            planId: string;
            planDate: string;
            totalMinutes: number;
            blocks: Array<{ taskId: string; title: string }>;
          } | null;
        }
      ).recoverySignal,
    ).toEqual({
      planId: plan.id,
      planDate,
      totalMinutes: 5,
      blocks: [
        expect.objectContaining({
          taskId: task.id,
          title: "Reconsider the release outline",
        }),
      ],
    });

    const unchangedPlan = await app.inject({
      method: "GET",
      url: `/api/v1/plans?planDate=${planDate}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(unchangedPlan.statusCode).toBe(200);
    expect((unchangedPlan.json() as { plan: unknown }).plan).toMatchObject({
      id: plan.id,
      status: "draft",
      type: "daily",
    });
    const unchangedTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${task.id}`,
      headers: authHeaders(asha.cookies, false),
    });
    expect(unchangedTask.statusCode).toBe(200);
    expect(unchangedTask.json()).toMatchObject({
      status: "todo",
      completedAt: null,
    });

    const activeFocus = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: authHeaders(asha.cookies),
      payload: { taskId: task.id, plannedMinutes: 5 },
    });
    expect(activeFocus.statusCode).toBe(201);
    const activeDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(activeDashboard.statusCode).toBe(200);
    expect(
      (activeDashboard.json() as { recoverySignal: unknown }).recoverySignal,
    ).toBeNull();
    const focusedSession = activeFocus.json() as { id: string };
    const stoppedFocus = await app.inject({
      method: "POST",
      url: `/api/v1/focus-sessions/${focusedSession.id}/transition`,
      headers: authHeaders(asha.cookies),
      payload: { action: "stop" },
    });
    expect(stoppedFocus.statusCode).toBe(200);

    const recoveryPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate,
        readiness: "steady",
        recovery: true,
        now: new Date(referenceTime).toISOString(),
        availability: [
          {
            startAt: new Date(referenceTime + 60_000).toISOString(),
            endAt: new Date(referenceTime + 6 * 60_000).toISOString(),
          },
        ],
      },
    });
    expect(recoveryPlan.statusCode).toBe(201);
    expect(recoveryPlan.json()).toMatchObject({ type: "recovery" });
    const recoveryDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(recoveryDashboard.statusCode).toBe(200);
    expect(
      (recoveryDashboard.json() as { recoverySignal: unknown }).recoverySignal,
    ).toBeNull();

    const refreshedDailyPlan = await app.inject({
      method: "POST",
      url: "/api/v1/plans/generate",
      headers: authHeaders(asha.cookies),
      payload: {
        planDate,
        readiness: "steady",
        now: generationNow,
        availability: [{ startAt: availabilityStart, endAt: availabilityEnd }],
      },
    });
    expect(refreshedDailyPlan.statusCode).toBe(201);
    expect(refreshedDailyPlan.json()).toMatchObject({ type: "daily" });
    const renewedDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(renewedDashboard.statusCode).toBe(200);
    expect(
      (renewedDashboard.json() as { recoverySignal: unknown }).recoverySignal,
    ).not.toBeNull();

    const completedTask = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${task.id}/complete`,
      headers: authHeaders(asha.cookies),
      payload: {},
    });
    expect(completedTask.statusCode).toBe(200);
    const resolvedDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: authHeaders(asha.cookies, false),
    });
    expect(resolvedDashboard.statusCode).toBe(200);
    expect(
      (resolvedDashboard.json() as { recoverySignal: unknown }).recoverySignal,
    ).toBeNull();
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
    v1.prepare(
      `INSERT INTO tasks(id, user_id, title, status, priority, impact, estimate_minutes, actual_minutes,
        cognitive_load, goal_alignment, blocked, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 'medium', 3, 30, 0, 'medium', 0, 0, ?, ?)`,
    ).run("legacy-task", "legacy-user", "Preserved task", now, now);
    v1.close();

    const upgraded = new FocusDatabase(migrationPath);
    expect(
      upgraded.get<{ version: number }>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      ),
    ).toEqual({ version: 4 });
    expect(
      upgraded.get<{
        parent_task_id: string | null;
        is_decomposed: number;
        goal_id: string | null;
      }>("SELECT parent_task_id, is_decomposed, goal_id FROM tasks LIMIT 1"),
    ).toEqual({ parent_task_id: null, is_decomposed: 0, goal_id: null });
    expect(
      upgraded.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goals'",
      ),
    ).toEqual({ name: "goals" });
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
