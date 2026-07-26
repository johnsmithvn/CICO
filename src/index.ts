import express from "express";
import path from "path";
import { createTelegramBot } from "./bot/telegram";
import { createApiRouter } from "./api/apiRoutes";
import { env } from "./config/env";
import { pool } from "./db/postgres";
import { logger } from "./logger";
import { startSchedulers } from "./schedulers";
import { recordVisit, getVisitStats } from "./db/repositories/visitRepository";

async function configureBotMenu(bot: ReturnType<typeof createTelegramBot>): Promise<void> {
  const commands = [
    { command: "menu", description: "Xem hướng dẫn sử dụng" }
  ];

  await bot.telegram.setMyCommands(commands);
  await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
}

async function bootstrap(): Promise<void> {
  const bot = createTelegramBot(env.BOT_TOKEN, env.TIMEZONE);
  const app = express();

  try {
    await configureBotMenu(bot);
    logger.info("Telegram command menu configured");
  } catch (error) {
    logger.warn({ error }, "Failed to configure Telegram command menu");
  }

  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "telegram-work-bot",
      now: new Date().toISOString()
    });
  });

  // Simple in-memory rate limiter for visit recording (1 record per IP per 30s)
  const visitCooldown = new Map<string, number>();
  const VISIT_COOLDOWN_MS = 30_000;

  // Public endpoint for silent visitor tracking
  app.post("/api/visits", async (req, res) => {
    try {
      const record = Boolean(req.body?.record);
      const visitorId = req.body?.visitor_id ? String(req.body.visitor_id) : undefined;
      const rawIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const userAgent = req.headers["user-agent"];

      if (record) {
        const now = Date.now();
        const lastVisit = visitCooldown.get(rawIp);
        if (!lastVisit || now - lastVisit > VISIT_COOLDOWN_MS) {
          await recordVisit(visitorId, rawIp, userAgent);
          visitCooldown.set(rawIp, now);

          // Cleanup old entries every 100 inserts to prevent memory leak
          if (visitCooldown.size > 500) {
            for (const [ip, ts] of visitCooldown) {
              if (now - ts > VISIT_COOLDOWN_MS) visitCooldown.delete(ip);
            }
          }
        }
      }

      const stats = await getVisitStats(env.TIMEZONE);
      res.json({ ok: true, stats });
    } catch (error) {
      logger.error({ error }, "Visit tracking endpoint error");
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  // Serve web dashboard (static files from public/)
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  if (env.WEBHOOK_URL) {
    const webhookPath = "/telegram/webhook";
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(`${env.WEBHOOK_URL.replace(/\/$/, "")}${webhookPath}`);
    logger.info({ webhook: `${env.WEBHOOK_URL}${webhookPath}` }, "Telegram webhook configured");
  } else {
    await bot.launch({ dropPendingUpdates: true });
    logger.info("Telegram bot started in polling mode");
  }

  app.use(createApiRouter(bot, { API_SECRET: env.API_SECRET, TIMEZONE: env.TIMEZONE }));

  startSchedulers(bot, env.TIMEZONE, env.KEEP_AWAKE_URL);
  logger.info("Schedulers started");

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "HTTP server started");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn({ signal }, "Shutting down...");
    server.close();
    bot.stop(signal);
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch(async (error) => {
  logger.error({ error }, "Application failed to start");
  await pool.end();
  process.exit(1);
});
