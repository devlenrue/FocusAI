import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { config } from './config.js';
import { FocusDatabase } from './db/database.js';
import {
  ConflictError,
  DashboardService,
  FocusSessionRepository,
  NotFoundError,
  PlanRepository,
  TaskRepository,
  type TaskStatus,
} from './services/repositories.js';

class ValidationError extends Error {
  constructor(public readonly details: unknown) {
    super('The request does not match the expected format.');
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.flatten());
  return result.data;
}

const taskStatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'done']);
const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const cognitiveLoadSchema = z.enum(['low', 'medium', 'high']);
const isoSchema = z.string().datetime({ offset: true });
const taskIdSchema = z.object({ taskId: z.string().uuid() });
const focusIdSchema = z.object({ sessionId: z.string().uuid() });
const planIdSchema = z.object({ planId: z.string().uuid() });

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullable().optional().default(null),
  status: taskStatusSchema.optional().default('todo'),
  priority: prioritySchema.optional().default('medium'),
  impact: z.number().int().min(1).max(5).optional().default(3),
  estimateMinutes: z.number().int().min(1).max(720).optional().default(30),
  dueAt: isoSchema.nullable().optional().default(null),
  cognitiveLoad: cognitiveLoadSchema.optional().default('medium'),
  goalAlignment: z.number().min(0).max(1).optional().default(0),
  blocked: z.boolean().optional().default(false),
  dependencies: z.array(z.string().uuid()).max(50).optional().default([]),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  actualMinutes: z.number().int().min(0).max(10_080).optional(),
});

const planRequestSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  readiness: z.enum(['low', 'steady', 'high']).optional().default('steady'),
  now: isoSchema.optional(),
  availability: z
    .array(z.object({ startAt: isoSchema, endAt: isoSchema }))
    .min(1)
    .max(8)
    .optional(),
  recovery: z.boolean().optional().default(false),
});

const focusStartSchema = z.object({
  taskId: z.string().uuid().nullable().optional().default(null),
  plannedMinutes: z.number().int().min(1).max(240).optional().default(25),
  note: z.string().trim().max(2_000).nullable().optional().default(null),
});

const focusActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'complete', 'stop']),
});

export interface AppDependencies {
  database?: FocusDatabase;
}

export async function buildApp(dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    requestIdHeader: 'x-request-id',
  });
  const database = dependencies.database ?? new FocusDatabase(config.databasePath);
  const tasks = new TaskRepository(database);
  const sessions = new FocusSessionRepository(database, tasks);
  const plans = new PlanRepository(database, tasks);
  const dashboard = new DashboardService(tasks, plans, sessions);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: false,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FocusAI local development API',
        description:
          'Versioned API for the first FocusAI vertical slice. Authentication is intentionally not implemented in this local-development increment.',
        version: '0.1.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'focusai-api',
    mode: 'local-development',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/meta', async () => ({
    mode: 'local-development',
    authentication: 'not-implemented',
    persistence: 'local-sqlite',
    warning: 'This first increment is a single local workspace and is not a hosted multi-user deployment.',
  }));

  app.get('/api/v1/dashboard', async () => dashboard.get());

  app.get('/api/v1/tasks', async (request) => {
    const query = parse(
      z.object({
        status: taskStatusSchema.optional(),
        q: z.string().trim().max(120).optional(),
      }),
      request.query,
    );
    return { items: tasks.list(undefined, { status: query.status as TaskStatus | undefined, search: query.q }) };
  });

  app.post('/api/v1/tasks', async (request, reply) => {
    const body = parse(taskCreateSchema, request.body);
    const created = tasks.create(body);
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/tasks/:taskId', async (request) => {
    const { taskId } = parse(taskIdSchema, request.params);
    const body = parse(taskUpdateSchema, request.body);
    return tasks.update(taskId, body);
  });

  app.post('/api/v1/tasks/:taskId/complete', async (request) => {
    const { taskId } = parse(taskIdSchema, request.params);
    const body = parse(z.object({ actualMinutes: z.number().int().min(0).max(10_080).optional() }), request.body);
    return tasks.complete(taskId, body.actualMinutes);
  });

  app.delete('/api/v1/tasks/:taskId', async (request, reply) => {
    const { taskId } = parse(taskIdSchema, request.params);
    tasks.delete(taskId);
    return reply.code(204).send();
  });

  app.get('/api/v1/plans', async (request) => {
    const { planDate } = parse(
      z.object({ planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      request.query,
    );
    const date = planDate ?? new Date().toISOString().slice(0, 10);
    return { plan: plans.latestForDate(date) };
  });

  app.post('/api/v1/plans/generate', async (request, reply) => {
    const body = parse(planRequestSchema, request.body);
    const plan = plans.generate(body);
    return reply.code(201).send(plan);
  });

  app.post('/api/v1/plans/:planId/accept', async (request) => {
    const { planId } = parse(planIdSchema, request.params);
    return plans.accept(planId);
  });

  app.get('/api/v1/focus-sessions', async () => ({ items: sessions.list() }));
  app.get('/api/v1/focus-sessions/active', async () => ({ session: sessions.active() }));

  app.post('/api/v1/focus-sessions', async (request, reply) => {
    const body = parse(focusStartSchema, request.body);
    const session = sessions.start(body);
    return reply.code(201).send(session);
  });

  app.post('/api/v1/focus-sessions/:sessionId/transition', async (request) => {
    const { sessionId } = parse(focusIdSchema, request.params);
    const { action } = parse(focusActionSchema, request.body);
    return sessions.transition(sessionId, action);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route matches ${request.method} ${request.url}.`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError || error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please review the highlighted request values.',
          requestId: request.id,
          details: error instanceof ValidationError ? error.details : error.flatten(),
        },
      });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: error.message, requestId: request.id } });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: error.message, requestId: request.id } });
    }
    request.log.error({ err: error, requestId: request.id }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed safely.',
        requestId: request.id,
      },
    });
  });

  app.addHook('onClose', async () => {
    if (!dependencies.database) database.close();
  });

  return app;
}
