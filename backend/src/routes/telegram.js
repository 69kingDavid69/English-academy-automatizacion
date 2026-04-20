import TelegramBot from "node-telegram-bot-api";
import { config } from "../config/env.js";
import { processQuery } from "../services/rag.js";
import { logEscalation } from "../services/escalation.js";
import { logger } from "../middleware/logger.js";
import { detectLanguage, localizedMessages } from "../utils/language.js";

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let bot = null;
let adminBot = null;

// Maps escalation message_id (sent to admin) → { userChatId, questionId, userMessage }
const pendingEscalations = new Map();

export function getBot() {
  return bot;
}

export function getAdminBot() {
  return adminBot;
}

export function getPendingEscalations() {
  return pendingEscalations;
}

export function setupTelegram(app) {
  if (config.telegram.mode === "none") {
    logger.info("Telegram bot disabled (mode: none)");
    // Still create admin bot for escalation notifications if token is provided
    if (config.telegram.adminToken) {
      adminBot = new TelegramBot(config.telegram.adminToken);
      logger.info("Admin bot initialized for escalation notifications");
    }
    return null;
  }

  if (config.telegram.mode === "webhook") {
    bot = new TelegramBot(config.telegram.token);

    // Register webhook endpoint
    app.post(
      `/bot${config.telegram.token}`,
      (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      }
    );

    logger.info("Telegram bot started in webhook mode");
  } else {
    // Polling mode for local development
    bot = new TelegramBot(config.telegram.token, { polling: true });
    logger.info("Telegram bot started in polling mode");
  }

  bot.on("message", handleMessage);
  bot.on("polling_error", (err) => logger.error("Telegram polling error", { error: err.message }));

  // Create admin bot for escalation notifications (no polling needed)
  if (config.telegram.adminToken) {
    adminBot = new TelegramBot(config.telegram.adminToken);
    logger.info("Admin bot initialized for escalation notifications");
  } else {
    logger.warn("No admin bot token configured. Escalation notifications will use main bot.");
  }

  return bot;
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || chatId);
  const username = msg.from?.username || msg.from?.first_name || "unknown";
  const userMessage = msg.text?.trim();

  if (!userMessage) return;

  // Check if this is an admin reply to an escalation
  if (String(chatId) === config.escalation.chatId && msg.reply_to_message) {
    return handleAdminReply(msg);
  }

  if (userMessage.startsWith("/")) return handleCommand(bot, msg, chatId, userId);

  // Show typing indicator
  await bot.sendChatAction(chatId, "typing").catch(() => {});

  try {
    const result = await processQuery({ userId, userMessage });

    await bot.sendMessage(chatId, result.reply, { parse_mode: "Markdown" });

    if (result.escalate) {
      const entry = await logEscalation({
        userId,
        username,
        userMessage,
        botReply: result.reply,
        retrievalStats: result.retrievalStats,
        escalationReason: result.escalationReason,
        channel: "telegram",
      });

      // Send escalation to admin and store mapping for reply-back
      await sendEscalationWithMapping(entry, chatId);

      const lang = detectLanguage(userMessage);
      const notificationMsg = lang === 'es' 
        ? "Se ha notificado a un asesor y se comunicará contigo en breve. Nuestro horario es de lunes a viernes de 8am a 7pm."
        : "An advisor has been notified and will contact you shortly. Our hours are Monday-Friday 8am-7pm.";
      await bot.sendMessage(chatId, notificationMsg);
    }

    logger.info("Telegram message handled", {
      userId,
      escalated: result.escalate,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    logger.error("Telegram message error", { error: err.message, userId });
    const lang = detectLanguage(userMessage);
    const errorMsg = lang === 'es' 
      ? "Lo siento, estoy teniendo dificultades técnicas. Por favor, inténtalo de nuevo en un momento o contáctanos directamente."
      : "Sorry, I'm having technical difficulties. Please try again in a moment or contact us directly.";
    await bot.sendMessage(chatId, errorMsg);
  }
}

/**
 * Sends escalation notification to admin and stores the message mapping
 * so that when admin replies, we can route it back to the original user.
 */
async function sendEscalationWithMapping(entry, userChatId) {
  const notificationBot = adminBot || bot;
  if (!config.escalation.chatId || !notificationBot) return;

  try {
    const score = entry.retrievalStats?.topScore;
    const escapedUserMessage = escapeHtml(entry.userMessage);
    const escapedUsername = escapeHtml(entry.username || "unknown");
    const escapedChannel = escapeHtml(entry.channel);
    const escapedReason = escapeHtml(entry.escalationReason || "unknown");
    
    const text =
      `<b>Escalation Required</b>\n` +
      `Channel: ${escapedChannel}\n` +
      `User: @${escapedUsername} (ID: ${entry.userId})\n` +
      `Message: "${escapedUserMessage}"\n` +
      `Reason: ${escapedReason}\n` +
      `Confidence: ${score != null ? (score * 100).toFixed(0) + "%" : "N/A"}\n` +
      `Time: ${entry.timestamp}\n\n` +
      `<i>Reply to this message to respond directly to the user.</i>`;

    const sent = await notificationBot.sendMessage(config.escalation.chatId, text, {
      parse_mode: "HTML",
    });

    // Store mapping: admin message_id → user info
    pendingEscalations.set(sent.message_id, {
      userChatId: String(userChatId),
      questionId: entry.id,
      userMessage: entry.userMessage,
      username: entry.username,
      timestamp: Date.now(),
    });

    logger.info("Escalation sent to admin with reply mapping", {
      adminMessageId: sent.message_id,
      userChatId,
      escalationId: entry.id,
    });
  } catch (err) {
    logger.error("Failed to send escalation to admin", { error: err.message });
  }
}

/**
 * Handles admin reply to an escalation message.
 * Routes the response back to the original user.
 */
async function handleAdminReply(msg) {
  const repliedToId = msg.reply_to_message.message_id;
  const pending = pendingEscalations.get(repliedToId);

  if (!pending) {
    logger.warn("Admin replied to unknown message", { messageId: repliedToId });
    return;
  }

  const adminReply = msg.text?.trim();
  if (!adminReply) return;

  try {
    const responseText =
      `*Response from our team:*\n\n${adminReply}\n\n` +
      `_If you have more questions, feel free to ask!_`;

    await bot.sendMessage(pending.userChatId, responseText, {
      parse_mode: "Markdown",
    });

    // Confirm to admin that reply was delivered
    await bot.sendMessage(
      msg.chat.id,
      `Reply delivered to @${pending.username || "user"} (${pending.userChatId}).`,
      { reply_to_message_id: msg.message_id }
    );

    pendingEscalations.delete(repliedToId);

    logger.info("Admin reply delivered to user", {
      userChatId: pending.userChatId,
      escalationId: pending.questionId,
    });
  } catch (err) {
    logger.error("Failed to deliver admin reply to user", {
      error: err.message,
      userChatId: pending.userChatId,
    });

    await bot.sendMessage(
      msg.chat.id,
      `Failed to deliver reply. The user may have blocked the bot.`,
      { reply_to_message_id: msg.message_id }
    ).catch(() => {});
  }
}

function handleCommand(bot, msg, chatId, userId) {
  const cmd = msg.text.split(" ")[0].toLowerCase();

  switch (cmd) {
    case "/start":
      bot.sendMessage(
        chatId,
        "Welcome to the Language Academy assistant! I can help you with information about our courses, pricing, schedules, and enrollment.\n\nWhat would you like to know?"
      );
      break;
    case "/help":
      bot.sendMessage(
        chatId,
        "I can answer questions about:\n- Course prices and levels\n- Class schedules\n- Enrollment process\n- Certifications\n\nJust ask in plain language!"
      );
      break;
    case "/reset":
      import("../services/rag.js").then(({ clearHistory }) => clearHistory(userId));
      bot.sendMessage(chatId, "Conversation history cleared. How can I help you?");
      break;
    default:
      bot.sendMessage(chatId, "Unknown command. Type /help for assistance.");
  }
}

// Cleanup old pending escalations (older than 48h) every hour
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const [msgId, data] of pendingEscalations) {
    if (data.timestamp < cutoff) {
      pendingEscalations.delete(msgId);
    }
  }
}, 60 * 60 * 1000);
