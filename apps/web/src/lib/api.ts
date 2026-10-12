import type {
  AuthUser,
  CalendarEvent,
  Dashboard,
  FocusSession,
  Plan,
  Readiness,
  Task,
  TaskStatus,
  UserPreferences,
} from "./types";

const API_ROOT = "/api/v1";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("focusai_csrf="))
    ?.split("=")
    .slice(1)
    .join("=");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = UNSAFE_METHODS.has(method) ? csrfToken() : undefined;
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    method,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: string; message?: string; requestId?: string } }
    | null;
  if (!response.ok) {
    const error = payload as {
      error?: { code?: string; message?: string; requestId?: string };
    } | null;
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("focusai:session-expired"));
    throw new ApiError(
      error?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error?.error?.requestId,
      error?.error?.code,
    );
  }
  return payload as T;
}

export const api = {
  getSession: () => request<{ user: AuthUser }>("/auth/session"),
  register: (input: { displayName: string; email: string; password: string }) =>
    request<{ user: AuthUser; claimedLegacyWorkspace: boolean }>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  login: (input: { email: string; password: string }) =>
    request<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  rotateSession: () =>
    request<{ user: AuthUser; expiresAt: string }>("/auth/session/rotate", {
      method: "POST",
    }),
  revokeOtherSessions: () =>
    request<void>("/auth/sessions/revoke-others", { method: "POST" }),
  getPreferences: () => request<UserPreferences>("/preferences"),
  updatePreferences: (input: Partial<UserPreferences>) =>
    request<UserPreferences>("/preferences", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  getCalendarEvents: (input: { startDate: string; endDate: string }) =>
    request<{ items: CalendarEvent[] }>(
      `/calendar-events?${new URLSearchParams(input).toString()}`,
    ),
  createCalendarEvent: (input: {
    title: string;
    startLocal: string;
    endLocal: string;
    isFixed: boolean;
  }) =>
    request<CalendarEvent>("/calendar-events", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCalendarEvent: (
    eventId: string,
    input: Partial<{
      title: string;
      startLocal: string;
      endLocal: string;
      isFixed: boolean;
    }>,
  ) =>
    request<CalendarEvent>(`/calendar-events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCalendarEvent: (eventId: string) =>
    request<void>(`/calendar-events/${eventId}`, { method: "DELETE" }),
  getDashboard: () => request<Dashboard>("/dashboard"),
  getTasks: (filters?: { status?: TaskStatus; q?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.q) params.set("q", filters.q);
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<{ items: Task[] }>(`/tasks${suffix}`);
  },
  createTask: (input: {
    title: string;
    description?: string | null;
    priority?: Task["priority"];
    impact?: number;
    estimateMinutes?: number;
    dueAt?: string | null;
    cognitiveLoad?: Task["cognitiveLoad"];
  }) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(input) }),
  completeTask: (taskId: string, actualMinutes?: number) =>
    request<Task>(`/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ actualMinutes }),
    }),
  deleteTask: (taskId: string) =>
    request<void>(`/tasks/${taskId}`, { method: "DELETE" }),
  getPlan: (planDate: string) =>
    request<{ plan: Plan | null }>(
      `/plans?planDate=${encodeURIComponent(planDate)}`,
    ),
  generatePlan: (input: {
    planDate: string;
    readiness: Readiness;
    recovery?: boolean;
    now?: string;
  }) =>
    request<Plan>("/plans/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  acceptPlan: (planId: string) =>
    request<Plan>(`/plans/${planId}/accept`, { method: "POST" }),
  getActiveFocus: () =>
    request<{ session: FocusSession | null }>("/focus-sessions/active"),
  getFocusSessions: () => request<{ items: FocusSession[] }>("/focus-sessions"),
  startFocus: (input: {
    taskId: string | null;
    plannedMinutes: number;
    note?: string | null;
  }) =>
    request<FocusSession>("/focus-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  transitionFocus: (
    sessionId: string,
    action: "pause" | "resume" | "complete" | "stop",
  ) =>
    request<FocusSession>(`/focus-sessions/${sessionId}/transition`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
};
