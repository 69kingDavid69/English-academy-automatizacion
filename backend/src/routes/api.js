import { Router } from "express";
import { processQuery } from "../services/rag.js";
import { logEscalation, notifyHumanAgent } from "../services/escalation.js";
import { getBot, getAdminBot } from "./telegram.js";
import { logger } from "../middleware/logger.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "academy-support-bot",
    endpoints: {
      query: "/api/query",
      adminHealth: "/api/admin/health",
      adminEscalations: "/api/admin/escalations",
    },
  });
});

/**
 * POST /api/query
 * Main endpoint for the widget, n8n, and any HTTP integration.
 * Body: { userId, message, channel?, username? }
 */
router.post("/query", async (req, res) => {
  const { userId, message, channel = "webhook", username } = req.body;

  if (!userId || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "userId and non-empty message are required" });
  }

  if (message.trim().length > 1000) {
    return res.status(400).json({ error: "Message too long (max 1000 characters)" });
  }

  try {
    const result = await processQuery({ userId: String(userId), userMessage: message.trim() });

    if (result.escalate) {
      const entry = await logEscalation({
        userId: String(userId),
        username: username || "webhook-user",
        userMessage: message.trim(),
        botReply: result.reply,
        retrievalStats: result.retrievalStats,
        escalationReason: result.escalationReason,
        channel,
      });
      const notificationBot = getAdminBot() || getBot();
      await notifyHumanAgent(notificationBot, entry);
    }

    return res.json({
      reply: result.reply,
      escalated: result.escalate,
      escalationReason: result.escalate ? result.escalationReason : undefined,
      confidence: result.retrievalStats?.topScore ?? 0,
      avgConfidence: result.retrievalStats?.avgScore ?? 0,
      chunksUsed: result.retrievalStats?.count ?? 0,
      contextTokens: result.contextTokens,
      fromCache: result.fromCache,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    logger.error("Query endpoint error", { error: err.message, userId });
    return res.status(500).json({ error: "Internal server error. Please try again." });
  }
});

export default router;
