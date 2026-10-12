import { randomUUID } from "node:crypto";
import type {
  AvailabilityWindow,
  CognitiveLoad,
  DailyPlan as EngineDailyPlan,
  FixedCommitment,
  PlanningTask,
  Priority,
  Readiness,
  RecoveryPlan,
} from "@focusai/decision-engine";
import {
  generateDailyPlan,
  generateRecoveryPlan,
  rankTasks,
} from "@focusai/decision-engine";
import { FocusDatabase } from "../db/database.js";
import {
  LocalTimeResolutionError,
  localDateFromUtc,
  localDateTimeFromUtc,
  nextCalendarDate,
  utcFromLocalDateTime,
} from "./time.js";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";
export type ProjectStatus = "active" | "archived";
export type GoalStatus = "active" | "completed" | "archived";
export type MilestoneStatus = "pending" | "completed";

export interface TaskDto {
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
  /** A user-controlled planning signal; linking a goal does not rewrite it. */
  goalAlignment: number;
  /** Nullable user-owned goal relationship, independent of planner scoring. */
  goalId: string | null;
  goalTitle: string | null;
  blocked: boolean;
  /** A child task belongs to this explicit, user-confirmed breakdown parent. */
  parentTaskId: string | null;
  /** Breakdown parents are organizing work and are not scheduled directly. */
  isDecomposed: boolean;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TaskCreateInput = Omit<
  TaskDto,
  | "id"
  | "actualMinutes"
  | "goalTitle"
  | "parentTaskId"
  | "isDecomposed"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
>;

export type TaskUpdateInput = Partial<
  Omit<
    TaskDto,
    | "id"
    | "actualMinutes"
    | "goalTitle"
    | "parentTaskId"
    | "isDecomposed"
    | "createdAt"
    | "updatedAt"
    | "completedAt"
  >
> & {
  actualMinutes?: number;
};

export interface TaskDecompositionDto {
  parent: TaskDto;
  steps: TaskDto[];
}

export interface FocusSessionDto {
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

export interface PlanDto {
  id: string;
  planDate: string;
  status: "draft" | "accepted" | "superseded";
  type: "daily" | "recovery";
  readiness: Readiness;
  generatedAt: string;
  acceptedAt: string | null;
  capacityMinutes: number;
  scheduledMinutes: number;
  topPriorities: EngineDailyPlan["topPriorities"];
  nextAction: EngineDailyPlan["nextAction"];
  deferred: EngineDailyPlan["deferred"];
  feasibility: EngineDailyPlan["feasibility"];
  /** Only current daily drafts carrying a saved feasibility context are editable. */
  canEditSchedule: boolean;
  /** Records the latest explicit manual schedule save without altering plan generation history. */
  scheduleEditedAt: string | null;
  blocks: Array<{
    id: string;
    taskId: string | null;
    title: string;
    startAt: string;
    endAt: string;
    /** Wall-clock values in the requesting user's current preference time zone. */
    startLocal: string;
    endLocal: string;
    durationMinutes: number;
    score: number;
  }>;
  recovery?: RecoveryPlan["recovery"];
}

export interface UserPreferencesDto {
  timezone: string;
  workingDayStart: string;
  workingDayEnd: string;
  transitionMinutes: number;
  highCognitiveRecoveryCap: number;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  /** Wall-clock values in the requesting user's current preference time zone. */
  startLocal: string;
  endLocal: string;
  isFixed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventInput {
  title: string;
  startLocal: string;
  endLocal: string;
  isFixed: boolean;
}

export interface ProjectDto {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  progress: {
    totalGoals: number;
    completedGoals: number;
    activeGoals: number;
  };
}

export interface ProjectInput {
  title: string;
  description: string | null;
  status: ProjectStatus;
  targetDate: string | null;
}

export interface MilestoneDto {
  id: string;
  goalId: string;
  title: string;
  status: MilestoneStatus;
  targetDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneInput {
  title: string;
  status: MilestoneStatus;
  targetDate: string | null;
}

export interface GoalDto {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  targetDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: {
    totalTasks: number;
    completedTasks: number;
    totalMilestones: number;
    completedMilestones: number;
  };
  milestones: MilestoneDto[];
}

export interface GoalInput {
  projectId: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  targetDate: string | null;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  impact: number;
  estimate_minutes: number;
  actual_minutes: number;
  due_at: string | null;
  cognitive_load: CognitiveLoad;
  goal_alignment: number;
  goal_id: string | null;
  goal_title: string | null;
  blocked: number;
  parent_task_id: string | null;
  is_decomposed: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface FocusRow {
  id: string;
  task_id: string | null;
  task_title: string | null;
  planned_minutes: number;
  state: FocusSessionDto["state"];
  started_at: string;
  state_changed_at: string;
  completed_at: string | null;
  accumulated_seconds: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  plan_date: string;
  status: PlanDto["status"];
  type: PlanDto["type"];
  readiness: Readiness;
  generated_at: string;
  accepted_at: string | null;
  capacity_minutes: number;
  scheduled_minutes: number;
  context_json: string;
}

interface BlockRow {
  id: string;
  task_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  score: number;
}

interface SchedulePosition {
  id: string;
  taskId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
}

interface PreferenceRow {
  timezone: string;
  working_day_start: string;
  working_day_end: string;
  transition_minutes: number;
  high_cognitive_recovery_cap: number;
}

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  is_fixed: number;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

interface GoalRow {
  id: string;
  project_id: string | null;
  project_title: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MilestoneRow {
  id: string;
  goal_id: string;
  title: string;
  status: MilestoneStatus;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EditableScheduleContext {
  version: 1;
  availability: AvailabilityWindow[];
  timezone: string;
  workingDayStart: string;
  workingDayEnd: string;
  transitionMinutes: number;
}

interface PlanContext {
  topPriorities: EngineDailyPlan["topPriorities"];
  nextAction: EngineDailyPlan["nextAction"];
  deferred: EngineDailyPlan["deferred"];
  feasibility: EngineDailyPlan["feasibility"];
  /** Context recorded with new drafts so manual moves can be validated safely. */
  editableSchedule?: EditableScheduleContext;
  /** The original engine generation timestamp is deliberately left unchanged. */
  scheduleEditedAt?: string;
  recovery?: RecoveryPlan["recovery"];
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToPreferences(row: PreferenceRow): UserPreferencesDto {
  return {
    timezone: row.timezone,
    workingDayStart: row.working_day_start,
    workingDayEnd: row.working_day_end,
    transitionMinutes: row.transition_minutes,
    highCognitiveRecoveryCap: row.high_cognitive_recovery_cap,
  };
}

function rowToCalendarEvent(row: EventRow, timezone: string): CalendarEventDto {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    startLocal: localDateTimeFromUtc(row.start_at, timezone),
    endLocal: localDateTimeFromUtc(row.end_at, timezone),
    isFixed: row.is_fixed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProject(
  row: ProjectRow,
  progress: ProjectDto["progress"],
): ProjectDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    targetDate: row.target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    progress,
  };
}

function rowToMilestone(row: MilestoneRow): MilestoneDto {
  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    status: row.status,
    targetDate: row.target_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTask(row: TaskRow, dependencies: string[]): TaskDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    impact: row.impact,
    estimateMinutes: row.estimate_minutes,
    actualMinutes: row.actual_minutes,
    dueAt: row.due_at,
    cognitiveLoad: row.cognitive_load,
    goalAlignment: row.goal_alignment,
    goalId: row.goal_id,
    goalTitle: row.goal_title,
    blocked: row.blocked === 1,
    parentTaskId: row.parent_task_id,
    isDecomposed: row.is_decomposed === 1,
    dependencies,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToFocus(row: FocusRow): FocusSessionDto {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    plannedMinutes: row.planned_minutes,
    state: row.state,
    startedAt: row.started_at,
    stateChangedAt: row.state_changed_at,
    completedAt: row.completed_at,
    accumulatedSeconds: row.accumulated_seconds,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asPlanningTask(task: TaskDto): PlanningTask {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    impact: task.impact,
    estimateMinutes: task.estimateMinutes,
    dueAt: task.dueAt,
    goalAlignment: task.goalAlignment,
    cognitiveLoad: task.cognitiveLoad,
    dependencies: task.dependencies,
    completed: task.status === "done",
    blocked: task.blocked,
  };
}

function parseContext(contextJson: string): PlanContext {
  try {
    return JSON.parse(contextJson) as PlanContext;
  } catch {
    return {
      topPriorities: [],
      nextAction: null,
      deferred: [],
      feasibility: {
        availableMinutes: 0,
        scheduledMinutes: 0,
        unscheduledMinutes: 0,
        isFeasible: true,
      },
    };
  }
}

function editableScheduleContext(
  context: PlanContext,
): EditableScheduleContext | null {
  const candidate = context.editableSchedule;
  if (
    !candidate ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.availability) ||
    typeof candidate.timezone !== "string" ||
    typeof candidate.workingDayStart !== "string" ||
    typeof candidate.workingDayEnd !== "string" ||
    !Number.isInteger(candidate.transitionMinutes)
  ) {
    return null;
  }
  const hasValidAvailability = candidate.availability.every(
    (window) =>
      typeof window?.startAt === "string" &&
      typeof window?.endAt === "string" &&
      Number.isFinite(Date.parse(window.startAt)) &&
      Number.isFinite(Date.parse(window.endAt)) &&
      Date.parse(window.endAt) > Date.parse(window.startAt),
  );
  return hasValidAvailability ? candidate : null;
}

export class PreferencesRepository {
  constructor(private readonly database: FocusDatabase) {}

  get(userId: string): UserPreferencesDto {
    const row = this.database.get<PreferenceRow>(
      `SELECT timezone, working_day_start, working_day_end, transition_minutes, high_cognitive_recovery_cap
       FROM user_preferences WHERE user_id = ?`,
      [userId],
    );
    if (!row) throw new NotFoundError("User preferences not found.");
    return rowToPreferences(row);
  }

  update(
    input: Partial<UserPreferencesDto>,
    userId: string,
  ): UserPreferencesDto {
    this.get(userId);
    const fields: string[] = [];
    const values: Array<string | number> = [];
    const mapping: Array<
      [keyof UserPreferencesDto, string, (value: never) => string | number]
    > = [
      ["timezone", "timezone", (value) => String(value)],
      ["workingDayStart", "working_day_start", (value) => String(value)],
      ["workingDayEnd", "working_day_end", (value) => String(value)],
      ["transitionMinutes", "transition_minutes", (value) => Number(value)],
      [
        "highCognitiveRecoveryCap",
        "high_cognitive_recovery_cap",
        (value) => Number(value),
      ],
    ];
    for (const [key, column, transform] of mapping) {
      if (input[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(transform(input[key] as never));
      }
    }
    if (fields.length === 0) return this.get(userId);

    fields.push("updated_at = ?");
    values.push(nowIso(), userId);
    this.database.run(
      `UPDATE user_preferences SET ${fields.join(", ")} WHERE user_id = ?`,
      values,
    );
    return this.get(userId);
  }
}

export class CalendarEventRepository {
  constructor(
    private readonly database: FocusDatabase,
    private readonly preferences: PreferencesRepository,
  ) {}

  list(
    input: { startDate: string; endDate: string },
    userId: string,
  ): CalendarEventDto[] {
    const preferences = this.preferences.get(userId);
    const startAt = this.resolveLocal(
      `${input.startDate}T00:00`,
      preferences.timezone,
    );
    const endAt = this.resolveLocal(
      `${nextCalendarDate(input.endDate)}T00:00`,
      preferences.timezone,
    );
    return this.database
      .all<EventRow>(
        `SELECT id, title, start_at, end_at, is_fixed, created_at, updated_at
         FROM calendar_events
         WHERE user_id = ? AND start_at < ? AND end_at > ?
         ORDER BY start_at ASC, end_at ASC`,
        [userId, endAt, startAt],
      )
      .map((row) => rowToCalendarEvent(row, preferences.timezone));
  }

  create(input: CalendarEventInput, userId: string): CalendarEventDto {
    const preferences = this.preferences.get(userId);
    const startAt = this.resolveLocal(input.startLocal, preferences.timezone);
    const endAt = this.resolveLocal(input.endLocal, preferences.timezone);
    this.assertChronological(startAt, endAt);

    const id = randomUUID();
    const now = nowIso();
    this.database.run(
      `INSERT INTO calendar_events(
        id, user_id, title, start_at, end_at, is_fixed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.title.trim(),
        startAt,
        endAt,
        input.isFixed ? 1 : 0,
        now,
        now,
      ],
    );
    return this.get(id, userId);
  }

  update(
    eventId: string,
    input: Partial<CalendarEventInput>,
    userId: string,
  ): CalendarEventDto {
    const row = this.rowForUser(eventId, userId);
    const preferences = this.preferences.get(userId);
    const startAt =
      input.startLocal === undefined
        ? row.start_at
        : this.resolveLocal(input.startLocal, preferences.timezone);
    const endAt =
      input.endLocal === undefined
        ? row.end_at
        : this.resolveLocal(input.endLocal, preferences.timezone);
    this.assertChronological(startAt, endAt);

    const fields: string[] = [];
    const values: Array<string | number> = [];
    if (input.title !== undefined) {
      fields.push("title = ?");
      values.push(input.title.trim());
    }
    if (input.startLocal !== undefined) {
      fields.push("start_at = ?");
      values.push(startAt);
    }
    if (input.endLocal !== undefined) {
      fields.push("end_at = ?");
      values.push(endAt);
    }
    if (input.isFixed !== undefined) {
      fields.push("is_fixed = ?");
      values.push(input.isFixed ? 1 : 0);
    }
    if (fields.length === 0)
      return rowToCalendarEvent(row, preferences.timezone);

    fields.push("updated_at = ?");
    values.push(nowIso(), eventId, userId);
    this.database.run(
      `UPDATE calendar_events SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      values,
    );
    return this.get(eventId, userId);
  }

  delete(eventId: string, userId: string): void {
    this.rowForUser(eventId, userId);
    this.database.run(
      "DELETE FROM calendar_events WHERE id = ? AND user_id = ?",
      [eventId, userId],
    );
  }

  get(eventId: string, userId: string): CalendarEventDto {
    const row = this.rowForUser(eventId, userId);
    return rowToCalendarEvent(row, this.preferences.get(userId).timezone);
  }

  private rowForUser(eventId: string, userId: string): EventRow {
    const row = this.database.get<EventRow>(
      `SELECT id, title, start_at, end_at, is_fixed, created_at, updated_at
       FROM calendar_events WHERE id = ? AND user_id = ?`,
      [eventId, userId],
    );
    if (!row) throw new NotFoundError("Calendar event not found.");
    return row;
  }

  private resolveLocal(localDateTime: string, timezone: string): string {
    try {
      return utcFromLocalDateTime(localDateTime, timezone);
    } catch (error) {
      if (error instanceof LocalTimeResolutionError)
        throw new ConflictError(error.message);
      throw error;
    }
  }

  private assertChronological(startAt: string, endAt: string): void {
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new ConflictError("An event must end after it starts.");
    }
  }
}

export class ProjectRepository {
  constructor(private readonly database: FocusDatabase) {}

  list(userId: string): ProjectDto[] {
    return this.database
      .all<ProjectRow>(
        `SELECT id, title, description, status, target_date, created_at, updated_at
         FROM projects WHERE user_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                  target_date IS NULL, target_date ASC, updated_at DESC`,
        [userId],
      )
      .map((row) => this.toDto(row));
  }

  get(projectId: string, userId: string): ProjectDto {
    return this.toDto(this.rowForUser(projectId, userId));
  }

  create(input: ProjectInput, userId: string): ProjectDto {
    const id = randomUUID();
    const now = nowIso();
    this.database.run(
      `INSERT INTO projects(
        id, user_id, title, description, status, target_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.title.trim(),
        input.description,
        input.status,
        input.targetDate,
        now,
        now,
      ],
    );
    return this.get(id, userId);
  }

  update(
    projectId: string,
    input: Partial<ProjectInput>,
    userId: string,
  ): ProjectDto {
    this.rowForUser(projectId, userId);
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const mapping: Array<
      [keyof ProjectInput, string, (value: never) => string | null]
    > = [
      ["title", "title", (value) => String(value).trim()],
      [
        "description",
        "description",
        (value) => (value === undefined ? null : (value as string | null)),
      ],
      ["status", "status", (value) => String(value)],
      [
        "targetDate",
        "target_date",
        (value) => (value === undefined ? null : (value as string | null)),
      ],
    ];
    for (const [key, column, transform] of mapping) {
      if (input[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(transform(input[key] as never));
      }
    }
    fields.push("updated_at = ?");
    values.push(nowIso(), projectId, userId);
    this.database.run(
      `UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      values,
    );
    return this.get(projectId, userId);
  }

  delete(projectId: string, userId: string): void {
    this.rowForUser(projectId, userId);
    this.database.run("DELETE FROM projects WHERE id = ? AND user_id = ?", [
      projectId,
      userId,
    ]);
  }

  private rowForUser(projectId: string, userId: string): ProjectRow {
    const row = this.database.get<ProjectRow>(
      `SELECT id, title, description, status, target_date, created_at, updated_at
       FROM projects WHERE id = ? AND user_id = ?`,
      [projectId, userId],
    );
    if (!row) throw new NotFoundError("Project not found.");
    return row;
  }

  private toDto(row: ProjectRow): ProjectDto {
    const progress = this.database.get<{
      total_goals: number;
      completed_goals: number;
      active_goals: number;
    }>(
      `SELECT COUNT(*) AS total_goals,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_goals,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_goals
       FROM goals WHERE project_id = ?`,
      [row.id],
    );
    return rowToProject(row, {
      totalGoals: progress?.total_goals ?? 0,
      completedGoals: progress?.completed_goals ?? 0,
      activeGoals: progress?.active_goals ?? 0,
    });
  }
}

export class GoalRepository {
  constructor(private readonly database: FocusDatabase) {}

  list(userId: string): GoalDto[] {
    return this.database
      .all<GoalRow>(
        `SELECT g.id, g.project_id, p.title AS project_title, g.title, g.description, g.status,
                g.target_date, g.completed_at, g.created_at, g.updated_at
         FROM goals g
         LEFT JOIN projects p ON p.id = g.project_id AND p.user_id = g.user_id
         WHERE g.user_id = ?
         ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                  g.target_date IS NULL, g.target_date ASC, g.updated_at DESC`,
        [userId],
      )
      .map((row) => this.toDto(row));
  }

  get(goalId: string, userId: string): GoalDto {
    return this.toDto(this.rowForUser(goalId, userId));
  }

  create(input: GoalInput, userId: string): GoalDto {
    this.assertProjectCanContainGoal(input.projectId, userId, null);
    const id = randomUUID();
    const now = nowIso();
    this.database.run(
      `INSERT INTO goals(
        id, user_id, project_id, title, description, status, target_date, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.projectId,
        input.title.trim(),
        input.description,
        input.status,
        input.targetDate,
        input.status === "completed" ? now : null,
        now,
        now,
      ],
    );
    return this.get(id, userId);
  }

  update(goalId: string, input: Partial<GoalInput>, userId: string): GoalDto {
    return this.database.transaction(() => {
      const current = this.rowForUser(goalId, userId);
      if (input.projectId !== undefined) {
        this.assertProjectCanContainGoal(
          input.projectId,
          userId,
          current.project_id,
        );
      }
      if (input.status === "completed" && current.status !== "completed") {
        this.assertCanComplete(current, userId);
      }

      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      const mapping: Array<
        [keyof GoalInput, string, (value: never) => string | null]
      > = [
        ["projectId", "project_id", (value) => value as string | null],
        ["title", "title", (value) => String(value).trim()],
        [
          "description",
          "description",
          (value) => (value === undefined ? null : (value as string | null)),
        ],
        ["status", "status", (value) => String(value)],
        [
          "targetDate",
          "target_date",
          (value) => (value === undefined ? null : (value as string | null)),
        ],
      ];
      for (const [key, column, transform] of mapping) {
        if (input[key] !== undefined) {
          fields.push(`${column} = ?`);
          values.push(transform(input[key] as never));
        }
      }
      if (input.status === "completed") {
        fields.push("completed_at = COALESCE(completed_at, ?)");
        values.push(nowIso());
      } else if (input.status) {
        fields.push("completed_at = NULL");
      }
      fields.push("updated_at = ?");
      values.push(nowIso(), goalId, userId);
      this.database.run(
        `UPDATE goals SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
        values,
      );
      return this.get(goalId, userId);
    });
  }

