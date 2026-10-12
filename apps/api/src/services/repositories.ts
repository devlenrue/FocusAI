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

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";

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
  goalAlignment: number;
  blocked: boolean;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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
  blocks: Array<{
    id: string;
    taskId: string | null;
    title: string;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    score: number;
  }>;
  recovery?: RecoveryPlan["recovery"];
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
  blocked: number;
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
}

interface PlanContext {
  topPriorities: EngineDailyPlan["topPriorities"];
  nextAction: EngineDailyPlan["nextAction"];
  deferred: EngineDailyPlan["deferred"];
  feasibility: EngineDailyPlan["feasibility"];
  recovery?: RecoveryPlan["recovery"];
}

function nowIso(): string {
  return new Date().toISOString();
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
    blocked: row.blocked === 1,
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

function isoDateToday(): string {
  return nowIso().slice(0, 10);
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

export class TaskRepository {
  constructor(private readonly database: FocusDatabase) {}

  list(
    userId: string,
    filters: { status?: TaskStatus; search?: string } = {},
  ): TaskDto[] {
    const where = ["user_id = ?"];
    const parameters: Array<string | number | null> = [userId];
    if (filters.status) {
      where.push("status = ?");
      parameters.push(filters.status);
    }
    if (filters.search) {
      where.push(
        "(title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)",
      );
      const term = `%${filters.search.trim()}%`;
      parameters.push(term, term);
    }
    const rows = this.database.all<TaskRow>(
      `SELECT id, title, description, status, priority, impact, estimate_minutes, actual_minutes,
              due_at, cognitive_load, goal_alignment, blocked, created_at, updated_at, completed_at
       FROM tasks WHERE ${where.join(" AND ")}
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'backlog' THEN 2 ELSE 3 END,
                due_at IS NULL, due_at ASC, updated_at DESC`,
      parameters,
    );
    return rows.map((row) => rowToTask(row, this.dependenciesForTask(row.id)));
  }

  get(taskId: string, userId: string): TaskDto {
    const row = this.database.get<TaskRow>(
      `SELECT id, title, description, status, priority, impact, estimate_minutes, actual_minutes,
              due_at, cognitive_load, goal_alignment, blocked, created_at, updated_at, completed_at
       FROM tasks WHERE id = ? AND user_id = ?`,
      [taskId, userId],
    );
    if (!row) throw new NotFoundError("Task not found.");
    return rowToTask(row, this.dependenciesForTask(row.id));
  }

  create(
    input: Omit<
      TaskDto,
      "id" | "actualMinutes" | "createdAt" | "updatedAt" | "completedAt"
    >,
    userId: string,
  ): TaskDto {
    const id = randomUUID();
    const now = nowIso();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO tasks(
          id, user_id, title, description, status, priority, impact, estimate_minutes, actual_minutes,
          due_at, cognitive_load, goal_alignment, blocked, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.blocked ? 1 : 0,
          now,
          now,
          input.status === "done" ? now : null,
        ],
      );
      this.replaceDependencies(id, input.dependencies, userId, now);
    });
    return this.get(id, userId);
  }

  update(
    taskId: string,
    input: Partial<
      Omit<
        TaskDto,
        "id" | "actualMinutes" | "createdAt" | "updatedAt" | "completedAt"
      >
    > & {
      actualMinutes?: number;
    },
    userId: string,
  ): TaskDto {
    this.get(taskId, userId);
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
    const uniqueDependencyIds = [...new Set(dependencyIds)].filter(
      (dependencyId) => dependencyId !== taskId,
    );
    for (const dependencyId of uniqueDependencyIds) {
      this.get(dependencyId, userId);
    }
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
    if (input.taskId) this.tasks.get(input.taskId, userId);
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
    const preference = this.preferences(userId);
    const availability = input.availability?.length
      ? input.availability
      : input.recovery
        ? this.remainingAvailability(input.planDate, preference, input.now)
        : this.defaultAvailability(input.planDate, preference);
    const commitments = this.commitmentsFor(availability, userId);
    const tasks = this.tasks.list(userId).map(asPlanningTask);
    const options = {
      tasks,
      availability,
      commitments,
      now: input.now ?? nowIso(),
      readiness: input.readiness,
      preferences: {
        transitionMinutes: preference.transition_minutes,
        highCognitiveRecoveryCapRatio: preference.high_cognitive_recovery_cap,
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
    return row ? this.rowToPlan(row) : null;
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
    return this.rowToPlan({ ...row, status: "accepted", accepted_at: now });
  }

  today(userId: string): PlanDto | null {
    return this.latestForDate(isoDateToday(), userId);
  }

  private preferences(userId: string): PreferenceRow {
    const row = this.database.get<PreferenceRow>(
      `SELECT timezone, working_day_start, working_day_end, transition_minutes, high_cognitive_recovery_cap
       FROM user_preferences WHERE user_id = ?`,
      [userId],
    );
    if (!row) throw new NotFoundError("User preferences not found.");
    return row;
  }

  private defaultAvailability(
    planDate: string,
    preference: PreferenceRow,
  ): AvailabilityWindow[] {
    const startAt = `${planDate}T${preference.working_day_start}:00.000Z`;
    const endAt = `${planDate}T${preference.working_day_end}:00.000Z`;
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new ConflictError(
        "Working hours are not a valid availability window.",
      );
    }
    return [{ startAt, endAt }];
  }

  private remainingAvailability(
    planDate: string,
    preference: PreferenceRow,
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
        `SELECT id, title, start_at, end_at FROM calendar_events
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
  ): PlanDto {
    const id = randomUUID();
    const context: PlanContext = {
      topPriorities: plan.topPriorities,
      nextAction: plan.nextAction,
      deferred: plan.deferred,
      feasibility: plan.feasibility,
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
    return this.rowToPlan(row);
  }

  private rowToPlan(row: PlanRow): PlanDto {
    const context = parseContext(row.context_json);
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
      blocks: blocks.map((block) => ({
        id: block.id,
        taskId: block.task_id,
        title: block.title,
        startAt: block.start_at,
        endAt: block.end_at,
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
  ) {}

  get(userId: string): {
    date: string;
    topPriorities: EngineDailyPlan["topPriorities"];
    nextAction: EngineDailyPlan["nextAction"];
    tasks: { total: number; completed: number; active: number };
    plan: PlanDto | null;
    focusSession: FocusSessionDto | null;
  } {
    const allTasks = this.tasks.list(userId);
    const active = allTasks.filter((task) => task.status !== "done");
    const ranked = rankTasks(active.map(asPlanningTask), {
      availableMinutes: 8 * 60,
      now: nowIso(),
      readiness: "steady",
    });
    const plan = this.plans.today(userId);
    return {
      date: isoDateToday(),
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
