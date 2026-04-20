import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";

const client = new OpenAI({
  apiKey: config.deepseek.apiKey,
  baseURL: config.deepseek.baseUrl,
});

/**
 * Token optimization:
 * - Uses deepseek-chat (significantly cheaper than GPT-4o)
 * - Limits max_tokens to prevent runaway costs
 * - Strips excess whitespace from context before sending
 * - Temperature 0 for deterministic, factual responses
 */
export async function chat({ systemPrompt, userMessage, conversationHistory = [] }) {
  // Compress context: collapse multiple spaces/newlines
  const compressedSystem = systemPrompt
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  const messages = [
    { role: "system", content: compressedSystem },
    ...conversationHistory.slice(-6), // Keep last 3 exchanges for context
    { role: "user", content: userMessage },
  ];

  const estimatedTokens = Math.ceil(
    messages.reduce((sum, m) => sum + m.content.length, 0) / 4
  );

  logger.debug("DeepSeek request", {
    model: config.deepseek.model,
    estimatedTokens,
    historyLength: conversationHistory.length,
  });

  try {
    const response = await client.chat.completions.create({
      model: config.deepseek.model,
      messages,
      max_tokens: 512,
      temperature: 0,
      stream: false,
    });

    const reply = response.choices[0]?.message?.content?.trim() || "";

    logger.debug("DeepSeek response", {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    });

    return {
      reply,
      usage: response.usage || null,
    };
  } catch (err) {
    logger.error("DeepSeek API error", { error: err.message, code: err.status });
    throw new Error(`LLM request failed: ${err.message}`);
  }
}