  delete(goalId: string, userId: string): void {
    this.rowForUser(goalId, userId);
    this.database.run("DELETE FROM goals WHERE id = ? AND user_id = ?", [
      goalId,
      userId,
    ]);
  }

  createMilestone(
    goalId: string,
    input: MilestoneInput,
    userId: string,
  ): MilestoneDto {
    const goal = this.rowForUser(goalId, userId);
    this.assertMilestonesAreMutable(goal);
    const id = randomUUID();
    const now = nowIso();
    this.database.run(
      `INSERT INTO milestones(
        id, goal_id, title, status, target_date, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        goalId,
        input.title.trim(),
        input.status,
        input.targetDate,
        input.status === "completed" ? now : null,
        now,
        now,
      ],
    );
    return this.milestoneForGoal(id, goalId, userId);
  }

  updateMilestone(
    goalId: string,
    milestoneId: string,
    input: Partial<MilestoneInput>,
    userId: string,
  ): MilestoneDto {
    return this.database.transaction(() => {
      const goal = this.rowForUser(goalId, userId);
      this.assertMilestonesAreMutable(goal);
      this.milestoneForGoal(milestoneId, goalId, userId);
      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      const mapping: Array<
        [keyof MilestoneInput, string, (value: never) => string | null]
      > = [
        ["title", "title", (value) => String(value).trim()],
        ["status", "status", (value) => String(value)],
        [
          "targetDate",
          "target_date",
          (value) => (value === undefined ? null : (value as string | null)),
        ],
      ];
      for (const [key, column, transform] of mapping) {
        if (input[key] !== undefined) {
          fields.push(`${column} = ?`);
          values.push(transform(input[key] as never));
        }
      }
      if (input.status === "completed") {
        fields.push("completed_at = COALESCE(completed_at, ?)");
        values.push(nowIso());
      } else if (input.status === "pending") {
        fields.push("completed_at = NULL");
      }
      fields.push("updated_at = ?");
      values.push(nowIso(), milestoneId, goalId);
      this.database.run(
        `UPDATE milestones SET ${fields.join(", ")} WHERE id = ? AND goal_id = ?`,
        values,
      );
      return this.milestoneForGoal(milestoneId, goalId, userId);
    });
  }

  deleteMilestone(goalId: string, milestoneId: string, userId: string): void {
    const goal = this.rowForUser(goalId, userId);
    this.assertMilestonesAreMutable(goal);
    this.milestoneForGoal(milestoneId, goalId, userId);
    this.database.run("DELETE FROM milestones WHERE id = ? AND goal_id = ?", [
      milestoneId,
      goalId,
    ]);
  }

  private rowForUser(goalId: string, userId: string): GoalRow {
    const row = this.database.get<GoalRow>(
      `SELECT g.id, g.project_id, p.title AS project_title, g.title, g.description, g.status,
              g.target_date, g.completed_at, g.created_at, g.updated_at
       FROM goals g
       LEFT JOIN projects p ON p.id = g.project_id AND p.user_id = g.user_id
       WHERE g.id = ? AND g.user_id = ?`,
      [goalId, userId],
    );
    if (!row) throw new NotFoundError("Goal not found.");
    return row;
  }

  private milestoneForGoal(
    milestoneId: string,
    goalId: string,
    userId: string,
  ): MilestoneDto {
    const row = this.database.get<MilestoneRow>(
      `SELECT m.id, m.goal_id, m.title, m.status, m.target_date, m.completed_at, m.created_at, m.updated_at
       FROM milestones m
       INNER JOIN goals g ON g.id = m.goal_id
       WHERE m.id = ? AND m.goal_id = ? AND g.user_id = ?`,
      [milestoneId, goalId, userId],
    );
    if (!row) throw new NotFoundError("Milestone not found.");
    return rowToMilestone(row);
  }

  private toDto(row: GoalRow): GoalDto {
    const taskProgress = this.database.get<{
      total_tasks: number;
      completed_tasks: number;
    }>(
      `SELECT COUNT(*) AS total_tasks,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_tasks
       FROM tasks WHERE goal_id = ? AND is_decomposed = 0`,
      [row.id],
    );
    const milestoneProgress = this.database.get<{
      total_milestones: number;
      completed_milestones: number;
    }>(
      `SELECT COUNT(*) AS total_milestones,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_milestones
       FROM milestones WHERE goal_id = ?`,
      [row.id],
    );
    const milestones = this.database
      .all<MilestoneRow>(
        `SELECT id, goal_id, title, status, target_date, completed_at, created_at, updated_at
         FROM milestones WHERE goal_id = ?
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                  target_date IS NULL, target_date ASC, created_at ASC`,
        [row.id],
      )
      .map(rowToMilestone);
    return {
      id: row.id,
      projectId: row.project_id,
      projectTitle: row.project_title,
      title: row.title,
      description: row.description,
      status: row.status,
      targetDate: row.target_date,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      progress: {
        totalTasks: taskProgress?.total_tasks ?? 0,
        completedTasks: taskProgress?.completed_tasks ?? 0,
        totalMilestones: milestoneProgress?.total_milestones ?? 0,
        completedMilestones: milestoneProgress?.completed_milestones ?? 0,
      },
      milestones,
    };
  }

  private assertProjectCanContainGoal(
    projectId: string | null,
    userId: string,
    currentProjectId: string | null,
  ): void {
    if (!projectId) return;
    const project = this.database.get<{ status: ProjectStatus }>(
      "SELECT status FROM projects WHERE id = ? AND user_id = ?",
      [projectId, userId],
    );
    if (!project) throw new NotFoundError("Project not found.");
    if (project.status !== "active" && projectId !== currentProjectId) {
      throw new ConflictError(
        "Choose an active project before adding a goal to it.",
      );
    }
  }

  private assertCanComplete(goal: GoalRow, userId: string): void {
    const unfinishedTask = this.database.get<{ title: string }>(
      `SELECT title FROM tasks
       WHERE user_id = ? AND goal_id = ? AND is_decomposed = 0 AND status <> 'done'
       LIMIT 1`,
      [userId, goal.id],
    );
    if (unfinishedTask) {
      throw new ConflictError(
        `Finish or unlink “${unfinishedTask.title}” before completing this goal.`,
      );
    }
    const pendingMilestone = this.database.get<{ title: string }>(
      "SELECT title FROM milestones WHERE goal_id = ? AND status <> 'completed' LIMIT 1",
      [goal.id],
    );
    if (pendingMilestone) {
      throw new ConflictError(
        `Complete or remove milestone “${pendingMilestone.title}” before completing this goal.`,
      );
    }
  }

  private assertMilestonesAreMutable(goal: GoalRow): void {
    if (goal.status !== "active") {
      throw new ConflictError(
        "Reopen this goal before changing its milestones.",
      );
    }
  }
}

export class TaskRepository {
  constructor(private readonly database: FocusDatabase) {}

  list(
    userId: string,
    filters: { status?: TaskStatus; search?: string; goalId?: string } = {},
  ): TaskDto[] {
    const where = ["t.user_id = ?"];
    const parameters: Array<string | number | null> = [userId];
    if (filters.status) {
      where.push("t.status = ?");
      parameters.push(filters.status);
    }
    if (filters.goalId) {
      where.push("t.goal_id = ?");
      parameters.push(filters.goalId);
    }
    if (filters.search) {
      where.push(
        "(t.title LIKE ? COLLATE NOCASE OR t.description LIKE ? COLLATE NOCASE)",
      );
      const term = `%${filters.search.trim()}%`;
      parameters.push(term, term);
    }
    const rows = this.database.all<TaskRow>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.impact, t.estimate_minutes, t.actual_minutes,
              t.due_at, t.cognitive_load, t.goal_alignment, t.goal_id, g.title AS goal_title, t.blocked,
              t.parent_task_id, t.is_decomposed, t.created_at, t.updated_at, t.completed_at
       FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id AND g.user_id = t.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'backlog' THEN 2 ELSE 3 END,
                t.due_at IS NULL, t.due_at ASC, t.updated_at DESC`,
      parameters,
    );
    return rows.map((row) => rowToTask(row, this.dependenciesForTask(row.id)));
  }

