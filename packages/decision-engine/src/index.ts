/**
 * FocusAI's deterministic planning core.
 *
 * This package deliberately contains no database, HTTP, or LLM code. That keeps
 * feasibility and prioritisation explainable, testable, and available when an
 * optional AI provider is unavailable.
 */

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type CognitiveLoad = 'low' | 'medium' | 'high';
export type Readiness = 'low' | 'steady' | 'high';

export interface PlanningTask {
  id: string;
  title: string;
  priority: Priority;
  impact: number;
  estimateMinutes: number;
  dueAt?: string | null;
  goalAlignment?: number;
  cognitiveLoad?: CognitiveLoad;
  dependencies?: string[];
  completed?: boolean;
  blocked?: boolean;
}

export interface FixedCommitment {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

export interface AvailabilityWindow {
  startAt: string;
  endAt: string;
}

export interface ScoringWeights {
  urgency: number;
  priority: number;
  impact: number;
  goalAlignment: number;
  effortFit: number;
  readiness: number;
}

export interface PlanningPreferences {
  transitionMinutes?: number;
  minimumFocusBlockMinutes?: number;
  scoringWeights?: Partial<ScoringWeights>;
  highCognitiveRecoveryCapRatio?: number;
}

export interface ScoreReason {
  code:
    | 'overdue'
    | 'due-soon'
    | 'high-priority'
    | 'high-impact'
    | 'goal-aligned'
    | 'effort-fit'
    | 'readiness-fit';
  message: string;
}

export interface ScoredTask {
  task: PlanningTask;
  score: number;
  reasons: ScoreReason[];
}

export interface ScheduledBlock {
  id: string;
  taskId: string;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  score: number;
}

export interface DeferredTask {
  taskId: string;
  title: string;
  reason:
    | 'blocked'
    | 'dependency'
    | 'capacity'
    | 'recovery-cognitive-cap';
  detail: string;
}

export interface Feasibility {
  availableMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  isFeasible: boolean;
}

export interface DailyPlan {
  generatedAt: string;
  topPriorities: ScoredTask[];
  nextAction: ScoredTask | null;
  scheduledBlocks: ScheduledBlock[];
  deferred: DeferredTask[];
  feasibility: Feasibility;
}

export interface RecoveryPlan extends DailyPlan {
  recovery: {
    remainingCapacityMinutes: number;
    highCognitiveCapMinutes: number;
    highCognitiveScheduledMinutes: number;
    message: string;
  };
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  urgency: 0.31,
  priority: 0.24,
  impact: 0.18,
  goalAlignment: 0.12,
  effortFit: 0.09,
  readiness: 0.06,
};

const PRIORITY_VALUES: Record<Priority, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.78,
  critical: 1,
};

const READINESS_VALUES: Record<Readiness, Record<CognitiveLoad, number>> = {
  low: { low: 1, medium: 0.55, high: 0.2 },
  steady: { low: 0.72, medium: 1, high: 0.78 },
  high: { low: 0.55, medium: 0.82, high: 1 },
};

interface Interval {
  start: number;
  end: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function toMillis(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) / 60_000));
}

function normaliseImpact(impact: number): number {
  return clamp((impact - 1) / 4);
}

function urgencyFor(task: PlanningTask, now: number): number {
  if (!task.dueAt) return 0.15;
  const due = toMillis(task.dueAt);
  if (due === null) return 0.15;

  const hours = (due - now) / 3_600_000;
  if (hours <= 0) return 1;
  if (hours <= 8) return 0.97;
  if (hours <= 24) return 0.88;
  if (hours <= 72) return 0.7;
  if (hours <= 168) return 0.42;
  return 0.18;
}

function effortFitFor(task: PlanningTask, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0;
  if (task.estimateMinutes <= availableMinutes * 0.25) return 1;
  if (task.estimateMinutes <= availableMinutes * 0.5) return 0.75;
  if (task.estimateMinutes <= availableMinutes) return 0.48;
  return 0.12;
}

function readinessFitFor(task: PlanningTask, readiness: Readiness): number {
  return READINESS_VALUES[readiness][task.cognitiveLoad ?? 'medium'];
}

