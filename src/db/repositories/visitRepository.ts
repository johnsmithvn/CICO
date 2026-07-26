import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { query } from "../postgres";
import { env } from "../../config/env";

export interface VisitStats {
  today: number;
  month: number;
  total: number;
}

const supabaseUrl = env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

let supabaseClient: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) {
  supabaseClient = createClient(supabaseUrl, supabaseKey);
}

let isTableInitialized = false;

async function ensureTableExists(): Promise<void> {
  if (isTableInitialized) return;
  if (!supabaseClient) {
    try {
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
      isTableInitialized = true;
    } catch (_e) {
      isTableInitialized = true;
    }
  } else {
    isTableInitialized = true;
  }
}

export async function recordVisit(visitorId?: string, ipAddress?: string, userAgent?: string): Promise<void> {
  await ensureTableExists();
  if (supabaseClient) {
    await supabaseClient.from("page_visits").insert({
      visitor_id: visitorId || null,
      ip_address: ipAddress || null,
      user_agent: userAgent || null
    });
  } else {
    await query(
      `
        INSERT INTO page_visits (visitor_id, ip_address, user_agent)
        VALUES ($1, $2, $3)
      `,
      [visitorId || null, ipAddress || null, userAgent || null]
    );
  }
}

export async function getVisitStats(timezone?: string): Promise<VisitStats> {
  await ensureTableExists();

  if (supabaseClient) {
    try {
      const now = new Date();

      // 1. Total count
      const { count: totalCount } = await supabaseClient
        .from("page_visits")
        .select("*", { count: "exact", head: true });

      // 2. Today count (start of today local time)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const { count: todayCount } = await supabaseClient
        .from("page_visits")
        .select("*", { count: "exact", head: true })
        .gte("visited_at", startOfToday);

      // 3. Month count (start of current month)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count: monthCount } = await supabaseClient
        .from("page_visits")
        .select("*", { count: "exact", head: true })
        .gte("visited_at", startOfMonth);

      return {
        today: todayCount || 0,
        month: monthCount || 0,
        total: totalCount || 0
      };
    } catch (_e) {
      return { today: 0, month: 0, total: 0 };
    }
  }

  const tz = timezone || "Asia/Ho_Chi_Minh";
  const result = await query<{ today: string; month: string; total: string }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE (visited_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date) AS today,
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', visited_at AT TIME ZONE $1) = DATE_TRUNC('month', NOW() AT TIME ZONE $1)) AS month,
        COUNT(*) AS total
      FROM page_visits
    `,
    [tz]
  );

  const row = result.rows[0];
  return {
    today: parseInt(row?.today || "0", 10),
    month: parseInt(row?.month || "0", 10),
    total: parseInt(row?.total || "0", 10)
  };
}