  get(taskId: string, userId: string): TaskDto {
    const row = this.database.get<TaskRow>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.impact, t.estimate_minutes, t.actual_minutes,
              t.due_at, t.cognitive_load, t.goal_alignment, t.goal_id, g.title AS goal_title, t.blocked,
              t.parent_task_id, t.is_decomposed, t.created_at, t.updated_at, t.completed_at
       FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id AND g.user_id = t.user_id
       WHERE t.id = ? AND t.user_id = ?`,
      [taskId, userId],
    );
    if (!row) throw new NotFoundError("Task not found.");
    return rowToTask(row, this.dependenciesForTask(row.id));
  }

  create(input: TaskCreateInput, userId: string): TaskDto {
    const id = this.database.transaction(() =>
      this.insertTask(input, userId, null),
    );
    return this.get(id, userId);
  }

  /**
   * Creates reviewed child work in one transaction and turns the parent into a
   * non-plannable container. No task is generated without this explicit call.
   */
  decompose(
    taskId: string,
    steps: TaskCreateInput[],
    userId: string,
  ): TaskDecompositionDto {
    return this.database.transaction(() => {
      const parent = this.get(taskId, userId);
      if (parent.status === "done") {
        throw new ConflictError(
          "Completed tasks cannot be broken into new steps.",
        );
      }
      if (parent.isDecomposed) {
        throw new ConflictError(
          "This task has already been broken into steps.",
        );
      }
      this.assertHasNoDependents(taskId, userId);
      // Steps preserve the parent’s explicit goal relationship; clients cannot
      // silently redirect newly created work to a different goal.
      this.assertGoalCanReceiveWork(parent.goalId, userId, null, "todo");

      const stepIds = steps.map((step) => {
        if (step.dependencies.includes(taskId)) {
          throw new ConflictError(
            "A step cannot depend on its breakdown parent. Choose an actionable dependency instead.",
          );
        }
        return this.insertTask(
          { ...step, goalId: parent.goalId },
          userId,
          taskId,
        );
      });
      this.database.run(
        "UPDATE tasks SET is_decomposed = 1, updated_at = ? WHERE id = ? AND user_id = ?",
        [nowIso(), taskId, userId],
      );
      return {
        parent: this.get(taskId, userId),
        steps: stepIds.map((stepId) => this.get(stepId, userId)),
      };
    });
  }

  update(taskId: string, input: TaskUpdateInput, userId: string): TaskDto {
    const current = this.get(taskId, userId);
    if (input.status === "done")
      this.assertContainerCanComplete(current, userId);
    const nextGoalId =
      input.goalId === undefined ? current.goalId : input.goalId;
    const nextStatus = input.status ?? current.status;
    this.assertGoalCanReceiveWork(
      nextGoalId,
      userId,
      current.goalId,
      nextStatus,
    );
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const mapping: Array<
      [keyof typeof input, string, (value: never) => string | number | null]
    > = [
      ["title", "title", (value) => String(value).trim()],
      [
        "description",
        "description",
        (value) => (value === undefined ? null : (value as string | null)),
      ],
      ["status", "status", (value) => String(value)],
      ["priority", "priority", (value) => String(value)],
      ["impact", "impact", (value) => Number(value)],
      ["estimateMinutes", "estimate_minutes", (value) => Number(value)],
      ["actualMinutes", "actual_minutes", (value) => Number(value)],
      [
        "dueAt",
        "due_at",
        (value) => (value === undefined ? null : (value as string | null)),
      ],
      ["cognitiveLoad", "cognitive_load", (value) => String(value)],
      ["goalAlignment", "goal_alignment", (value) => Number(value)],
      ["goalId", "goal_id", (value) => value as string | null],
      ["blocked", "blocked", (value) => (value ? 1 : 0)],
    ];

    for (const [key, column, transform] of mapping) {
      if (input[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(transform(input[key] as never));
      }
    }
    if (input.status === "done") {
      fields.push("completed_at = COALESCE(completed_at, ?)");
      values.push(nowIso());
    } else if (input.status) {
      fields.push("completed_at = NULL");
    }
    fields.push("updated_at = ?");
    values.push(nowIso());

    this.database.transaction(() => {
      if (fields.length > 1) {
        values.push(taskId, userId);
        this.database.run(
          `UPDATE tasks SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
          values,
        );
      }
      if (input.dependencies !== undefined) {
        this.replaceDependencies(taskId, input.dependencies, userId, nowIso());
      }
    });
    return this.get(taskId, userId);
  }

