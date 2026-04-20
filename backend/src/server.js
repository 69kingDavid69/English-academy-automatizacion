import app from "./app.js";
import { config } from "./config/env.js";
import { ensureKnowledgeBase } from "./ingestion/runIngestion.js";
import { logger } from "./middleware/logger.js";
import { getBot } from "./routes/telegram.js";

if (config.rag.autoIngestOnBoot) {
  logger.info("AUTO_INGEST_ON_BOOT enabled. Checking knowledge base.");
  // Run ingestion in background to avoid blocking server startup
  (async () => {
    try {
      await ensureKnowledgeBase({ logger });
      logger.info("Knowledge base ingestion completed successfully.");
    } catch (err) {
      logger.error("Knowledge base ingestion failed", { error: err.message });
      // Server continues running, but RAG will have limited functionality
      logger.warn("RAG will have limited functionality until ingestion succeeds.");
    }
  })();
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
