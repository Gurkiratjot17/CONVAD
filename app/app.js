// app/app.js

let currentConversationId = null;

document.addEventListener("DOMContentLoaded", () => {
  // ---------- DOM ----------
  const listEl = document.getElementById("conversationList");
  const messagesEl = document.getElementById("messages");
  const titleEl = document.getElementById("chatTitle");
  const inputEl = document.getElementById("textInput");
  const sendBtn = document.getElementById("sendBtn");
  const newBtn = document.getElementById("newChatBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  console.log("✅ app.js loaded", {
    listEl: !!listEl,
    messagesEl: !!messagesEl,
    titleEl: !!titleEl,
    inputEl: !!inputEl,
    sendBtn: !!sendBtn,
    newBtn: !!newBtn,
    logoutBtn: !!logoutBtn,
  });

  const themeBtn = document.getElementById("themeBtn");
const menuBtn = document.getElementById("menuBtn");
const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("backdrop");

// --- Theme init ---
(function initTheme() {
  const saved = localStorage.getItem("convad_theme");
  const theme = saved === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
})();

function syncThemeIcon() {
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  if (themeBtn) themeBtn.textContent = theme === "dark" ? "🌙" : "☀️";
}
syncThemeIcon();

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("convad_theme", next);
    syncThemeIcon();
  });
}

// --- Mobile sidebar drawer ---
function openSidebar() {
  if (!sidebar || !backdrop) return;
  sidebar.classList.add("open");
  backdrop.classList.add("show");
}
function closeSidebar() {
  if (!sidebar || !backdrop) return;
  sidebar.classList.remove("open");
  backdrop.classList.remove("show");
}

if (menuBtn) menuBtn.addEventListener("click", openSidebar);
if (backdrop) backdrop.addEventListener("click", closeSidebar);


  // If critical elements are missing, stop early with a clear error
  if (!messagesEl || !titleEl || !inputEl || !sendBtn) {
    console.error(
      "❌ Missing required DOM elements. Check your HTML ids: conversationList, messages, chatTitle, textInput, sendBtn."
    );
    return;
  }

  // ---------- Auth ----------
  const token = localStorage.getItem("convad_token");
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

  function handleUnauthorized() {
    localStorage.removeItem("convad_token");
    window.location.href = "/login.html";
  }

  // ---------- Helpers ----------
  function fmt(dt) {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return "";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function renderConversation(conv) {
    titleEl.textContent =
      conv.title || (conv.id ? `Conversation #${conv.id}` : "New chat");
    messagesEl.innerHTML = "";

    for (const m of conv.messages || []) {
      const row = document.createElement("div");
      row.className = `row ${m.role === "user" ? "user" : "assistant"}`;

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = escapeHtml(m.content);

      row.appendChild(bubble);
      messagesEl.appendChild(row);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadConversationList() {
    if (!listEl) return;

    const res = await fetch("/api/conversations", { headers: authHeaders });
    if (res.status === 401) return handleUnauthorized();

    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      console.error("Failed to load conversations:", data?.error || "unknown error");
      return;
    }

    listEl.innerHTML = "";
    for (const c of data.conversations) {
      const item = document.createElement("div");
      item.className = "conv" + (c.id === currentConversationId ? " active" : "");
      item.onclick = () => openConversation(c.id);

      const t = document.createElement("div");
      t.className = "t";
      t.textContent = c.title || `Conversation #${c.id}`;

      const m = document.createElement("div");
      m.className = "m";
      m.textContent = fmt(c.updatedAt || c.createdAt);

      item.appendChild(t);
      item.appendChild(m);
      listEl.appendChild(item);
    }
  }

  async function openConversation(id) {
    currentConversationId = id;

    const res = await fetch(`/api/conversations/${id}`, { headers: authHeaders });
    if (res.status === 401) return handleUnauthorized();

    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      alert(data?.error || "Failed to open conversation");
      return;
    }

    renderConversation(data.conversation);
    await loadConversationList();
  }

  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }
  inputEl.addEventListener("input", autoGrow);

  // ---------- Streaming SSE Chat ----------
  function parseSSEFrame(frame) {
    let eventName = "message";
    const dataLines = [];

    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    return { eventName, dataText: dataLines.join("\n").trim() };
  }

  async function sendMessage() {
    console.log("✅ sendMessage called");

    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = "";
    autoGrow();
    sendBtn.disabled = true;

    // --- User bubble ---
    const userRow = document.createElement("div");
    userRow.className = "row user";
    const userBubble = document.createElement("div");
    userBubble.className = "bubble";
    userBubble.textContent = text;
    userRow.appendChild(userBubble);
    messagesEl.appendChild(userRow);

    // --- Assistant bubble (stream into this) ---
    const aRow = document.createElement("div");
    aRow.className = "row assistant";
    const aBubble = document.createElement("div");
    aBubble.className = "bubble";
    aBubble.textContent = "";
    aRow.appendChild(aBubble);
    messagesEl.appendChild(aRow);

    messagesEl.scrollTop = messagesEl.scrollHeight;

    let assistantText = "";

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ conversationId: currentConversationId, text }),
      });

      if (res.status === 401) return handleUnauthorized();

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `stream failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split into full SSE frames (blank line separators)
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const trimmed = frame.trim();
          if (!trimmed) continue;

          const { eventName, dataText } = parseSSEFrame(trimmed);

          if (eventName === "ping") continue;

          if (eventName === "error") {
            let payload = {};
            try {
              payload = JSON.parse(dataText || "{}");
            } catch {}
            throw new Error(payload.error || "stream error");
          }

          if (eventName === "done") {
            try {
              const payload = JSON.parse(dataText || "{}");
              if (payload?.conversationId) currentConversationId = payload.conversationId;
            } catch {}
            continue;
          }

          // Normal token frames: data: {"token":"..."}
          let payload;
          try {
            payload = JSON.parse(dataText || "{}");
          } catch {
            // fallback: treat as plain text
            assistantText += dataText;
            aBubble.textContent = assistantText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
            continue;
          }

          if (payload?.token) {
            assistantText += payload.token;
            aBubble.textContent = assistantText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      }

      await loadConversationList();
    } catch (e) {
      console.error("Fetch/stream error:", e);
      aBubble.textContent = `⚠️ ${e?.message || e}`;
    } finally {
      sendBtn.disabled = false;
    }
  }

  // ---------- Events ----------
  sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    sendMessage();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (newBtn) {
    newBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      currentConversationId = null;
      titleEl.textContent = "New chat";
      messagesEl.innerHTML = "";
      inputEl.focus();
      await loadConversationList();
    });
  }

  // Proper logout: delete session server-side + clear token client-side
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: authHeaders,
        });
      } catch {
        // ignore
      } finally {
        localStorage.removeItem("convad_token");
        window.location.href = "/login.html";
      }
    });
  }

  // ---------- Init ----------
  loadConversationList();
});