  complete(
    taskId: string,
    actualMinutes: number | undefined,
    userId: string,
  ): TaskDto {
    const task = this.get(taskId, userId);
    this.assertContainerCanComplete(task, userId);
    const now = nowIso();
    this.database.run(
      `UPDATE tasks
       SET status = 'done', actual_minutes = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [actualMinutes ?? task.actualMinutes, now, now, taskId, userId],
    );
    return this.get(taskId, userId);
  }

  delete(taskId: string, userId: string): void {
    this.get(taskId, userId);
    this.database.run("DELETE FROM tasks WHERE id = ? AND user_id = ?", [
      taskId,
      userId,
    ]);
  }

  private assertGoalCanReceiveWork(
    goalId: string | null,
    userId: string,
    currentGoalId: string | null,
    nextStatus: TaskStatus,
  ): void {
    if (!goalId) return;
    const goal = this.database.get<{ status: GoalStatus }>(
      "SELECT status FROM goals WHERE id = ? AND user_id = ?",
      [goalId, userId],
    );
    if (!goal) throw new NotFoundError("Goal not found.");
    if (goal.status === "active") return;
    if (goalId !== currentGoalId) {
      throw new ConflictError(
        "Choose an active goal before linking new work to it.",
      );
    }
    if (goal.status === "completed" && nextStatus !== "done") {
      throw new ConflictError(
        "Reopen this goal before reopening one of its completed tasks.",
      );
    }
  }

  private assertContainerCanComplete(task: TaskDto, userId: string): void {
    if (!task.isDecomposed) return;
    const unfinishedChild = this.database.get<{ title: string }>(
      `SELECT title FROM tasks
       WHERE user_id = ? AND parent_task_id = ? AND status <> 'done'
       LIMIT 1`,
      [userId, task.id],
    );
    if (unfinishedChild) {
      throw new ConflictError(
        `Finish or remove “${unfinishedChild.title}” before completing this breakdown task.`,
      );
    }
  }

  private insertTask(
    input: TaskCreateInput,
    userId: string,
    parentTaskId: string | null,
  ): string {
    this.assertGoalCanReceiveWork(input.goalId, userId, null, input.status);
    const id = randomUUID();
    const now = nowIso();
    this.database.run(
      `INSERT INTO tasks(
        id, user_id, title, description, status, priority, impact, estimate_minutes, actual_minutes,
        due_at, cognitive_load, goal_alignment, goal_id, blocked, parent_task_id, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.title.trim(),
        input.description,
        input.status,
        input.priority,
        input.impact,
        input.estimateMinutes,
        input.dueAt,
        input.cognitiveLoad,
        input.goalAlignment,
        input.goalId,
        input.blocked ? 1 : 0,
        parentTaskId,
        now,
        now,
        input.status === "done" ? now : null,
      ],
    );
    this.replaceDependencies(id, input.dependencies, userId, now);
    return id;
  }

