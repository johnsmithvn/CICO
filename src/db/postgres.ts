import { Pool, PoolClient, QueryResult, QueryResultRow, types } from "pg";
import { env } from "../config/env";
import { logger } from "../logger";

// Keep DATE columns as raw YYYY-MM-DD strings to avoid timezone shifts.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl:
    env.DATABASE_URL.includes("sslmode=require") || env.DATABASE_URL.includes("supabase.co")
      ? { rejectUnauthorized: false }
      : undefined
});

pool.on("error", (error) => {
  logger.error({ error }, "PostgreSQL pool error");
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
