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
  const publicPaths = ["/login.html", "/register.html", "/verify-otp.html"];
  const path = window.location.pathname;

  // Make these available everywhere in this file
  var authHeaders = null;
  var jsonHeaders = null;

  function handleUnauthorized() {
    localStorage.removeItem("convad_token");
    window.location.href = "/login.html";
  }

  // ✅ function-scoped (NOT block-scoped) so init call works
var ensureUserBadge = function () {
  if (!sidebar) return null;

  // Prefer your existing HTML strip (ChatGPT-style)
  const strip = document.getElementById("sidebarUserStrip");
  if (strip) return strip;

  // Fallback: if strip is missing, do NOT create a second one.
  // (This prevents duplicates.)
  console.warn("⚠️ sidebarUserStrip not found in HTML. Add it to sidebar.");
  return null;
};

var setAvatar = function ({ profileImageUrl, firstName, lastName }) {
  // Use HTML id
  const avatar = document.getElementById("sidebarUserAvatar");
  if (!avatar) return;

  avatar.innerHTML = "";

  const initials =
    `${(firstName || "").trim()[0] || ""}${(lastName || "").trim()[0] || ""}`
      .toUpperCase()
      .trim() || "U";

  if (profileImageUrl) {
    const img = document.createElement("img");
    img.src = profileImageUrl;
    img.alt = "User avatar";
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.onerror = () => {
      avatar.innerHTML = "";
      avatar.textContent = initials;
    };
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials;
  }
};

