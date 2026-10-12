import { resolve } from "node:path";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

const sessionTtlDays = positiveInteger(process.env.FOCUSAI_SESSION_TTL_DAYS, 7);
const production = process.env.NODE_ENV === "production";

export const config = {
  host: process.env.FOCUSAI_API_HOST ?? "0.0.0.0",
  port: positiveInteger(process.env.FOCUSAI_API_PORT, 3001),
  databasePath: resolve(
    process.env.FOCUSAI_DATABASE_PATH ?? "./data/focusai.db",
  ),
  corsOrigin: process.env.FOCUSAI_CORS_ORIGIN ?? "http://localhost:5173",
  sessionTtlSeconds: sessionTtlDays * 24 * 60 * 60,
  cookieSecure: booleanValue(process.env.FOCUSAI_COOKIE_SECURE, production),
  sessionCookieName: "focusai_session",
  csrfCookieName: "focusai_csrf",
  /** Only used to offer a one-time, transactional claim of v1 local data. */
  legacyLocalUserId: "local-development-user",
};