  private assertHasNoDependents(taskId: string, userId: string): void {
    const dependent = this.database.get<{ title: string }>(
      `SELECT t.title
       FROM task_dependencies dependency
       INNER JOIN tasks t ON t.id = dependency.task_id
       WHERE dependency.depends_on_task_id = ? AND t.user_id = ?
       LIMIT 1`,
      [taskId, userId],
    );
    if (dependent) {
      throw new ConflictError(
        `Update dependencies before breaking this task into steps; “${dependent.title}” currently depends on it.`,
      );
    }
  }

  private dependenciesForTask(taskId: string): string[] {
    return this.database
      .all<{ depends_on_task_id: string }>(
        "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY created_at ASC",
        [taskId],
      )
      .map((row) => row.depends_on_task_id);
  }

  private replaceDependencies(
    taskId: string,
    dependencyIds: string[],
    userId: string,
    createdAt: string,
  ): void {
    const uniqueDependencyIds = [...new Set(dependencyIds)];
    if (uniqueDependencyIds.includes(taskId)) {
      throw new ConflictError("A task cannot depend on itself.");
    }
    for (const dependencyId of uniqueDependencyIds) {
      const dependency = this.get(dependencyId, userId);
      if (dependency.isDecomposed) {
        throw new ConflictError(
          "A dependency must be actionable; choose one of that task’s steps instead.",
        );
      }
    }
    this.assertDependenciesDoNotCycle(taskId, uniqueDependencyIds, userId);
    this.database.run("DELETE FROM task_dependencies WHERE task_id = ?", [
      taskId,
    ]);
    for (const dependencyId of uniqueDependencyIds) {
      this.database.run(
        "INSERT INTO task_dependencies(task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)",
        [taskId, dependencyId, createdAt],
      );
    }
  }

  private assertDependenciesDoNotCycle(
    taskId: string,
    dependencyIds: string[],
    userId: string,
  ): void {
    const graph = new Map<string, string[]>();
    for (const row of this.database.all<{
      task_id: string;
      depends_on_task_id: string;
    }>(
      `SELECT dependency.task_id, dependency.depends_on_task_id
       FROM task_dependencies dependency
       INNER JOIN tasks task ON task.id = dependency.task_id
       WHERE task.user_id = ? AND dependency.task_id <> ?`,
      [userId, taskId],
    )) {
      const dependencies = graph.get(row.task_id) ?? [];
      dependencies.push(row.depends_on_task_id);
      graph.set(row.task_id, dependencies);
    }
    graph.set(taskId, dependencyIds);

    const reachesTask = (currentId: string, visited: Set<string>): boolean => {
      if (currentId === taskId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      return (graph.get(currentId) ?? []).some((dependencyId) =>
        reachesTask(dependencyId, visited),
      );
    };

    if (
      dependencyIds.some((dependencyId) =>
        reachesTask(dependencyId, new Set<string>()),
      )
    ) {
      throw new ConflictError("Task dependencies cannot contain a cycle.");
    }
  }
}

export class FocusSessionRepository {
  constructor(
    private readonly database: FocusDatabase,
    private readonly tasks: TaskRepository,
  ) {}

