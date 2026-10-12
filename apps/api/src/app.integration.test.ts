import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FocusDatabase } from './db/database.js';

let database: FocusDatabase;
let cleanupDirectory = '';
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  cleanupDirectory = mkdtempSync(join(tmpdir(), 'focusai-api-'));
  database = new FocusDatabase(join(cleanupDirectory, 'focusai.db'));
  app = await buildApp({ database });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  database.close();
  rmSync(cleanupDirectory, { recursive: true, force: true });
});

describe('FocusAI API vertical slice', () => {
  it('persists a task, generates a conflict-free plan, and records timestamp-backed focus transitions', async () => {
    const createTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Prepare the release brief',
        priority: 'high',
        impact: 5,
        estimateMinutes: 30,
        cognitiveLoad: 'medium',
      },
    });
    expect(createTask.statusCode).toBe(201);
    const task = createTask.json() as { id: string; title: string };
    expect(task.title).toBe('Prepare the release brief');

    const dashboard = await app.inject({ method: 'GET', url: '/api/v1/dashboard' });
    expect(dashboard.statusCode).toBe(200);
    expect((dashboard.json() as { topPriorities: Array<{ task: { id: string } }> }).topPriorities[0]?.task.id).toBe(task.id);

    const generatedPlan = await app.inject({
      method: 'POST',
      url: '/api/v1/plans/generate',
      payload: {
        planDate: '2026-10-12',
        readiness: 'steady',
        now: '2026-10-12T08:00:00.000Z',
        availability: [{ startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T10:00:00.000Z' }],
      },
    });
    expect(generatedPlan.statusCode).toBe(201);
    const plan = generatedPlan.json() as { id: string; blocks: Array<{ taskId: string; startAt: string; endAt: string }> };
    expect(plan.blocks).toEqual([
      expect.objectContaining({ taskId: task.id, startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:30:00.000Z' }),
    ]);

    const acceptedPlan = await app.inject({ method: 'POST', url: `/api/v1/plans/${plan.id}/accept` });
    expect(acceptedPlan.statusCode).toBe(200);
    expect((acceptedPlan.json() as { status: string }).status).toBe('accepted');

    const recoveryPlan = await app.inject({
      method: 'POST',
      url: '/api/v1/plans/generate',
      payload: {
        planDate: '2026-10-12',
        readiness: 'steady',
        now: '2026-10-12T16:00:00.000Z',
        recovery: true,
      },
    });
    expect(recoveryPlan.statusCode).toBe(201);
    const recovery = recoveryPlan.json() as { id: string; type: string; capacityMinutes: number };
    expect(recovery.type).toBe('recovery');
    expect(recovery.capacityMinutes).toBe(120);

    const latestPlan = await app.inject({ method: 'GET', url: '/api/v1/plans?planDate=2026-10-12' });
    expect((latestPlan.json() as { plan: { id: string; status: string } }).plan).toMatchObject({ id: recovery.id, status: 'draft' });

    const startFocus = await app.inject({
      method: 'POST',
      url: '/api/v1/focus-sessions',
      payload: { taskId: task.id, plannedMinutes: 25 },
    });
    expect(startFocus.statusCode).toBe(201);
    const session = startFocus.json() as { id: string; state: string };
    expect(session.state).toBe('active');

    const secondStart = await app.inject({
      method: 'POST',
      url: '/api/v1/focus-sessions',
      payload: { taskId: task.id, plannedMinutes: 25 },
    });
    expect(secondStart.statusCode).toBe(409);

    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/focus-sessions/${session.id}/transition`,
      payload: { action: 'pause' },
    });
    expect(pause.statusCode).toBe(200);
    expect((pause.json() as { state: string; accumulatedSeconds: number }).state).toBe('paused');

    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/focus-sessions/${session.id}/transition`,
      payload: { action: 'complete' },
    });
    expect(complete.statusCode).toBe(200);
    expect((complete.json() as { state: string; completedAt: string | null }).state).toBe('completed');
    expect((complete.json() as { state: string; completedAt: string | null }).completedAt).toBeTruthy();
  });

  it('rejects malformed task input with a consistent validation response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: '', estimateMinutes: -20 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
