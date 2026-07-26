import { query } from "../postgres";

export interface VisitStats {
  today: number;
  month: number;
  total: number;
}

let isTableInitialized = false;

async function ensureTableExists(): Promise<void> {
  if (isTableInitialized) return;
  try {
    try {
      await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    } catch (_e) {
      // pgcrypto might not be allowed on non-superuser DB, ignore
    }

    await query(`
      CREATE TABLE IF NOT EXISTS page_visits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        visitor_id TEXT,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    await query(`ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS visitor_id TEXT`);
    await query(`CREATE INDEX IF NOT EXISTS page_visits_visited_at_idx ON page_visits(visited_at)`);
    await query(`CREATE INDEX IF NOT EXISTS page_visits_visitor_id_idx ON page_visits(visitor_id)`);

    isTableInitialized = true;
  } catch (error) {
    console.error("Failed to ensure page_visits table exists:", error);
    throw error;
  }
}

export async function recordVisit(visitorId?: string, ipAddress?: string, userAgent?: string): Promise<void> {
  await ensureTableExists();
  await query(
    `
      INSERT INTO page_visits (visitor_id, ip_address, user_agent)
      VALUES ($1, $2, $3)
    `,
    [visitorId || null, ipAddress || null, userAgent || null]
  );
}

export async function getVisitStats(timezone: string = "Asia/Ho_Chi_Minh"): Promise<VisitStats> {
  await ensureTableExists();
  const result = await query<{ today: string; month: string; total: string }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE (visited_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date) AS today,
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', visited_at AT TIME ZONE $1) = DATE_TRUNC('month', NOW() AT TIME ZONE $1)) AS month,
        COUNT(*) AS total
      FROM page_visits
    `,
    [timezone]
  );

  const row = result.rows[0];
  return {
    today: parseInt(row?.today || "0", 10),
    month: parseInt(row?.month || "0", 10),
    total: parseInt(row?.total || "0", 10)
  };
}
