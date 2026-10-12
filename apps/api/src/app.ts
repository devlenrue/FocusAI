import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { ZodError, z } from "zod";
import { config } from "./config.js";
import { FocusDatabase } from "./db/database.js";
import {
  AuthService,
  ForbiddenError,
  type AuthContext,
  UnauthorizedError,
} from "./services/auth.js";
import {
  CalendarEventRepository,
  ConflictError,
  DashboardService,
  FocusSessionRepository,
  NotFoundError,
  PlanRepository,
  PreferencesRepository,
  TaskRepository,
  type TaskStatus,
  type UserPreferencesDto,
} from "./services/repositories.js";
import {
  canonicalTimeZone,
  isValidCalendarDate,
  isValidLocalDateTime,
  isValidTimeZone,
} from "./services/time.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

class ValidationError extends Error {
  constructor(public readonly details: unknown) {
    super("The request does not match the expected format.");
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.flatten());
  return result.data;
}

function sessionCookieOptions(httpOnly: boolean) {
  return {
    path: "/",
    httpOnly,
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    maxAge: config.sessionTtlSeconds,
  };
}

function issueCookies(
  reply: FastifyReply,
  session: { token: string; csrfToken: string },
): void {
  reply.setCookie(
    config.sessionCookieName,
    session.token,
    sessionCookieOptions(true),
  );
  reply.setCookie(
    config.csrfCookieName,
    session.csrfToken,
    sessionCookieOptions(false),
  );
}

function clearCookies(reply: FastifyReply): void {
  reply.clearCookie(config.sessionCookieName, sessionCookieOptions(true));
  reply.clearCookie(config.csrfCookieName, sessionCookieOptions(false));
}

function requireAuthentication(request: FastifyRequest): AuthContext {
  if (!request.auth)
    throw new UnauthorizedError("Sign in to access your private workspace.");
  return request.auth;
}

function requireWriteAuthentication(
  request: FastifyRequest,
  authService: AuthService,
): AuthContext {
  const context = requireAuthentication(request);
  const csrfHeader = request.headers["x-csrf-token"];
  const csrfToken = typeof csrfHeader === "string" ? csrfHeader : undefined;
  const csrfCookie = request.cookies[config.csrfCookieName];
  if (
    !csrfToken ||
    !csrfCookie ||
    csrfToken !== csrfCookie ||
    !authService.verifyCsrf(context.sessionId, csrfToken)
  ) {
    throw new ForbiddenError(
      "This request could not be verified. Refresh the page and try again.",
    );
  }
  return context;
}

const taskStatusSchema = z.enum(["backlog", "todo", "in_progress", "done"]);
const prioritySchema = z.enum(["low", "medium", "high", "critical"]);
const cognitiveLoadSchema = z.enum(["low", "medium", "high"]);
const isoSchema = z.string().datetime({ offset: true });
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(isValidCalendarDate, "Use a real calendar date.");
const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm.")
  .refine(isValidLocalDateTime, "Use a real local date and time.");
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm.");
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Use a valid IANA time zone such as Africa/Nairobi.")
  .transform(canonicalTimeZone);
const taskIdSchema = z.object({ taskId: z.string().uuid() });
const focusIdSchema = z.object({ sessionId: z.string().uuid() });
const planIdSchema = z.object({ planId: z.string().uuid() });
const calendarEventIdSchema = z.object({ eventId: z.string().uuid() });

const authSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(1_024),
});
const registerSchema = authSchema.extend({
  displayName: z.string().trim().min(1).max(80),
});

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(10_000)
    .nullable()
    .optional()
    .default(null),
  status: taskStatusSchema.optional().default("todo"),
  priority: prioritySchema.optional().default("medium"),
  impact: z.number().int().min(1).max(5).optional().default(3),
  estimateMinutes: z.number().int().min(1).max(720).optional().default(30),
  dueAt: isoSchema.nullable().optional().default(null),
  cognitiveLoad: cognitiveLoadSchema.optional().default("medium"),
  goalAlignment: z.number().min(0).max(1).optional().default(0),
  blocked: z.boolean().optional().default(false),
  dependencies: z.array(z.string().uuid()).max(50).optional().default([]),
});

