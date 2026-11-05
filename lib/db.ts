import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * Access to the AG Neon spine — the estate's sanctioned request-time read
 * surface for facts (see README, integration boundaries). Canonical tables are
 * only ever read. The portal writes only its own tables — portal_user,
 * portal_refresh_run, portal_llm_spend — created on first use.
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
  /* Opt-in slow-query log: DB_SLOW_MS=400 prints any query slower than that,
     with the opening of its SQL, so a slow page can be traced to its query. */
  const slowMs = Number(process.env.DB_SLOW_MS ?? 0);
  const t0 = slowMs > 0 ? performance.now() : 0;
  const rows = await client()(text, params);
  if (slowMs > 0) {
    const ms = performance.now() - t0;
    if (ms >= slowMs) console.warn(`[db:slow] ${Math.round(ms)}ms ${text.replace(/\s+/g, " ").trim().slice(0, 140)}`);
  }
  return rows as T[];
}