  active(userId: string): FocusSessionDto | null {
    const row = this.database.get<FocusRow>(
      `SELECT fs.id, fs.task_id, t.title AS task_title, fs.planned_minutes, fs.state, fs.started_at,
              fs.state_changed_at, fs.completed_at, fs.accumulated_seconds, fs.note, fs.created_at, fs.updated_at
       FROM focus_sessions fs LEFT JOIN tasks t ON t.id = fs.task_id
       WHERE fs.user_id = ? AND fs.state IN ('active', 'paused')
       ORDER BY fs.started_at DESC LIMIT 1`,
      [userId],
    );
    return row ? rowToFocus(row) : null;
  }

  list(userId: string): FocusSessionDto[] {
    return this.database
      .all<FocusRow>(
        `SELECT fs.id, fs.task_id, t.title AS task_title, fs.planned_minutes, fs.state, fs.started_at,
                fs.state_changed_at, fs.completed_at, fs.accumulated_seconds, fs.note, fs.created_at, fs.updated_at
         FROM focus_sessions fs LEFT JOIN tasks t ON t.id = fs.task_id
         WHERE fs.user_id = ? ORDER BY fs.started_at DESC LIMIT 50`,
        [userId],
      )
      .map(rowToFocus);
  }

  start(
    input: {
      taskId: string | null;
      plannedMinutes: number;
      note: string | null;
    },
    userId: string,
  ): FocusSessionDto {
    if (input.taskId) {
      const task = this.tasks.get(input.taskId, userId);
      if (task.isDecomposed) {
        throw new ConflictError(
          "Start focus on one of this task’s actionable steps instead.",
        );
      }
    }
    const now = nowIso();
    const id = randomUUID();
    this.database.transaction(() => {
      if (this.active(userId))
        throw new ConflictError(
          "Finish or stop the current focus session first.",
        );
      this.database.run(
        `INSERT INTO focus_sessions(
          id, user_id, task_id, planned_minutes, state, started_at, state_changed_at,
          completed_at, accumulated_seconds, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, 0, ?, ?, ?)`,
        [
          id,
          userId,
          input.taskId,
          input.plannedMinutes,
          now,
          now,
          input.note,
          now,
          now,
        ],
      );
    });
    return this.get(id, userId);
  }

  transition(
    sessionId: string,
    action: "pause" | "resume" | "complete" | "stop",
    userId: string,
  ): FocusSessionDto {
    return this.database.transaction(() => {
      const current = this.get(sessionId, userId);
      const now = nowIso();
      const activeElapsed =
        current.state === "active"
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(now) - Date.parse(current.stateChangedAt)) / 1000,
              ),
            )
          : 0;
      const accumulatedSeconds = current.accumulatedSeconds + activeElapsed;