function scoreReasons(
  task: PlanningTask,
  now: number,
  availableMinutes: number,
  readiness: Readiness,
): ScoreReason[] {
  const reasons: ScoreReason[] = [];
  const due = task.dueAt ? toMillis(task.dueAt) : null;
  const hoursToDue = due === null ? null : (due - now) / 3_600_000;

  if (hoursToDue !== null && hoursToDue <= 0) {
    reasons.push({ code: 'overdue', message: 'Its deadline has passed, so it needs a deliberate decision today.' });
  } else if (hoursToDue !== null && hoursToDue <= 24) {
    reasons.push({ code: 'due-soon', message: 'Its deadline is within the next day.' });
  }
  if (task.priority === 'high' || task.priority === 'critical') {
    reasons.push({ code: 'high-priority', message: 'You marked this as a high priority.' });
  }
  if (task.impact >= 4) {
    reasons.push({ code: 'high-impact', message: 'It has a high expected impact.' });
  }
  if ((task.goalAlignment ?? 0) >= 0.7) {
    reasons.push({ code: 'goal-aligned', message: 'It strongly supports an active goal.' });
  }
  if (effortFitFor(task, availableMinutes) >= 0.75) {
    reasons.push({ code: 'effort-fit', message: 'Its size fits well within the available capacity.' });
  }
  if (readinessFitFor(task, readiness) >= 0.9) {
    reasons.push({ code: 'readiness-fit', message: 'It matches the energy level you selected.' });
  }

  return reasons;
}

function coerceWeights(overrides?: Partial<ScoringWeights>): ScoringWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...overrides };
  const sum = Object.values(merged).reduce((total, weight) => total + weight, 0);
  if (sum <= 0) return DEFAULT_WEIGHTS;

  return {
    urgency: merged.urgency / sum,
    priority: merged.priority / sum,
    impact: merged.impact / sum,
    goalAlignment: merged.goalAlignment / sum,
    effortFit: merged.effortFit / sum,
    readiness: merged.readiness / sum,
  };
}

/** Scores active tasks using transparent, configurable weights. */
export function rankTasks(
  tasks: PlanningTask[],
  options: {
    now?: string;
    availableMinutes: number;
    readiness?: Readiness;
    weights?: Partial<ScoringWeights>;
  },
): ScoredTask[] {
  const now = options.now ? toMillis(options.now) ?? Date.now() : Date.now();
  const readiness = options.readiness ?? 'steady';
  const weights = coerceWeights(options.weights);

  return tasks
    .filter((task) => !task.completed)
    .map((task) => {
      const score =
        urgencyFor(task, now) * weights.urgency +
        PRIORITY_VALUES[task.priority] * weights.priority +
        normaliseImpact(task.impact) * weights.impact +
        clamp(task.goalAlignment ?? 0) * weights.goalAlignment +
        effortFitFor(task, options.availableMinutes) * weights.effortFit +
        readinessFitFor(task, readiness) * weights.readiness;

      return {
        task,
        score: Math.round(score * 1000) / 1000,
        reasons: scoreReasons(task, now, options.availableMinutes, readiness),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDue = left.task.dueAt ? toMillis(left.task.dueAt) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const rightDue = right.task.dueAt ? toMillis(right.task.dueAt) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return left.task.title.localeCompare(right.task.title);
    });
}

function subtractInterval(intervals: Interval[], excluded: Interval): Interval[] {
  return intervals.flatMap((interval) => {
    if (excluded.end <= interval.start || excluded.start >= interval.end) return [interval];

    const remaining: Interval[] = [];
    if (excluded.start > interval.start) {
      remaining.push({ start: interval.start, end: Math.min(excluded.start, interval.end) });
    }
    if (excluded.end < interval.end) {
      remaining.push({ start: Math.max(excluded.end, interval.start), end: interval.end });
    }
    return remaining;
  });
}

function usableIntervals(windows: AvailabilityWindow[], commitments: FixedCommitment[]): Interval[] {
  const commitmentsAsIntervals = commitments
    .map((commitment) => {
      const start = toMillis(commitment.startAt);
      const end = toMillis(commitment.endAt);
      return start !== null && end !== null && end > start ? { start, end } : null;
    })
    .filter((interval): interval is Interval => interval !== null);

  return windows
    .map((window) => {
      const start = toMillis(window.startAt);
      const end = toMillis(window.endAt);
      return start !== null && end !== null && end > start ? { start, end } : null;
    })
    .filter((interval): interval is Interval => interval !== null)
    .flatMap((window) => commitmentsAsIntervals.reduce(subtractInterval, [window]))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
}

function totalCapacity(intervals: Interval[]): number {
  return intervals.reduce((total, interval) => total + minutesBetween(interval.start, interval.end), 0);
}

function dependencyEnd(task: PlanningTask, endsByTaskId: Map<string, number>): number {
  return (task.dependencies ?? []).reduce((latest, dependencyId) => Math.max(latest, endsByTaskId.get(dependencyId) ?? 0), 0);
}

function findSlot(intervals: Interval[], durationMinutes: number, after: number): { start: number; end: number; index: number } | null {
  const duration = durationMinutes * 60_000;
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (!interval) continue;
    const start = Math.max(interval.start, after);
    const end = start + duration;
    if (end <= interval.end) return { start, end, index };
  }
  return null;
}

