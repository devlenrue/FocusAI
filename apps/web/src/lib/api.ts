import type { Dashboard, FocusSession, Plan, Readiness, Task, TaskStatus } from './types';

const API_ROOT = '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string; requestId?: string } }
    | null;
  if (!response.ok) {
    const error = payload as { error?: { message?: string; requestId?: string } } | null;
    throw new ApiError(
      error?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error?.error?.requestId,
    );
  }
  return payload as T;
}

export const api = {
  getDashboard: () => request<Dashboard>('/dashboard'),
  getTasks: (filters?: { status?: TaskStatus; q?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.q) params.set('q', filters.q);
    const suffix = params.size ? `?${params.toString()}` : '';
    return request<{ items: Task[] }>(`/tasks${suffix}`);
  },
  createTask: (input: {
    title: string;
    description?: string | null;
    priority?: Task['priority'];
    impact?: number;
    estimateMinutes?: number;
    dueAt?: string | null;
    cognitiveLoad?: Task['cognitiveLoad'];
  }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  completeTask: (taskId: string, actualMinutes?: number) =>
    request<Task>(`/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({ actualMinutes }) }),
  deleteTask: (taskId: string) => request<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
  getPlan: (planDate: string) => request<{ plan: Plan | null }>(`/plans?planDate=${encodeURIComponent(planDate)}`),
  generatePlan: (input: { planDate: string; readiness: Readiness; recovery?: boolean; now?: string }) =>
    request<Plan>('/plans/generate', { method: 'POST', body: JSON.stringify(input) }),
  acceptPlan: (planId: string) => request<Plan>(`/plans/${planId}/accept`, { method: 'POST' }),
  getActiveFocus: () => request<{ session: FocusSession | null }>('/focus-sessions/active'),
  getFocusSessions: () => request<{ items: FocusSession[] }>('/focus-sessions'),
  startFocus: (input: { taskId: string | null; plannedMinutes: number; note?: string | null }) =>
    request<FocusSession>('/focus-sessions', { method: 'POST', body: JSON.stringify(input) }),
  transitionFocus: (sessionId: string, action: 'pause' | 'resume' | 'complete' | 'stop') =>
    request<FocusSession>(`/focus-sessions/${sessionId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
};
