(() => {
  const API_BASE = window.location.origin + "/api";
  const USER_ID = "widget_" + Math.random().toString(36).slice(2, 10);

  const trigger = document.getElementById("chat-trigger");
  const chatWindow = document.getElementById("chat-window");
  const closeBtn = document.getElementById("close-btn");
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");
  const typingEl = document.getElementById("typing-indicator");
  const escalationNotice = document.getElementById("escalation-notice");
  const unreadDot = document.getElementById("unread-dot");
  const iconOpen = trigger.querySelector(".icon-open");
  const iconClose = trigger.querySelector(".icon-close");

  let isOpen = false;
  let isSending = false;

  function openChat() {
    isOpen = true;
    chatWindow.classList.add("open");
    chatWindow.setAttribute("aria-hidden", "false");
    iconOpen.style.display = "none";
    iconClose.style.display = "block";
    unreadDot.style.display = "none";
    inputEl.focus();
    scrollToBottom();
  }

  function closeChat() {
    isOpen = false;
    chatWindow.classList.remove("open");
    chatWindow.setAttribute("aria-hidden", "true");
    iconOpen.style.display = "block";
    iconClose.style.display = "none";
  }

  trigger.addEventListener("click", () => (isOpen ? closeChat() : openChat()));
  closeBtn.addEventListener("click", closeChat);

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isSending) return;

    inputEl.value = "";
    isSending = true;
    sendBtn.disabled = true;

    appendMessage("user", text);
    showTyping(true);
    scrollToBottom();

    try {
      const res = await fetch(API_BASE + "/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, message: text, channel: "widget" }),
      });

      const data = await res.json();
      showTyping(false);
      appendMessage("bot", data.reply || "Sorry, I couldn't process that.");

      if (data.escalated) {
        escalationNotice.style.display = "flex";
      }

      if (!isOpen) {
        unreadDot.style.display = "block";
      }
    } catch {
      showTyping(false);
      appendMessage("bot", "I'm having trouble connecting right now. Please try again shortly.");
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
      scrollToBottom();
    }
  }

  function appendMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    const time = document.createElement("time");
    time.className = "msg-time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    msg.appendChild(bubble);
    msg.appendChild(time);
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function showTyping(visible) {
    typingEl.style.display = visible ? "flex" : "none";
    if (visible) scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
})();
