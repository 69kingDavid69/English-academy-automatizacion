import { Router } from "express";
import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";
import { stats as cacheStats, flush as cacheFlush } from "../services/cache.js";
import { getEscalationLog, markResolved } from "../services/escalation.js";

const router = Router();



router.get("/escalations", (req, res) => {
  res.json(getEscalationLog());
});

router.post("/escalations/:id/resolve", (req, res) => {
  const entry = markResolved(req.params.id);

  if (!entry) {
    return res.status(404).json({ error: "Escalation not found" });
  }

  return res.json({ success: true, entry });
});

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    cache: cacheStats(),
    ragConfig: {
      similarityThreshold: config.rag.similarityThreshold,
      escalationThreshold: config.escalation.threshold,
      topK: config.rag.topK,
    },
    timestamp: new Date().toISOString(),
  });
});

router.post("/cache/flush", (req, res) => {
  cacheFlush();
  logger.info("Cache flushed by admin");
  res.json({ success: true, message: "Cache cleared" });
});

router.get("/debug", (req, res) => {
  res.json({
    headers: req.headers,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

export default router;
