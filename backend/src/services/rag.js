import { retrieve, buildContext, trimContextToTokenLimit, estimateTokens } from "./vectorstore.js";
import { rerank, computeRetrievalStats } from "./reranker.js";
import { chat } from "./deepseek.js";
import { buildPrompt } from "../prompts/systemPrompt.js";
import { evaluateEscalation, extractCleanReply } from "./escalation.js";
import { get as cacheGet, set as cacheSet, normalizeQuery } from "./cache.js";
import { logger } from "../middleware/logger.js";
import { config } from "../config/env.js";
import { detectLanguage, localizedMessages } from "../utils/language.js";

// ---------------------------------------------------------------------------
// Conversation history store
// Per-user in-memory map. Replace Map with Redis for multi-instance setups.
// ---------------------------------------------------------------------------
const conversationStore = new Map();

const MAX_HISTORY_EXCHANGES = 3;      // 3 exchanges = 6 messages
const MAX_HISTORY_TOKENS = 1200;      // Hard token cap for history

function getHistory(userId) {
  return conversationStore.get(userId) || [];
}

function updateHistory(userId, userMessage, assistantReply) {
  const history = getHistory(userId);
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: assistantReply });

  // Step 1: Keep only last N exchanges
  const maxMessages = MAX_HISTORY_EXCHANGES * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  // Step 2: Token budget — drop oldest exchange if still over limit
  let historyTokens = history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  while (historyTokens > MAX_HISTORY_TOKENS && history.length >= 2) {
    const [removed1, removed2] = history.splice(0, 2);
    historyTokens -= estimateTokens(removed1.content) + estimateTokens(removed2.content);
  }

  conversationStore.set(userId, history);
}

// ---------------------------------------------------------------------------
// Main RAG pipeline
// ---------------------------------------------------------------------------

/**
 * Full RAG pipeline with all production improvements:
 *
 *  [1] Cache check        — return instantly for repeated queries
 *  [2] Retrieve           — fetch (topK*2) candidates from ChromaDB
 *  [3] Stats check        — escalate immediately if retrieval is weak
 *  [4] Re-rank            — keyword overlap + similarity combined score
 *  [5] Context trim       — enforce token budget before calling LLM
 *  [6] LLM call           — DeepSeek with strict RAG system prompt
 *  [7] Response validate  — detect uncertainty, escalation markers, bad output
 *  [8] Cache store        — cache clean non-escalation answers
 *  [9] History update     — maintain short, token-bounded conversation history
 * [10] Observability      — structured log with all metrics
 */