      if (action === "pause") {
        if (current.state !== "active")
          throw new ConflictError("Only an active session can be paused.");
        this.database.run(
          `UPDATE focus_sessions SET state = 'paused', state_changed_at = ?, accumulated_seconds = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
          [now, accumulatedSeconds, now, sessionId, userId],
        );
      }
      if (action === "resume") {
        if (current.state !== "paused")
          throw new ConflictError("Only a paused session can be resumed.");
        this.database.run(
          `UPDATE focus_sessions SET state = 'active', state_changed_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
          [now, now, sessionId, userId],
        );
      }
      if (action === "complete" || action === "stop") {
        if (current.state !== "active" && current.state !== "paused") {
          throw new ConflictError(
            "Only an active or paused session can be ended.",
          );
        }
        const nextState = action === "complete" ? "completed" : "stopped";
        this.database.run(
          `UPDATE focus_sessions
           SET state = ?, state_changed_at = ?, completed_at = ?, accumulated_seconds = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
          [
            nextState,
            now,
            action === "complete" ? now : null,
            accumulatedSeconds,
            now,
            sessionId,
            userId,
          ],
        );
      }
      return this.get(sessionId, userId);
    });
  }

  get(sessionId: string, userId: string): FocusSessionDto {
    const row = this.database.get<FocusRow>(
      `SELECT fs.id, fs.task_id, t.title AS task_title, fs.planned_minutes, fs.state, fs.started_at,
              fs.state_changed_at, fs.completed_at, fs.accumulated_seconds, fs.note, fs.created_at, fs.updated_at
       FROM focus_sessions fs LEFT JOIN tasks t ON t.id = fs.task_id
       WHERE fs.id = ? AND fs.user_id = ?`,
      [sessionId, userId],
    );
    if (!row) throw new NotFoundError("Focus session not found.");
    return rowToFocus(row);
  }
}

export class PlanRepository {
  constructor(
    private readonly database: FocusDatabase,
    private readonly tasks: TaskRepository,
    private readonly preferences: PreferencesRepository,
  ) {}

  generate(
    input: {
      planDate: string;
      readiness: Readiness;
      availability?: AvailabilityWindow[];
      now?: string;
      recovery?: boolean;
    },
    userId: string,
  ): PlanDto {
    const preference = this.preferences.get(userId);
    const availability = input.availability?.length
      ? input.availability
      : input.recovery
        ? this.remainingAvailability(input.planDate, preference, input.now)
        : this.defaultAvailability(input.planDate, preference);
    const commitments = this.commitmentsFor(availability, userId);
    const tasks = this.tasks
      .list(userId)
      .filter((task) => !task.isDecomposed)
      .map(asPlanningTask);
    const options = {
      tasks,
      availability,
      commitments,
      now: input.now ?? nowIso(),
      readiness: input.readiness,
      preferences: {
        transitionMinutes: preference.transitionMinutes,
        highCognitiveRecoveryCapRatio: preference.highCognitiveRecoveryCap,
      },
    };
    const enginePlan = input.recovery
      ? generateRecoveryPlan(options)
      : generateDailyPlan(options);
    return this.persist(
      enginePlan,
      input.planDate,
      input.readiness,
      input.recovery ? "recovery" : "daily",
      userId,
      {
        version: 1,
        availability,
        timezone: preference.timezone,
        workingDayStart: preference.workingDayStart,
        workingDayEnd: preference.workingDayEnd,
        transitionMinutes: preference.transitionMinutes,
      },
    );
  }

  latestForDate(planDate: string, userId: string): PlanDto | null {
    const row = this.database.get<PlanRow>(
      `SELECT id, plan_date, status, type, readiness, generated_at, accepted_at, capacity_minutes,
              scheduled_minutes, context_json
       FROM daily_plans WHERE user_id = ? AND plan_date = ?
       ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, generated_at DESC LIMIT 1`,
      [userId, planDate],
    );
    return row ? this.rowToPlan(row, userId) : null;
  }

  accept(planId: string, userId: string): PlanDto {
    const row = this.database.get<PlanRow>(
      "SELECT * FROM daily_plans WHERE id = ? AND user_id = ?",
      [planId, userId],
    );
    if (!row) throw new NotFoundError("Plan not found.");
    const now = nowIso();
    this.database.transaction(() => {
      this.database.run(
        "UPDATE daily_plans SET status = 'superseded' WHERE user_id = ? AND plan_date = ? AND id <> ? AND status = 'accepted'",
        [userId, row.plan_date, planId],
      );
      this.database.run(
        "UPDATE daily_plans SET status = 'accepted', accepted_at = ? WHERE id = ? AND user_id = ?",
        [now, planId, userId],
      );
    });
    return this.rowToPlan(
      { ...row, status: "accepted", accepted_at: now },
      userId,
    );
  }

  /**
   * Replaces the positions of every block in a current daily draft. The engine
   * result remains a snapshot; this only records an explicit user adjustment
   * after rechecking the draft's saved availability against current constraints.
   */
  reschedule(
    planId: string,
    input: Array<{ id: string; startLocal: string }>,
    userId: string,
  ): PlanDto {
    return this.database.transaction(() => {
      const row = this.database.get<PlanRow>(
        "SELECT * FROM daily_plans WHERE id = ? AND user_id = ?",
        [planId, userId],
      );
      if (!row) throw new NotFoundError("Plan not found.");
      if (row.status !== "draft") {
        throw new ConflictError(
          "Only a draft can be adjusted. Accepted plans stay as historical records.",
        );
      }
      if (row.type !== "daily") {
        throw new ConflictError(
          "Recovery drafts should be recalculated instead of manually moved.",
        );
      }

      const context = parseContext(row.context_json);
      const scheduleContext = editableScheduleContext(context);
      if (!scheduleContext) {
        throw new ConflictError(
          "This earlier draft does not contain a saved scheduling context. Regenerate it before adjusting blocks.",
        );
      }

      const preferences = this.preferences.get(userId);
      this.assertSchedulePreferencesMatch(scheduleContext, preferences);
      const existingBlocks = this.database.all<BlockRow>(
        `SELECT id, task_id, title, start_at, end_at, duration_minutes, score
         FROM scheduled_blocks WHERE plan_id = ? ORDER BY start_at ASC`,
        [planId],
      );
      const positions = this.resolveSchedulePositions(
        input,
        existingBlocks,
        preferences.timezone,
      );
      const commitments = this.commitmentsFor(
        scheduleContext.availability,
        userId,
      );
      this.assertScheduleIsFeasible(
        positions,
        scheduleContext,
        commitments,
        userId,
      );

      for (const position of positions) {
        this.database.run(
          "UPDATE scheduled_blocks SET start_at = ?, end_at = ? WHERE id = ? AND plan_id = ?",
          [position.startAt, position.endAt, position.id, planId],
        );
      }
      const editedAt = nowIso();
      const nextContext: PlanContext = {
        ...context,
        scheduleEditedAt: editedAt,
      };
      this.database.run(
        "UPDATE daily_plans SET context_json = ? WHERE id = ? AND user_id = ?",
        [JSON.stringify(nextContext), planId, userId],
      );
      return this.rowToPlan(
        { ...row, context_json: JSON.stringify(nextContext) },
        userId,
      );
    });
  }

  today(userId: string): PlanDto | null {
    const timezone = this.preferences.get(userId).timezone;
    return this.latestForDate(localDateFromUtc(nowIso(), timezone), userId);
  }

  private schedulePreferencesMatch(
    context: EditableScheduleContext,
    preferences: UserPreferencesDto,
  ): boolean {
    return (
      context.timezone === preferences.timezone &&
      context.workingDayStart === preferences.workingDayStart &&
      context.workingDayEnd === preferences.workingDayEnd &&
      context.transitionMinutes === preferences.transitionMinutes
    );
  }

  private assertSchedulePreferencesMatch(
    context: EditableScheduleContext,
    preferences: UserPreferencesDto,
  ): void {
    if (!this.schedulePreferencesMatch(context, preferences)) {
      throw new ConflictError(
        "Your planning preferences changed after this draft was generated. Regenerate it before moving blocks.",
      );
    }
  }

  private resolveSchedulePositions(
    input: Array<{ id: string; startLocal: string }>,
    existingBlocks: BlockRow[],
    timezone: string,
  ): SchedulePosition[] {
    if (input.length !== existingBlocks.length) {
      throw new ConflictError(
        "Save positions for every block in the draft so the whole schedule can be checked together.",
      );
    }
    const blocksById = new Map(
      existingBlocks.map((block) => [block.id, block]),
    );
    const requestedIds = new Set<string>();
    const positions: SchedulePosition[] = [];
    for (const requested of input) {
      if (requestedIds.has(requested.id)) {
        throw new ConflictError(
          "Each schedule block can be positioned only once.",
        );
      }
      requestedIds.add(requested.id);
      const block = blocksById.get(requested.id);
      if (!block) {
        throw new ConflictError(
          "This schedule no longer matches the current draft.",
        );
      }
      let startAt: string;
      try {
        startAt = utcFromLocalDateTime(requested.startLocal, timezone);
      } catch (error) {
        if (error instanceof LocalTimeResolutionError) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
      const start = Date.parse(startAt);
      const end = start + block.duration_minutes * 60_000;
      positions.push({
        id: block.id,
        taskId: block.task_id,
        title: block.title,
        startAt,
        endAt: new Date(end).toISOString(),
        durationMinutes: block.duration_minutes,
      });
    }
    return positions.sort(
      (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
    );
  }

  private assertScheduleIsFeasible(
    positions: SchedulePosition[],
    context: EditableScheduleContext,
    commitments: FixedCommitment[],
    userId: string,
  ): void {
    for (const position of positions) {
      const start = Date.parse(position.startAt);
      const end = Date.parse(position.endAt);
      const fitsAvailability = context.availability.some((window) => {
        const windowStart = Date.parse(window.startAt);
        const windowEnd = Date.parse(window.endAt);
        return start >= windowStart && end <= windowEnd;
      });
      if (!fitsAvailability) {
        throw new ConflictError(
          `“${position.title}” must stay inside this draft’s saved available time.`,
        );
      }
      const conflictingCommitment = commitments.find((commitment) => {
        const commitmentStart = Date.parse(commitment.startAt);
        const commitmentEnd = Date.parse(commitment.endAt);
        return start < commitmentEnd && end > commitmentStart;
      });
      if (conflictingCommitment) {
        throw new ConflictError(
          `“${position.title}” conflicts with the fixed commitment “${conflictingCommitment.title}”.`,
        );
      }
    }

    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1];
      const current = positions[index];
      if (!previous || !current) continue;
      const earliestNextStart =
        Date.parse(previous.endAt) + context.transitionMinutes * 60_000;
      if (Date.parse(current.startAt) < earliestNextStart) {
        throw new ConflictError(
          `Keep “${current.title}” after “${previous.title}” with the ${context.transitionMinutes}-minute transition buffer.`,
        );
      }
    }

    const tasks = new Map(
      this.tasks.list(userId).map((task) => [task.id, task]),
    );
    const positionsByTaskId = new Map(
      positions
        .filter(
          (position): position is SchedulePosition & { taskId: string } =>
            position.taskId !== null,
        )
        .map((position) => [position.taskId, position]),
    );
    for (const position of positions) {
      if (!position.taskId) {
        throw new ConflictError(
          "This draft includes a deleted task. Regenerate it before moving blocks.",
        );
      }
      const task = tasks.get(position.taskId);
      if (
        !task ||
        task.status === "done" ||
        task.blocked ||
        task.isDecomposed
      ) {
        throw new ConflictError(
          `“${position.title}” is no longer an actionable task. Regenerate the draft before moving blocks.`,
        );
      }
      for (const dependencyId of task.dependencies) {
        const dependency = tasks.get(dependencyId);
        if (!dependency) {
          throw new ConflictError(
            `“${position.title}” has a dependency that is no longer actionable. Regenerate the draft before moving blocks.`,
          );
        }
        // A completed dependency remains satisfied even if its old metadata
        // now describes it as blocked or a completed breakdown container.
        if (dependency.status === "done") continue;
        if (dependency.blocked || dependency.isDecomposed) {
          throw new ConflictError(
            `“${position.title}” has a dependency that is no longer actionable. Regenerate the draft before moving blocks.`,
          );
        }
        const dependencyPosition = positionsByTaskId.get(dependencyId);
        if (!dependencyPosition) {
          throw new ConflictError(
            `“${position.title}” needs “${dependency.title}” to be completed or scheduled first.`,
          );
        }
        if (
          Date.parse(dependencyPosition.endAt) > Date.parse(position.startAt)
        ) {
          throw new ConflictError(
            `“${position.title}” must stay after its dependency “${dependency.title}”.`,
          );
        }
      }
    }
  }

  private defaultAvailability(
    planDate: string,
    preference: UserPreferencesDto,
  ): AvailabilityWindow[] {
    let startAt: string;
    let endAt: string;
    try {
      startAt = utcFromLocalDateTime(
        `${planDate}T${preference.workingDayStart}`,
        preference.timezone,
      );
      endAt = utcFromLocalDateTime(
        `${planDate}T${preference.workingDayEnd}`,
        preference.timezone,
      );
    } catch (error) {
      if (error instanceof LocalTimeResolutionError) {
        throw new ConflictError(
          "Working hours fall in a daylight-saving transition. Update your planning preferences for this date.",
        );
      }
      throw error;
    }
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new ConflictError(
        "Working hours are not a valid same-day availability window.",
      );
    }
    return [{ startAt, endAt }];
  }

  private remainingAvailability(
    planDate: string,
    preference: UserPreferencesDto,
    now?: string,
  ): AvailabilityWindow[] {
    const [window] = this.defaultAvailability(planDate, preference);
    if (!window) return [];
    const remainingStart = Math.max(
      Date.parse(window.startAt),
      Date.parse(now ?? nowIso()),
    );
    const end = Date.parse(window.endAt);
    if (!Number.isFinite(remainingStart) || remainingStart >= end) return [];
    return [
      { startAt: new Date(remainingStart).toISOString(), endAt: window.endAt },
    ];
  }

  private commitmentsFor(
    availability: AvailabilityWindow[],
    userId: string,
  ): FixedCommitment[] {
    const start = availability.map((window) => window.startAt).sort()[0];
    const end = availability
      .map((window) => window.endAt)
      .sort()
      .at(-1);
    if (!start || !end) return [];
    return this.database
      .all<EventRow>(
        `SELECT id, title, start_at, end_at, is_fixed, created_at, updated_at
         FROM calendar_events
         WHERE user_id = ? AND is_fixed = 1 AND start_at < ? AND end_at > ?`,
        [userId, end, start],
      )
      .map((event) => ({
        id: event.id,
        title: event.title,
        startAt: event.start_at,
        endAt: event.end_at,
      }));
  }

  private persist(
    plan: EngineDailyPlan | RecoveryPlan,
    planDate: string,
    readiness: Readiness,
    type: PlanDto["type"],
    userId: string,
    editableSchedule: EditableScheduleContext,
  ): PlanDto {
    const id = randomUUID();
    const context: PlanContext = {
      topPriorities: plan.topPriorities,
      nextAction: plan.nextAction,
      deferred: plan.deferred,
      feasibility: plan.feasibility,
      // Recovery drafts retain their snapshot but deliberately do not expose
      // manual movement; recalculation keeps remaining-day capacity honest.
      ...(type === "daily" ? { editableSchedule } : {}),
      ...(type === "recovery"
        ? { recovery: (plan as RecoveryPlan).recovery }
        : {}),
    };
    this.database.transaction(() => {
      this.database.run(
        "UPDATE daily_plans SET status = 'superseded' WHERE user_id = ? AND plan_date = ? AND status = 'draft'",
        [userId, planDate],
      );
      this.database.run(
        `INSERT INTO daily_plans(
          id, user_id, plan_date, status, type, readiness, generated_at, accepted_at,
          capacity_minutes, scheduled_minutes, context_json
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, NULL, ?, ?, ?)`,
        [
          id,
          userId,
          planDate,
          type,
          readiness,
          plan.generatedAt,
          plan.feasibility.availableMinutes,
          plan.feasibility.scheduledMinutes,
          JSON.stringify(context),
        ],
      );
      for (const block of plan.scheduledBlocks) {
        this.database.run(
          `INSERT INTO scheduled_blocks(id, plan_id, task_id, title, start_at, end_at, duration_minutes, score, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            block.taskId,
            block.title,
            block.startAt,
            block.endAt,
            block.durationMinutes,
            block.score,
            nowIso(),
          ],
        );
      }
    });
    const row = this.database.get<PlanRow>(
      "SELECT * FROM daily_plans WHERE id = ? AND user_id = ?",
      [id, userId],
    );
    if (!row) throw new NotFoundError("Plan was not persisted.");
    return this.rowToPlan(row, userId);
  }

  private rowToPlan(row: PlanRow, userId: string): PlanDto {
    const context = parseContext(row.context_json);
    const preference = this.preferences.get(userId);
    const scheduleContext = editableScheduleContext(context);
    const blocks = this.database.all<BlockRow>(
      `SELECT id, task_id, title, start_at, end_at, duration_minutes, score
       FROM scheduled_blocks WHERE plan_id = ? ORDER BY start_at ASC`,
      [row.id],
    );
    return {
      id: row.id,
      planDate: row.plan_date,
      status: row.status,
      type: row.type,
      readiness: row.readiness,
      generatedAt: row.generated_at,
      acceptedAt: row.accepted_at,
      capacityMinutes: row.capacity_minutes,
      scheduledMinutes: row.scheduled_minutes,
      topPriorities: context.topPriorities,
      nextAction: context.nextAction,
      deferred: context.deferred,
      feasibility: context.feasibility,
      canEditSchedule:
        row.status === "draft" &&
        row.type === "daily" &&
        blocks.length > 0 &&
        scheduleContext !== null &&
        this.schedulePreferencesMatch(scheduleContext, preference),
      scheduleEditedAt: context.scheduleEditedAt ?? null,
      blocks: blocks.map((block) => ({
        id: block.id,
        taskId: block.task_id,
        title: block.title,
        startAt: block.start_at,
        endAt: block.end_at,
        startLocal: localDateTimeFromUtc(block.start_at, preference.timezone),
        endLocal: localDateTimeFromUtc(block.end_at, preference.timezone),
        durationMinutes: block.duration_minutes,
        score: block.score,
      })),
      ...(context.recovery ? { recovery: context.recovery } : {}),
    };
  }
}