var loadCurrentUser = async function () {
  if (!authHeaders) return;

  // Ensure strip exists (but don't create duplicates)
  const strip = ensureUserBadge();
  if (!strip) return;

  try {
    const res = await fetch("/api/me", { headers: authHeaders });
    if (res.status === 401) return handleUnauthorized();

    const data = await res.json().catch(() => null);
    if (!data?.ok || !data.user) {
      console.warn("⚠️ /api/me returned:", data);
      return;
    }

    const u = data.user;

    // Use HTML ids
    const nameEl = document.getElementById("sidebarUserName");
    const emailEl = document.getElementById("sidebarUserEmail");

    const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "User";
    if (nameEl) nameEl.textContent = fullName;
    if (emailEl) emailEl.textContent = u.email || "";

    setAvatar({
      profileImageUrl: u.profileImageUrl || null,
      firstName: u.firstName,
      lastName: u.lastName,
    });
  } catch (e) {
    console.warn("Failed to load current user:", e);
  }
};


  if (!publicPaths.includes(path)) {
    const token = localStorage.getItem("convad_token");
    if (!token) {
      window.location.href = "/login.html";
      throw new Error("Not authenticated");
    }

    authHeaders = { Authorization: `Bearer ${token}` };
    jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };
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

  function renderMarkdownSafe(text) {
    // 1) escape HTML first (prevents injection)
    let s = escapeHtml(text);

    // 2) headings: ###, ##, #
    s = s.replace(/^###\s+(.*)$/gm, "<strong>$1</strong>");
    s = s.replace(/^##\s+(.*)$/gm, "<strong>$1</strong>");
    s = s.replace(/^#\s+(.*)$/gm, "<strong>$1</strong>");

    // 3) bold **text**
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // 4) italic *text* (avoid matching bullet "* " at line start)
    s = s.replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*/g, "$1<em>$2</em>");

    // 5) bullet lines "- " or "* "
    s = s.replace(/^\s*[-*]\s+(.*)$/gm, "• $1");

    // 6) line breaks
    s = s.replace(/\n/g, "<br>");

    return s;
  }

  // ---------- Ad Banner ----------
  let lastAdMeta = null;   // { snapshotId, decisionId, why }
  let lastAds = [];        // ads returned for latest assistant reply

  function ensureAdHost() {
    // Create a container right under the messages list if it doesn't exist
    let host = document.getElementById("adHost");
    if (host) return host;

    host = document.createElement("div");
    host.id = "adHost";
    host.style.marginTop = "10px";
    host.style.padding = "0 4px";

    // place after messages container
    messagesEl.parentNode.insertBefore(host, messagesEl.nextSibling);
    return host;
  }

  function clearAdBanner({ animate = true } = {}) {
    const host = ensureAdHost();

    // nothing to clear
    if (!host.innerHTML.trim()) {
      lastAdMeta = null;
      lastAds = [];
      return;
    }

    if (!animate) {
      host.innerHTML = "";
      host.classList.remove("fade-out");
      lastAdMeta = null;
      lastAds = [];
      return;
    }

    // trigger fade
    host.classList.add("fade-out");

    // after transition, clear DOM
    window.setTimeout(() => {
      host.innerHTML = "";
      host.classList.remove("fade-out");
      lastAdMeta = null;
      lastAds = [];
    }, 220); // slightly > 200ms transition
  }

  async function logAdEvent(type, ad) {
  if (!ad || !currentConversationId) return;
  const meta = lastAdMeta || {};
  const body = {
    conversationId: currentConversationId,
    snapshotId: meta.snapshotId ?? null,
    decisionId: meta.decisionId ?? null,
    meta: { type, why: meta.why ?? null },
  };

  const url =
    type === "click"
      ? `/api/ads/${ad.adId}/click`
      : type === "hide"
      ? `/api/ads/${ad.adId}/hide`
      : type === "render" 
      ? `/api/ads/${ad.adId}/render`
      : null; // ✅ NEW

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    if (res.status === 401) return handleUnauthorized();
  } catch (e) {
    console.warn("ad event failed:", e);
  }
}

  function renderAdBanner(ads, meta) {
    clearAdBanner();
    const host = ensureAdHost();

    lastAds = Array.isArray(ads) ? ads : [];
    lastAdMeta = meta || null;

    if (!lastAds.length) return;

    // only show the first ad for a clean banner (you can extend later)
    const ad = lastAds[0];

    const card = document.createElement("div");
    card.style.display = "flex";
    card.style.gap = "10px";
    card.style.alignItems = "center";
    card.style.border = "1px solid rgba(255,255,255,0.12)";
    card.style.borderRadius = "12px";
    card.style.padding = "10px";
    card.style.background = "rgba(255,255,255,0.04)";

    const img = document.createElement("img");
    img.src = ad.imageUrl;
    img.alt = ad.title || "Ad";
    img.style.width = "120px";
    img.style.height = "68px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "10px";
    img.loading = "lazy";

    const body = document.createElement("div");
    body.style.flex = "1";

    const label = document.createElement("div");
    label.style.fontSize = "12px";
    label.style.opacity = "0.8";
    label.textContent = "Sponsored";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginTop = "2px";
    title.textContent = ad.title || "Ad";

    const desc = document.createElement("div");
    desc.style.fontSize = "13px";
    desc.style.opacity = "0.9";
    desc.style.marginTop = "4px";
    desc.textContent = ad.description || "";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "8px";

    const cta = document.createElement("a");
    cta.href = ad.landingUrl || "#";
    cta.target = "_blank";
    cta.rel = "noopener";
    cta.textContent = "Open";
    cta.style.display = "inline-block";
    cta.style.padding = "6px 10px";
    cta.style.borderRadius = "10px";
    cta.style.textDecoration = "none";
    cta.style.border = "1px solid rgba(255,255,255,0.18)";
    cta.style.color = "inherit";

    cta.addEventListener("click", () => {
      logAdEvent("click", ad);
    });

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.textContent = "Hide";
    hideBtn.style.padding = "6px 10px";
    hideBtn.style.borderRadius = "10px";
    hideBtn.style.border = "1px solid rgba(255,255,255,0.18)";
    hideBtn.style.background = "transparent";
    hideBtn.style.color = "inherit";
    hideBtn.style.cursor = "pointer";

    hideBtn.addEventListener("click", async () => {
      await logAdEvent("hide", ad);
      clearAdBanner();
    });

    // Optional “Why this ad?” (uses meta.why)
    const whyBtn = document.createElement("button");
    whyBtn.type = "button";
    whyBtn.textContent = "Why this?";
    whyBtn.style.padding = "6px 10px";
    whyBtn.style.borderRadius = "10px";
    whyBtn.style.border = "1px solid rgba(255,255,255,0.18)";
    whyBtn.style.background = "transparent";
    whyBtn.style.color = "inherit";
    whyBtn.style.cursor = "pointer";

    whyBtn.addEventListener("click", () => {
  const why = meta?.why;
  if (!why) return alert("No explanation available.");

  const qt = (why.queryTerms || []).slice(0, 12).join(", ");
  const qText = (why.queryText || "").slice(0, 220);
  const gate = why.gate || {};
  const gateReasons = (gate.reasonCodes || []).join(", ") || "(none)";
  const constraints = gate.constraints ? JSON.stringify(gate.constraints) : "{}";

  // Also show the pipeline label from the ad itself
  const mode = ad.reason || "(unknown)";

  alert(
    `Why this ad?\n\n` +
    `Mode: ${mode}\n` +
    `Gate reasons: ${gateReasons}\n` +
    `Constraints: ${constraints}\n\n` +
    `Query terms (BM25): ${qt || "(none)"}\n` +
    `Query text: ${qText || "(none)"}`
  );
});


    actions.appendChild(cta);
    actions.appendChild(hideBtn);
    actions.appendChild(whyBtn);

    body.appendChild(label);
    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(actions);

    card.appendChild(img);
    card.appendChild(body);

    host.appendChild(card);
    // ✅ Log rendered impression only after it is actually added to the DOM
    logAdEvent("render", ad);
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
      bubble.innerHTML = renderMarkdownSafe(m.content);

      row.appendChild(bubble);
      messagesEl.appendChild(row);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    clearAdBanner();
  }

  async function loadConversationList() {
    if (!listEl) return;
    if (!authHeaders) return; // ✅ prevent calling on public pages

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

    clearAdBanner();

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
    let streamFinished = false;

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

        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const trimmed = frame.trim();
          if (!trimmed) continue;

          const { eventName, dataText } = parseSSEFrame(trimmed);

          if (eventName === "ping") continue;

          if (eventName === "error") {
            let payload = {};
            try { payload = JSON.parse(dataText || "{}"); } catch {}
            throw new Error(payload.error || "stream error");
          }

          if (eventName === "done") {
            streamFinished = true;

            try {
              const payload = JSON.parse(dataText || "{}");
              if (payload?.conversationId) currentConversationId = payload.conversationId;

              if (Array.isArray(payload?.ads)) {
                renderAdBanner(payload.ads, payload.meta || null);
              } else {
                clearAdBanner();
              }
            } catch {}

            aBubble.innerHTML = renderMarkdownSafe(assistantText);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            continue;
          }

          if (streamFinished) continue;

          let payload;
          try {
            payload = JSON.parse(dataText || "{}");
          } catch {
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

      aBubble.innerHTML = renderMarkdownSafe(assistantText);
      messagesEl.scrollTop = messagesEl.scrollHeight;

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
      clearAdBanner();
    });
  }

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
  loadCurrentUser(); // ✅ now guaranteed defined + authHeaders set
});