export async function processQuery({ userId, userMessage }) {
  const startTime = Date.now();
  const cacheKey = normalizeQuery(userMessage);

  // -------------------------------------------------------------------------
  // [1] Cache check
  // -------------------------------------------------------------------------
  const cached = cacheGet(cacheKey);
  if (cached) {
    logger.info("RAG cache hit", {
      userId,
      query: userMessage.slice(0, 60),
      latencyMs: Date.now() - startTime,
    });
    return { ...cached, fromCache: true, latencyMs: Date.now() - startTime };
  }

  // -------------------------------------------------------------------------
  // [2] Retrieve candidates
  // -------------------------------------------------------------------------
  let rawChunks;
  try {
    rawChunks = await retrieve(userMessage);
  } catch (err) {
    logger.error("Retrieval failed", { error: err.message, userId });
    return buildErrorResponse(err.message, startTime);
  }

  // -------------------------------------------------------------------------
  // [3] Compute retrieval statistics and pre-LLM escalation check
  // -------------------------------------------------------------------------
  const stats = computeRetrievalStats(rawChunks);

  // If there is absolutely nothing above the threshold, skip the LLM entirely
  if (stats.count === 0) {
    const lang = detectLanguage(userMessage);
    const message = lang === 'es' 
      ? "No tengo información específica sobre eso en nuestra base de conocimientos. Uno de nuestros asesores estará encantado de ayudarte."
      : "I don't have specific information about that in our knowledge base. One of our advisors will be happy to help you.";
    
    const result = buildEscalationResponse(
      "no_context",
      message,
      stats,
      startTime
    );
    logger.warn("Pre-LLM escalation: no context", { userId, query: userMessage.slice(0, 60) });
    return result;
  }

  // If the top chunk is below the escalation threshold, the answer will be unreliable
  if (stats.topScore < config.escalation.threshold) {
    const result = buildEscalationResponse(
      "low_top_similarity",
      "I want to make sure you get accurate information. Let me connect you with one of our advisors.",
      stats,
      startTime
    );
    logger.warn("Pre-LLM escalation: low similarity", {
      userId,
      topScore: stats.topScore,
      threshold: config.escalation.threshold,
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // [4] Re-rank and deduplicate
  // -------------------------------------------------------------------------
  const rankedChunks = rerank(userMessage, rawChunks, config.rag.topK);

  // -------------------------------------------------------------------------
  // [5] Build context with token budget enforcement
  // -------------------------------------------------------------------------
  const { chunks: finalChunks, totalTokens: contextTokens } = trimContextToTokenLimit(
    rankedChunks,
    1800
  );
  const context = buildContext(finalChunks);

  // -------------------------------------------------------------------------
  // [6] Call LLM
  // -------------------------------------------------------------------------
  const { system, user } = buildPrompt(context, userMessage);
  const history = getHistory(userId);

  let llmReply;
  let usage;

  try {
    ({ reply: llmReply, usage } = await chat({
      systemPrompt: system,
      userMessage: user,
      conversationHistory: history,
    }));
  } catch (err) {
    logger.error("LLM call failed", { error: err.message, userId });
    return buildErrorResponse("LLM unavailable. Please try again in a moment.", startTime);
  }

  // -------------------------------------------------------------------------
  // [7] Validate response — check for escalation signals
  // -------------------------------------------------------------------------
  const escalationDecision = evaluateEscalation(llmReply, stats);
  const cleanReply = extractCleanReply(llmReply);

  // -------------------------------------------------------------------------
  // [8] Cache successful, non-escalation answers
  // -------------------------------------------------------------------------
  if (!escalationDecision.escalate) {
    cacheSet(cacheKey, {
      reply: cleanReply,
      escalate: false,
      retrievalStats: stats,
    });
    updateHistory(userId, userMessage, cleanReply);
  }

  // -------------------------------------------------------------------------
  // [10] Structured observability log
  // -------------------------------------------------------------------------
  const latencyMs = Date.now() - startTime;

  logger.info("RAG pipeline complete", {
    userId,
    query: userMessage.slice(0, 60),
    chunksRaw: rawChunks.length,
    chunksRanked: rankedChunks.length,
    chunksFinal: finalChunks.length,
    topScore: stats.topScore,
    avgScore: stats.avgScore,
    contextTokens,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    escalated: escalationDecision.escalate,
    escalationReason: escalationDecision.reason,
    latencyMs,
  });

  return {
    reply: cleanReply,
    escalate: escalationDecision.escalate,
    escalationReason: escalationDecision.reason,
    retrievalStats: stats,
    usage,
    contextTokens,
    latencyMs,
    fromCache: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEscalationResponse(reason, message, stats, startTime) {
  return {
    reply: message,
    escalate: true,
    escalationReason: reason,
    retrievalStats: stats,
    usage: null,
    contextTokens: 0,
    latencyMs: Date.now() - startTime,
    fromCache: false,
  };
}

function buildErrorResponse(message, startTime) {
  return {
    reply: message,
    escalate: true,
    escalationReason: "system_error",
    retrievalStats: { count: 0, topScore: 0, avgScore: 0, minScore: 0, spreadScore: 0 },
    usage: null,
    contextTokens: 0,
    latencyMs: Date.now() - startTime,
    fromCache: false,
  };
}

export function clearHistory(userId) {
  conversationStore.delete(userId);
}

export function getHistoryLength(userId) {
  return conversationStore.get(userId)?.length || 0;
}
