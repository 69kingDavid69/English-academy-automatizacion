import { Router } from "express";
import { paths } from "../config/paths.js";
import { checkChromaHealth } from "../services/vectorstore.js";
import { config } from "../config/env.js";

const router = Router();

// Landing page at root
router.get("/", (req, res) => {
  res.sendFile(`${paths.siteDir}/index.html`);
});

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

router.get("/health/detailed", async (req, res) => {
  try {
    const chromaHealth = await checkChromaHealth();
    
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        chromadb: chromaHealth,
        deepseek: {
          configured: !!config.deepseek.apiKey,
          model: config.deepseek.model,
        },
        telegram: {
          mode: config.telegram.mode,
          botConfigured: !!config.telegram.token,
          adminBotConfigured: !!config.telegram.adminToken,
        },
        rag: {
          similarityThreshold: config.rag.similarityThreshold,
          topK: config.rag.topK,
          autoIngestOnBoot: config.rag.autoIngestOnBoot,
        },
      },
      environment: config.server.env,
      port: config.server.port,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
