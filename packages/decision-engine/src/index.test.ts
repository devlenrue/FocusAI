import { describe, expect, it } from 'vitest';
import { generateDailyPlan, generateRecoveryPlan, rankTasks, type PlanningTask } from './index';

const workday = [{ startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T12:00:00.000Z' }];

function task(overrides: Partial<PlanningTask> & Pick<PlanningTask, 'id' | 'title'>): PlanningTask {
  return {
    priority: 'medium',
    impact: 3,
    estimateMinutes: 30,
    cognitiveLoad: 'medium',
    ...overrides,
  };
}

describe('rankTasks', () => {
  it('prioritises an overdue, high-impact task over a low-impact task without a deadline', () => {
    const ranked = rankTasks(
      [
        task({ id: 'later', title: 'Tidy backlog', priority: 'low', impact: 1 }),
        task({
          id: 'urgent',
          title: 'Send decision memo',
          priority: 'high',
          impact: 5,
          dueAt: '2026-10-11T12:00:00.000Z',
        }),
      ],
      { now: '2026-10-12T08:00:00.000Z', availableMinutes: 180 },
    );

    expect(ranked.map((item) => item.task.id)).toEqual(['urgent', 'later']);
    expect(ranked[0]?.reasons.map((reason) => reason.code)).toContain('overdue');
  });
});

describe('generateDailyPlan', () => {
  it('does not overlap a fixed commitment and explicitly defers work that cannot fit', () => {
    const plan = generateDailyPlan({
      now: '2026-10-12T08:00:00.000Z',
      availability: workday,
      commitments: [
        {
          id: 'meeting',
          title: 'Team sync',
          startAt: '2026-10-12T10:00:00.000Z',
          endAt: '2026-10-12T11:00:00.000Z',
        },
      ],
      preferences: { transitionMinutes: 0 },
      tasks: [
        task({ id: 'first', title: 'Prepare brief', estimateMinutes: 60, priority: 'critical', impact: 5 }),
        task({ id: 'second', title: 'Deep review', estimateMinutes: 90, priority: 'high', impact: 4 }),
      ],
    });

    expect(plan.feasibility.availableMinutes).toBe(120);
    expect(plan.scheduledBlocks).toHaveLength(1);
    expect(plan.scheduledBlocks[0]?.startAt).toBe('2026-10-12T09:00:00.000Z');
    expect(plan.scheduledBlocks[0]?.endAt).toBe('2026-10-12T10:00:00.000Z');
    expect(plan.deferred).toEqual([
      expect.objectContaining({ taskId: 'second', reason: 'capacity' }),
    ]);
  });

  it('keeps dependent work after its dependency even when the dependent task scores higher', () => {
    const plan = generateDailyPlan({
      now: '2026-10-12T08:00:00.000Z',
      availability: workday,
      preferences: { transitionMinutes: 0 },
      tasks: [
        task({
          id: 'deliver',
          title: 'Deliver release',
          priority: 'critical',
          impact: 5,
          dependencies: ['prepare'],
        }),
        task({ id: 'prepare', title: 'Prepare release', priority: 'low', impact: 1 }),
      ],
    });

    expect(plan.scheduledBlocks.map((block) => block.taskId)).toEqual(['prepare', 'deliver']);
    expect(plan.scheduledBlocks[0]?.endAt).toBe(plan.scheduledBlocks[1]?.startAt);
  });
});

describe('generateRecoveryPlan', () => {
  it('applies the configurable high-cognitive recovery cap only in recovery mode', () => {
    const plan = generateRecoveryPlan({
      now: '2026-10-12T08:00:00.000Z',
      availability: [{ startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T10:40:00.000Z' }],
      preferences: { transitionMinutes: 0, highCognitiveRecoveryCapRatio: 0.2 },
      tasks: [
        task({ id: 'deep', title: 'Complex architecture', estimateMinutes: 30, cognitiveLoad: 'high', priority: 'critical', impact: 5 }),
        task({ id: 'small', title: 'Send update', estimateMinutes: 20, cognitiveLoad: 'low', priority: 'high', impact: 4 }),
      ],
    });

    expect(plan.recovery.remainingCapacityMinutes).toBe(100);
    expect(plan.recovery.highCognitiveCapMinutes).toBe(20);
    expect(plan.scheduledBlocks.map((block) => block.taskId)).toEqual(['small']);
    expect(plan.deferred).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: 'deep', reason: 'recovery-cognitive-cap' })]),
    );
  });
});
