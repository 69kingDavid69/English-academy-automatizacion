const API_BASE = window.location.origin + "/api";
let adminToken = localStorage.getItem("adminToken") || "";

if (adminToken) { showConnected(); autoLoad(); }

// Tab navigation
document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "escalations") loadEscalations();
    if (btn.dataset.tab === "health") loadHealth();
  });
});

async function setToken() {
  const raw = document.getElementById("admin-token").value.trim();
  if (!raw) return;
  adminToken = raw;

  // Validate token BEFORE accepting it
  try {
    await apiFetch("/admin/health");
  } catch {
    document.getElementById("connect-error").textContent = "Invalid token. Try again.";
    document.getElementById("connect-error").style.display = "block";
    adminToken = "";
    return;
  }

  document.getElementById("connect-error").style.display = "none";
  localStorage.setItem("adminToken", adminToken);
  showConnected();
  autoLoad();
}

function autoLoad() {
  // Switch to health tab first — always has data, confirms token works
  switchTab("health");
  loadHealth();
  loadEscalations();
}

function switchTab(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.nav-item[data-tab="${name}"]`).classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

function showConnected() {
  document.getElementById("auth-form").style.display = "none";
  document.getElementById("auth-status").style.display = "flex";
}

function logout() {
  adminToken = "";
  localStorage.removeItem("adminToken");
  document.getElementById("auth-form").style.display = "flex";
  document.getElementById("auth-status").style.display = "none";
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- Escalations ---

async function loadEscalations() {
  const list = document.getElementById("escalation-list");
  const showResolved = document.getElementById("show-resolved").checked;
  list.innerHTML = '<div class="loader">Loading...</div>';

  try {
    let data = await apiFetch("/admin/escalations");
    if (!showResolved) data = data.filter((e) => !e.resolved);

    const badge = document.getElementById("escalation-badge");
    const pending = data.filter((e) => !e.resolved).length;
    badge.textContent = pending;
    badge.classList.toggle("visible", pending > 0);

    if (data.length === 0) {
      list.innerHTML = '<div class="empty-state">No escalations found.</div>';
      return;
    }

    list.innerHTML = data
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map((e) => renderEscalation(e))
      .join("");
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load escalations. Check your token.</div>';
  }
}

function renderEscalation(e) {
  const sim = e.similarity != null ? Math.round(e.similarity * 100) : 0;
  const barColor = sim < 40 ? "#e05252" : sim < 60 ? "#f5a623" : "#3ecf8e";
  const time = new Date(e.timestamp).toLocaleString();

  return `
    <div class="escalation-card ${e.resolved ? "resolved" : ""}" id="esc-${e.id}">
      <div class="esc-header">
        <span class="esc-channel">${e.channel}</span>
        <span class="esc-user">${e.username || e.userId}</span>
        <span class="esc-time">${time}</span>
      </div>
      <div class="esc-message">"${escHtml(e.userMessage)}"</div>
      <div class="esc-reply">Bot replied: ${escHtml(e.botReply || "—")}</div>
      <div class="esc-meta">
        <span class="confidence-label">Confidence: ${sim}%</span>
        <div class="confidence-bar-wrap">
          <div class="confidence-bar" style="width:${sim}%;background:${barColor}"></div>
        </div>
        ${
          e.resolved
            ? '<span style="color:#3ecf8e;font-size:12px">Resolved</span>'
            : `<button class="btn btn-success" onclick="resolve('${e.id}')">Mark resolved</button>`
        }
      </div>
    </div>
  `;
}

async function resolve(id) {
  try {
    await apiFetch(`/admin/escalations/${id}/resolve`, { method: "POST" });
    loadEscalations();
  } catch {
    alert("Failed to resolve escalation.");
  }
}

// --- Health ---

async function loadHealth() {
  const grid = document.getElementById("health-grid");
  grid.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const data = await apiFetch("/admin/health");
    grid.innerHTML = `
      <div class="health-card">
        <div class="health-card-label">Status</div>
        <div class="health-card-value" style="color:#3ecf8e">${data.status.toUpperCase()}</div>
      </div>
      <div class="health-card">
        <div class="health-card-label">Uptime</div>
        <div class="health-card-value">${formatUptime(data.uptime)} <span class="health-card-unit"></span></div>
      </div>
      <div class="health-card">
        <div class="health-card-label">Memory</div>
        <div class="health-card-value">${data.memoryMB}<span class="health-card-unit"> MB</span></div>
      </div>
      <div class="health-card">
        <div class="health-card-label">Last check</div>
        <div class="health-card-value" style="font-size:14px">${new Date(data.timestamp).toLocaleTimeString()}</div>
      </div>
    `;
  } catch {
    grid.innerHTML = '<div class="empty-state">Could not load health data. Check your token.</div>';
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// --- Test Query ---

async function sendTest() {
  const input = document.getElementById("test-message");
  const output = document.getElementById("test-output");
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  const placeholder = document.createElement("div");
  placeholder.className = "loader";
  placeholder.textContent = "Querying...";
  output.prepend(placeholder);

  try {
    const data = await fetch(API_BASE + "/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "admin-test", message, channel: "admin-ui" }),
    }).then((r) => r.json());

    placeholder.remove();

    const card = document.createElement("div");
    card.className = "test-result";
    card.innerHTML = `
      <div class="test-result-query">Query: "${escHtml(message)}"</div>
      <div class="test-result-reply">${escHtml(data.reply)}</div>
      <div class="test-result-meta">
        <span class="meta-item ${data.escalated ? "escalated" : "ok"}">
          ${data.escalated ? "Escalated" : "Answered"}
        </span>
        <span class="meta-item">Confidence: ${data.confidence != null ? Math.round(data.confidence * 100) + "%" : "N/A"}</span>
        <span class="meta-item">${data.latencyMs}ms</span>
      </div>
    `;
    output.prepend(card);
  } catch (err) {
    placeholder.textContent = "Error: " + err.message;
  }
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
