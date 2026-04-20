import app from "./app.js";
import { config } from "./config/env.js";
import { ensureKnowledgeBase } from "./ingestion/runIngestion.js";
import { logger } from "./middleware/logger.js";
import { getBot } from "./routes/telegram.js";

if (config.rag.autoIngestOnBoot) {
  logger.info("AUTO_INGEST_ON_BOOT enabled. Checking knowledge base.");
  await ensureKnowledgeBase({ logger });
}

const server = app.listen(config.server.port, "0.0.0.0", () => {
  logger.info(`Server running on port ${config.server.port}`, {
    env: config.server.env,
    port: config.server.port,
  });
});

if (config.telegram.mode === "webhook" && config.telegram.webhookUrl) {
  const bot = getBot();

  if (bot) {
    const webhookPath = `/bot${config.telegram.token}`;
    const fullUrl = `${config.telegram.webhookUrl}${webhookPath}`;

    await bot.setWebHook(fullUrl, {
      secret_token: config.telegram.secret,
    });

    logger.info("Telegram webhook registered", { url: fullUrl });
  }
}

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully.");
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });
});