function consumeSlot(intervals: Interval[], index: number, taskEnd: number, transitionMinutes: number): Interval[] {
  const interval = intervals[index];
  if (!interval) return intervals;
  const protectedStart = taskEnd + transitionMinutes * 60_000;
  const remaining = protectedStart < interval.end ? { start: protectedStart, end: interval.end } : null;
  return intervals.flatMap((candidate, candidateIndex) => {
    if (candidateIndex !== index) return [candidate];
    return remaining ? [remaining] : [];
  });
}

function plannedBlockId(taskId: string, start: number): string {
  return `block-${taskId}-${start}`;
}

/**
 * Generates a non-overlapping plan. It schedules only whole tasks; tasks that
 * do not fit are explicitly deferred rather than being silently overbooked.
 */
export function generateDailyPlan(input: {
  tasks: PlanningTask[];
  availability: AvailabilityWindow[];
  commitments?: FixedCommitment[];
  now?: string;
  readiness?: Readiness;
  preferences?: PlanningPreferences;
}): DailyPlan {
  const preferences = input.preferences ?? {};
  const transitionMinutes = Math.max(0, preferences.transitionMinutes ?? 10);
  const minimumFocusBlockMinutes = Math.max(1, preferences.minimumFocusBlockMinutes ?? 5);
  let intervals = usableIntervals(input.availability, input.commitments ?? []);
  const availableMinutes = totalCapacity(intervals);
  const ranked = rankTasks(input.tasks, {
    now: input.now,
    availableMinutes,
    readiness: input.readiness,
    weights: preferences.scoringWeights,
  });
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const scheduledTaskIds = new Set<string>();
  const endsByTaskId = new Map<string, number>();
  const scheduledBlocks: ScheduledBlock[] = [];
  const deferred: DeferredTask[] = [];

  // A dependent task may rank above its prerequisite. Make successive passes so
  // prerequisites are placed first instead of treating that ordering as a failure.
  let pending = [...ranked];
  while (pending.length > 0) {
    let madeProgress = false;
    const nextPending: ScoredTask[] = [];

    for (const item of pending) {
      const { task } = item;
      if (task.blocked) {
        deferred.push({ taskId: task.id, title: task.title, reason: 'blocked', detail: 'This task is marked as blocked.' });
        continue;
      }

      const dependencies = task.dependencies ?? [];
      const hasImpossibleDependency = dependencies.some((dependencyId) => {
        const dependency = taskById.get(dependencyId);
        return !dependency || dependency.blocked === true;
      });
      if (hasImpossibleDependency) {
        deferred.push({
          taskId: task.id,
          title: task.title,
          reason: 'dependency',
          detail: 'A required dependency is missing or currently blocked.',
        });
        continue;
      }

      const waitsForDependency = dependencies.some((dependencyId) => {
        const dependency = taskById.get(dependencyId);
        return dependency && !dependency.completed && !scheduledTaskIds.has(dependencyId);
      });
      if (waitsForDependency) {
        nextPending.push(item);
        continue;
      }

      const durationMinutes = Math.max(minimumFocusBlockMinutes, Math.round(task.estimateMinutes));
      const slot = findSlot(intervals, durationMinutes, dependencyEnd(task, endsByTaskId));
      if (!slot) {
        deferred.push({
          taskId: task.id,
          title: task.title,
          reason: 'capacity',
          detail: 'It does not fit in the remaining available time without creating a conflict.',
        });
        continue;
      }

      scheduledBlocks.push({
        id: plannedBlockId(task.id, slot.start),
        taskId: task.id,
        title: task.title,
        startAt: new Date(slot.start).toISOString(),
        endAt: new Date(slot.end).toISOString(),
        durationMinutes,
        score: item.score,
      });
      scheduledTaskIds.add(task.id);
      endsByTaskId.set(task.id, slot.end);
      intervals = consumeSlot(intervals, slot.index, slot.end, transitionMinutes);
      madeProgress = true;
    }

    if (!madeProgress && nextPending.length > 0) {
      deferred.push(
        ...nextPending.map((item) => ({
          taskId: item.task.id,
          title: item.task.title,
          reason: 'dependency' as const,
          detail: 'Its dependencies form a cycle or could not be scheduled before it.',
        })),
      );
      break;
    }
    pending = nextPending;
  }

  const scheduledMinutes = scheduledBlocks.reduce((total, block) => total + block.durationMinutes, 0);
  const activeMinutes = ranked.reduce((total, item) => total + Math.max(0, Math.round(item.task.estimateMinutes)), 0);

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    topPriorities: ranked.filter((item) => !item.task.blocked).slice(0, 3),
    nextAction: scheduledBlocks[0] ? ranked.find((item) => item.task.id === scheduledBlocks[0]?.taskId) ?? null : null,
    scheduledBlocks,
    deferred,
    feasibility: {
      availableMinutes,
      scheduledMinutes,
      unscheduledMinutes: Math.max(0, activeMinutes - scheduledMinutes),
      isFeasible: deferred.length === 0,
    },
  };
}