export class DashboardService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly plans: PlanRepository,
    private readonly sessions: FocusSessionRepository,
    private readonly preferences: PreferencesRepository,
  ) {}

  get(userId: string): {
    date: string;
    topPriorities: EngineDailyPlan["topPriorities"];
    nextAction: EngineDailyPlan["nextAction"];
    tasks: { total: number; completed: number; active: number };
    plan: PlanDto | null;
    focusSession: FocusSessionDto | null;
  } {
    const preferences = this.preferences.get(userId);
    const allTasks = this.tasks.list(userId);
    const active = allTasks.filter((task) => task.status !== "done");
    const actionable = active.filter((task) => !task.isDecomposed);
    const ranked = rankTasks(actionable.map(asPlanningTask), {
      availableMinutes: 8 * 60,
      now: nowIso(),
      readiness: "steady",
    });
    const plan = this.plans.today(userId);
    return {
      date: localDateFromUtc(nowIso(), preferences.timezone),
      topPriorities: plan?.topPriorities.length
        ? plan.topPriorities
        : ranked.slice(0, 3),
      nextAction: plan?.nextAction ?? ranked[0] ?? null,
      tasks: {
        total: allTasks.length,
        completed: allTasks.filter((task) => task.status === "done").length,
        active: active.length,
      },
      plan,
      focusSession: this.sessions.active(userId),
    };
  }
}
