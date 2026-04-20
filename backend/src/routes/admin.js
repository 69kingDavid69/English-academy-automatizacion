import { Router } from "express";
import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";
import { stats as cacheStats, flush as cacheFlush } from "../services/cache.js";
import { getEscalationLog, markResolved } from "../services/escalation.js";

const router = Router();

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;

  if (token !== config.admin.token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

router.use(requireAdmin);

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

export default router;