const taskUpdateSchema = taskCreateSchema
  .partial()
  .extend({
    actualMinutes: z.number().int().min(0).max(10_080).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one task value to update.",
  });

const taskDecompositionSchema = z.object({
  // Each step is supplied by the user-facing review form. The API never
  // invents, expands, or silently creates steps.
  steps: z.array(taskCreateSchema).min(1).max(25),
});

const planRequestSchema = z.object({
  planDate: calendarDateSchema,
  readiness: z.enum(["low", "steady", "high"]).optional().default("steady"),
  now: isoSchema.optional(),
  availability: z
    .array(z.object({ startAt: isoSchema, endAt: isoSchema }))
    .min(1)
    .max(8)
    .optional(),
  recovery: z.boolean().optional().default(false),
});

const preferenceUpdateSchema = z
  .object({
    timezone: timeZoneSchema.optional(),
    workingDayStart: timeOfDaySchema.optional(),
    workingDayEnd: timeOfDaySchema.optional(),
    transitionMinutes: z.number().int().min(0).max(60).optional(),
    highCognitiveRecoveryCap: z.number().min(0).max(1).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one preference to update.",
  });

const calendarEventCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startLocal: localDateTimeSchema,
  endLocal: localDateTimeSchema,
  isFixed: z.boolean().optional().default(true),
});
const calendarEventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    startLocal: localDateTimeSchema.optional(),
    endLocal: localDateTimeSchema.optional(),
    isFixed: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one event value to update.",
  });
const calendarRangeSchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .refine((input) => input.endDate >= input.startDate, {
    message: "The end date must be on or after the start date.",
  })
  .refine(
    (input) => {
      const start = Date.parse(`${input.startDate}T00:00:00.000Z`);
      const end = Date.parse(`${input.endDate}T00:00:00.000Z`);
      return end - start <= 366 * 24 * 60 * 60 * 1000;
    },
    { message: "Request at most one year of calendar events at a time." },
  );

const focusStartSchema = z.object({
  taskId: z.string().uuid().nullable().optional().default(null),
  plannedMinutes: z.number().int().min(1).max(240).optional().default(25),
  note: z.string().trim().max(2_000).nullable().optional().default(null),
});

const focusActionSchema = z.object({
  action: z.enum(["pause", "resume", "complete", "stop"]),
});

export interface AppDependencies {
  database?: FocusDatabase;
}

