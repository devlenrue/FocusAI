import { resolve } from 'node:path';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  host: process.env.FOCUSAI_API_HOST ?? '0.0.0.0',
  port: positiveInteger(process.env.FOCUSAI_API_PORT, 3001),
  databasePath: resolve(process.env.FOCUSAI_DATABASE_PATH ?? './data/focusai.db'),
  corsOrigin: process.env.FOCUSAI_CORS_ORIGIN ?? 'http://localhost:5173',
};

/** Local-only development identity. Replaced by authenticated request context in Increment 2. */
export const LOCAL_DEVELOPMENT_USER_ID = 'local-development-user';
