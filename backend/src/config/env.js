import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const required = [
  "DEEPSEEK_API_KEY",
  "TELEGRAM_BOT_TOKEN",
];

function isTrue(value) {
  return String(value || "").toLowerCase() === "true";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolvePublicBaseUrl() {
  return trimTrailingSlash(
    process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
  );
}

function resolveTelegramWebhookUrl() {
  return trimTrailingSlash(
    process.env.TELEGRAM_WEBHOOK_URL || resolvePublicBaseUrl() || ""
  );
}

function resolveTelegramMode() {
  const explicitMode = String(process.env.TELEGRAM_MODE || "").trim().toLowerCase();
  if (["webhook", "polling", "none"].includes(explicitMode)) {
    return explicitMode;
  }

  return resolveTelegramWebhookUrl() ? "webhook" : "polling";
}

function resolveChromaUrl() {
  if (process.env.CHROMA_URL) {
    return process.env.CHROMA_URL;
  }

  const protocol = isTrue(process.env.CHROMA_SSL) ? "https" : "http";
  const host = process.env.CHROMA_HOST || "localhost";
  const port = process.env.CHROMA_PORT || "8000";

  return `${protocol}://${host}:${port}`;
}

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminToken: process.env.TELEGRAM_BOT_TOKEN_ADMIN || "",
    mode: resolveTelegramMode(),
    webhookUrl: resolveTelegramWebhookUrl(),
    secret: process.env.WEBHOOK_SECRET || "default-secret",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    env: process.env.NODE_ENV || "development",
  },
  public: {
    baseUrl: resolvePublicBaseUrl(),
  },
  chroma: {
    url: resolveChromaUrl(),
    collection: process.env.CHROMA_COLLECTION || "academy_knowledge",
  },
  rag: {
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || "0.45"),
    topK: parseInt(process.env.RAG_TOP_K || "4", 10),
    chunkSize: parseInt(process.env.CHUNK_SIZE || "800", 10),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "150", 10),
    autoIngestOnBoot: isTrue(process.env.AUTO_INGEST_ON_BOOT),
  },
  escalation: {
    chatId: process.env.ESCALATION_CHAT_ID || "",
    threshold: parseFloat(process.env.ESCALATION_THRESHOLD || "0.40"),
  },
  admin: {
    token: process.env.ADMIN_TOKEN || "",
  },
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || "30", 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};