/**
 * Builds a recovery plan after a missed block. The configurable cognitive cap
 * is a recovery guardrail, not a judgement of a person's ability. It defaults
 * to 20% of real remaining capacity and only applies in recovery mode.
 */
export function generateRecoveryPlan(input: {
  tasks: PlanningTask[];
  availability: AvailabilityWindow[];
  commitments?: FixedCommitment[];
  now?: string;
  readiness?: Readiness;
  preferences?: PlanningPreferences;
}): RecoveryPlan {
  const intervals = usableIntervals(input.availability, input.commitments ?? []);
  const remainingCapacityMinutes = totalCapacity(intervals);
  const capRatio = clamp(input.preferences?.highCognitiveRecoveryCapRatio ?? 0.2);
  const highCognitiveCapMinutes = Math.floor(remainingCapacityMinutes * capRatio);
  const ranked = rankTasks(input.tasks, {
    now: input.now,
    availableMinutes: remainingCapacityMinutes,
    readiness: input.readiness,
    weights: input.preferences?.scoringWeights,
  });

  let highCognitiveCommitted = 0;
  const eligible: PlanningTask[] = [];
  const cognitiveDeferred: DeferredTask[] = [];
  for (const item of ranked) {
    const task = item.task;
    const isHighCognitive = task.cognitiveLoad === 'high';
    const estimate = Math.max(0, Math.round(task.estimateMinutes));
    if (isHighCognitive && highCognitiveCommitted + estimate > highCognitiveCapMinutes) {
      cognitiveDeferred.push({
        taskId: task.id,
        title: task.title,
        reason: 'recovery-cognitive-cap',
        detail: `Recovery mode reserves at most ${highCognitiveCapMinutes} minutes of the remaining capacity for high-cognitive-load work.`,
      });
      continue;
    }
    eligible.push(task);
    if (isHighCognitive) highCognitiveCommitted += estimate;
  }

  const plan = generateDailyPlan({
    ...input,
    tasks: eligible,
    preferences: input.preferences,
  });
  const highCognitiveScheduledMinutes = plan.scheduledBlocks
    .filter((block) => eligible.find((task) => task.id === block.taskId)?.cognitiveLoad === 'high')
    .reduce((total, block) => total + block.durationMinutes, 0);

  return {
    ...plan,
    deferred: [...plan.deferred, ...cognitiveDeferred],
    recovery: {
      remainingCapacityMinutes,
      highCognitiveCapMinutes,
      highCognitiveScheduledMinutes,
      message:
        plan.scheduledBlocks.length > 0
          ? 'The plan protects your remaining capacity and starts with the smallest useful scheduled action.'
          : 'There is not a realistic block left today. Nothing was forced into an already full schedule.',
    },
  };
}
