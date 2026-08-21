import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * Read-only access to the canonical AG Neon spine — the estate's sanctioned
 * request-time read surface for facts (see README, integration boundaries).
 * This app issues SELECTs only; it never writes to the canonical database.
 *
 * A missing DATABASE_URL is a first-class rendered state, not a crash: pages
 * check `isDbConfigured()` and render the honest not-configured panel, in the
 * same spirit as the estate's LLM seam.
 */

const connectionString = process.env.DATABASE_URL;

export function isDbConfigured(): boolean {
  return Boolean(connectionString);
}

const g = globalThis as unknown as { __bpSql?: ReturnType<typeof neon> };

function client(): ReturnType<typeof neon> {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy the sibling repo's env file: " +
        'cp "../AG Sourcing Tool 20_06_2026/.env" .env.local',
    );
  }
  const sql = g.__bpSql ?? neon(connectionString);
  if (process.env.NODE_ENV !== "production") g.__bpSql = sql;
  return sql;
}

/** Typed parameterized query. `$1`-style placeholders; returns the rows array. */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await client()(text, params);
  return rows as T[];
}
