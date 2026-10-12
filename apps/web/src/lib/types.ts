export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";
export type CognitiveLoad = "low" | "medium" | "high";
export type Readiness = "low" | "steady" | "high";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  impact: number;
  estimateMinutes: number;
  actualMinutes: number;
  dueAt: string | null;
  cognitiveLoad: CognitiveLoad;
  goalAlignment: number;
  blocked: boolean;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ScoreReason {
  code: string;
  message: string;
}

export interface Recommendation {
  task: {
    id: string;
    title: string;
    priority: Priority;
    impact: number;
    estimateMinutes: number;
    dueAt: string | null;
    goalAlignment: number;
    cognitiveLoad: CognitiveLoad;
    dependencies: string[];
    completed: boolean;
    blocked: boolean;
  };
  score: number;
  reasons: ScoreReason[];
}

export interface ScheduledBlock {
  id: string;
  taskId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  score: number;
}

export interface DeferredTask {
  taskId: string;
  title: string;
  reason: "blocked" | "dependency" | "capacity" | "recovery-cognitive-cap";
  detail: string;
}

export interface Plan {
  id: string;
  planDate: string;
  status: "draft" | "accepted" | "superseded";
  type: "daily" | "recovery";
  readiness: Readiness;
  generatedAt: string;
  acceptedAt: string | null;
  capacityMinutes: number;
  scheduledMinutes: number;
  topPriorities: Recommendation[];
  nextAction: Recommendation | null;
  deferred: DeferredTask[];
  feasibility: {
    availableMinutes: number;
    scheduledMinutes: number;
    unscheduledMinutes: number;
    isFeasible: boolean;
  };
  blocks: ScheduledBlock[];
  recovery?: {
    remainingCapacityMinutes: number;
    highCognitiveCapMinutes: number;
    highCognitiveScheduledMinutes: number;
    message: string;
  };
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  plannedMinutes: number;
  state: "active" | "paused" | "completed" | "stopped";
  startedAt: string;
  stateChangedAt: string;
  completedAt: string | null;
  accumulatedSeconds: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  date: string;
  topPriorities: Recommendation[];
  nextAction: Recommendation | null;
  tasks: {
    total: number;
    completed: number;
    active: number;
  };
  plan: Plan | null;
  focusSession: FocusSession | null;
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
}
