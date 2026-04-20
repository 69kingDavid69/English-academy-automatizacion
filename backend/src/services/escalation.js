import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// In-memory log (replace with Supabase/PostgreSQL for production)
const escalationLog = [];

// Phrases the LLM uses when it is uncertain — any of these trigger escalation
const UNCERTAINTY_PHRASES = [
  "i'm not sure",
  "i am not sure",
  "i don't know",
  "i do not know",
  "i cannot confirm",
  "i can't confirm",
  "i'm unable",
  "i am unable",
  "it's possible",
  "it may be",
  "it might be",
  "i believe",
  "i think",
  "i assume",
  "probably",
  "perhaps",
  "you should check",
  "please verify",
  "contact us for",
  "i'd recommend checking",
];

// Phrases that indicate the query is off-topic / outside the academy's scope
const OFF_TOPIC_PHRASES = [
  "i can only help with questions about our academy",
  "i can only help with questions about the academy",
  "i can only help with questions about",
  "solo puedo ayudar con preguntas sobre nuestra academia",
  "solo puedo ayudarte con preguntas sobre la academia",
  "solo puedo ayudar con preguntas sobre",
  "solo puedo ayudar con preguntas relacionadas",
];

// Phrases the prompt instructs the LLM to use for explicit escalation
const ESCALATION_MARKERS = ["ESCALATE:", "escalate:"];

/**
 * Evaluates all escalation signals and returns a structured decision.
 *
 * Signal priority (first match wins):
 *   1. No chunks retrieved (no context at all)
 *   2. LLM output contains explicit escalation marker
 *   3. Top similarity below hard threshold
 *   4. Average similarity below soft threshold
 *   5. LLM output contains uncertainty phrases
 *   6. Response is suspiciously short (< 20 chars) — likely malformed
 */
export function evaluateEscalation(reply, retrievalStats) {
  const { count, topScore, avgScore } = retrievalStats;
  const replyLower = (reply || "").toLowerCase().trim();

  // Signal 1: No context
  if (count === 0) {
    return {
      escalate: true,
      reason: "no_context",
      detail: "No relevant chunks retrieved",
    };
  }

  // Signal 2: Explicit LLM escalation marker
  if (ESCALATION_MARKERS.some((m) => reply.startsWith(m))) {
    return {
      escalate: true,
      reason: "llm_escalation_marker",
      detail: "LLM explicitly requested escalation",
    };
  }

  // Signal 3: Top similarity below hard threshold
  if (topScore < config.escalation.threshold) {
    return {
      escalate: true,
      reason: "low_top_similarity",
      detail: `Top score ${topScore.toFixed(3)} below threshold ${config.escalation.threshold}`,
    };
  }

  // Signal 4: Average similarity below soft threshold (weak overall relevance)
  const softThreshold = config.escalation.threshold - 0.08;
  if (avgScore < softThreshold) {
    return {
      escalate: true,
      reason: "low_avg_similarity",
      detail: `Avg score ${avgScore.toFixed(3)} below soft threshold ${softThreshold.toFixed(3)}`,
    };
  }

  // Signal 5: Uncertainty phrases in response
  const uncertainPhrase = UNCERTAINTY_PHRASES.find((p) => replyLower.includes(p));
  if (uncertainPhrase) {
    return {
      escalate: true,
      reason: "uncertain_response",
      detail: `LLM used uncertainty phrase: "${uncertainPhrase}"`,
    };
  }

  // Signal 6: Off-topic query — LLM correctly rejected, but should still escalate
  const offTopicPhrase = OFF_TOPIC_PHRASES.find((p) => replyLower.includes(p));
  if (offTopicPhrase) {
    return {
      escalate: true,
      reason: "off_topic",
      detail: `Query is outside academy scope: "${offTopicPhrase}"`,
    };
  }

  // Signal 7: Malformed or empty response
  if (!reply || reply.trim().length < 20) {
    return {
      escalate: true,
      reason: "malformed_response",
      detail: "Response too short or empty",
    };
  }

  return { escalate: false, reason: null, detail: null };
}

export function extractCleanReply(reply) {
  if (!reply) return "";
  for (const marker of ESCALATION_MARKERS) {
    if (reply.startsWith(marker)) {
      return reply.slice(marker.length).trim();
    }
  }
  return reply.trim();
}

export async function logEscalation({
  userId,
  username,
  userMessage,
  botReply,
  retrievalStats,
  escalationReason,
  channel,
}) {
  const entry = {
    id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    userId,
    username,
    userMessage,
    botReply,
    similarity: retrievalStats?.topScore ?? 0,
    retrievalStats,
    escalationReason,
    channel,
    resolved: false,
  };

  escalationLog.push(entry);

  logger.warn("Escalation triggered", {
    userId,
    channel,
    reason: escalationReason,
    topScore: retrievalStats?.topScore?.toFixed(3),
    avgScore: retrievalStats?.avgScore?.toFixed(3),
  });

  return entry;
}

export async function notifyHumanAgent(bot, entry) {
  if (!config.escalation.chatId || !bot) return;

  try {
    const score = entry.retrievalStats?.topScore;
    const escapedChannel = escapeHtml(entry.channel);
    const escapedUsername = escapeHtml(entry.username || "unknown");
    const escapedUserId = escapeHtml(String(entry.userId));
    const escapedUserMessage = escapeHtml(entry.userMessage);
    const escapedReason = escapeHtml(entry.escalationReason || "unknown");
    const escapedTimestamp = escapeHtml(entry.timestamp);
    const confidenceText = score != null ? `${(score * 100).toFixed(0)}%` : "N/A";
    const escapedConfidence = escapeHtml(confidenceText);
    
    const text =
      `<b>Escalation Required</b>\n` +
      `Channel: ${escapedChannel}\n` +
      `User: @${escapedUsername} (ID: ${escapedUserId})\n` +
      `Message: "${escapedUserMessage}"\n` +
      `Reason: ${escapedReason}\n` +
      `Confidence: ${escapedConfidence}\n` +
      `Time: ${escapedTimestamp}`;

    await bot.sendMessage(config.escalation.chatId, text, {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error("Failed to notify human agent", { error: err.message });
  }
}

export function getEscalationLog() {
  return [...escalationLog];
}

export function markResolved(id) {
  const entry = escalationLog.find((e) => e.id === id);
  if (entry) entry.resolved = true;
  return entry || null;
}