export async function buildApp(
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
      ],
    },
    requestIdHeader: "x-request-id",
  });
  const database =
    dependencies.database ?? new FocusDatabase(config.databasePath);
  const auth = new AuthService(database);
  const preferences = new PreferencesRepository(database);
  const calendarEvents = new CalendarEventRepository(database, preferences);
  const tasks = new TaskRepository(database);
  const sessions = new FocusSessionRepository(database, tasks);
  const plans = new PlanRepository(database, tasks, preferences);
  const dashboard = new DashboardService(tasks, plans, sessions, preferences);

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigin.split(",").map((origin) => origin.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    errorResponseBuilder: (request) => ({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment before trying again.",
        requestId: request.id,
      },
    }),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "FocusAI API",
        description:
          "Versioned FocusAI API with opaque HTTP-only cookie sessions and CSRF-protected mutations.",
        version: "0.2.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.auth = auth.contextForToken(
      request.cookies[config.sessionCookieName],
    );
  });

  const protectedRead = async (request: FastifyRequest) => {
    requireAuthentication(request);
  };
  const protectedWrite = async (request: FastifyRequest) => {
    requireWriteAuthentication(request, auth);
  };

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "focusai-api",
    mode: "authenticated-local-development",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/v1/meta", async () => ({
    mode: "authenticated-local-development",
    authentication: "opaque-http-only-cookie-session",
    csrf: "double-submit token bound to the server session",
    persistence: "local-sqlite",
    warning:
      "Local SQLite remains a development datastore; authentication and ownership are enforced by this API.",
  }));

  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const body = parse(registerSchema, request.body);
      const result = await auth.register(body);
      issueCookies(reply, result.session);
      return reply.code(201).send({
        user: result.user,
        claimedLegacyWorkspace: result.claimedLegacyWorkspace,
      });
    },
  );

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const body = parse(authSchema, request.body);
      const result = await auth.login(body);
      issueCookies(reply, result.session);
      return reply.send({ user: result.user });
    },
  );

  app.get(
    "/api/v1/auth/session",
    { preHandler: protectedRead },
    async (request) => ({ user: requireAuthentication(request).user }),
  );
  app.get(
    "/api/v1/users/me",
    { preHandler: protectedRead },
    async (request) => ({ user: requireAuthentication(request).user }),
  );

  app.post(
    "/api/v1/auth/logout",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      auth.logout(context.sessionId);
      clearCookies(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/auth/session/rotate",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const session = auth.rotate(context.sessionId);
      issueCookies(reply, session);
      return reply.send({ user: context.user, expiresAt: session.expiresAt });
    },
  );

  app.post(
    "/api/v1/auth/sessions/revoke-others",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      auth.revokeOtherSessions(context.sessionId, context.user.id);
      return reply.code(204).send();
    },
  );

  app.get("/api/v1/dashboard", { preHandler: protectedRead }, async (request) =>
    dashboard.get(requireAuthentication(request).user.id),
  );

  app.get(
    "/api/v1/preferences",
    { preHandler: protectedRead },
    async (request) => preferences.get(requireAuthentication(request).user.id),
  );

  app.patch(
    "/api/v1/preferences",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const input = parse(preferenceUpdateSchema, request.body);
      const current = preferences.get(context.user.id);
      const next: UserPreferencesDto = { ...current, ...input };
      if (next.workingDayEnd <= next.workingDayStart) {
        throw new ValidationError({
          formErrors: [
            "Working-day end must be later than working-day start on the same local day.",
          ],
          fieldErrors: {
            workingDayStart: [],
            workingDayEnd: [],
          },
        });
      }
      return preferences.update(input, context.user.id);
    },
  );

  app.get(
    "/api/v1/calendar-events",
    { preHandler: protectedRead },
    async (request) => {
      const context = requireAuthentication(request);
      const range = parse(calendarRangeSchema, request.query);
      return { items: calendarEvents.list(range, context.user.id) };
    },
  );

  app.post(
    "/api/v1/calendar-events",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const input = parse(calendarEventCreateSchema, request.body);
      return reply
        .code(201)
        .send(calendarEvents.create(input, context.user.id));
    },
  );

  app.patch(
    "/api/v1/calendar-events/:eventId",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const { eventId } = parse(calendarEventIdSchema, request.params);
      const input = parse(calendarEventUpdateSchema, request.body);
      return calendarEvents.update(eventId, input, context.user.id);
    },
  );

  app.delete(
    "/api/v1/calendar-events/:eventId",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const { eventId } = parse(calendarEventIdSchema, request.params);
      calendarEvents.delete(eventId, context.user.id);
      return reply.code(204).send();
    },
  );

  app.get("/api/v1/tasks", { preHandler: protectedRead }, async (request) => {
    const context = requireAuthentication(request);
    const query = parse(
      z.object({
        status: taskStatusSchema.optional(),
        q: z.string().trim().max(120).optional(),
      }),
      request.query,
    );
    return {
      items: tasks.list(context.user.id, {
        status: query.status as TaskStatus | undefined,
        search: query.q,
      }),
    };
  });

  app.get(
    "/api/v1/tasks/:taskId",
    { preHandler: protectedRead },
    async (request) => {
      const context = requireAuthentication(request);
      const { taskId } = parse(taskIdSchema, request.params);
      return tasks.get(taskId, context.user.id);
    },
  );

  app.post(
    "/api/v1/tasks",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const body = parse(taskCreateSchema, request.body);
      const created = tasks.create(body, context.user.id);
      return reply.code(201).send(created);
    },
  );

  app.patch(
    "/api/v1/tasks/:taskId",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const { taskId } = parse(taskIdSchema, request.params);
      const body = parse(taskUpdateSchema, request.body);
      return tasks.update(taskId, body, context.user.id);
    },
  );

  app.post(
    "/api/v1/tasks/:taskId/decompose",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const { taskId } = parse(taskIdSchema, request.params);
      const body = parse(taskDecompositionSchema, request.body);
      return reply
        .code(201)
        .send(tasks.decompose(taskId, body.steps, context.user.id));
    },
  );

  app.post(
    "/api/v1/tasks/:taskId/complete",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const { taskId } = parse(taskIdSchema, request.params);
      const body = parse(
        z.object({
          actualMinutes: z.number().int().min(0).max(10_080).optional(),
        }),
        request.body,
      );
      return tasks.complete(taskId, body.actualMinutes, context.user.id);
    },
  );

  app.delete(
    "/api/v1/tasks/:taskId",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const { taskId } = parse(taskIdSchema, request.params);
      tasks.delete(taskId, context.user.id);
      return reply.code(204).send();
    },
  );

  app.get("/api/v1/plans", { preHandler: protectedRead }, async (request) => {
    const context = requireAuthentication(request);
    const { planDate } = parse(
      z.object({ planDate: calendarDateSchema.optional() }),
      request.query,
    );
    return {
      plan: planDate
        ? plans.latestForDate(planDate, context.user.id)
        : plans.today(context.user.id),
    };
  });

  app.post(
    "/api/v1/plans/generate",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const body = parse(planRequestSchema, request.body);
      const plan = plans.generate(body, context.user.id);
      return reply.code(201).send(plan);
    },
  );

  app.post(
    "/api/v1/plans/:planId/accept",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const { planId } = parse(planIdSchema, request.params);
      return plans.accept(planId, context.user.id);
    },
  );

  app.get(
    "/api/v1/focus-sessions",
    { preHandler: protectedRead },
    async (request) => {
      const context = requireAuthentication(request);
      return { items: sessions.list(context.user.id) };
    },
  );
  app.get(
    "/api/v1/focus-sessions/active",
    { preHandler: protectedRead },
    async (request) => {
      const context = requireAuthentication(request);
      return { session: sessions.active(context.user.id) };
    },
  );

  app.post(
    "/api/v1/focus-sessions",
    { preHandler: protectedWrite },
    async (request, reply) => {
      const context = requireWriteAuthentication(request, auth);
      const body = parse(focusStartSchema, request.body);
      const session = sessions.start(body, context.user.id);
      return reply.code(201).send(session);
    },
  );

  app.post(
    "/api/v1/focus-sessions/:sessionId/transition",
    { preHandler: protectedWrite },
    async (request) => {
      const context = requireWriteAuthentication(request, auth);
      const { sessionId } = parse(focusIdSchema, request.params);
      const { action } = parse(focusActionSchema, request.body);
      return sessions.transition(sessionId, action, context.user.id);
    },
  );

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: `No route matches ${request.method} ${request.url}.`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError || error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please review the highlighted request values.",
          requestId: request.id,
          details:
            error instanceof ValidationError ? error.details : error.flatten(),
        },
      });
    }
    if (error instanceof UnauthorizedError) {
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ForbiddenError) {
      return reply.code(403).send({
        error: {
          code: "CSRF_REJECTED",
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({
        error: {
          code: "CONFLICT",
          message: error.message,
          requestId: request.id,
        },
      });
    }
    request.log.error(
      { err: error, requestId: request.id },
      "Unhandled request error",
    );
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed safely.",
        requestId: request.id,
      },
    });
  });

  app.addHook("onClose", async () => {
    if (!dependencies.database) database.close();
  });

  return app;
}
