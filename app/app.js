let currentConversationId = null;

const listEl = document.getElementById("conversationList");
const messagesEl = document.getElementById("messages");
const titleEl = document.getElementById("chatTitle");
const inputEl = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const newBtn = document.getElementById("newChatBtn");

function fmt(dt) {
  try { return new Date(dt).toLocaleString(); } catch { return ""; }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderConversation(conv) {
  titleEl.textContent = conv.title || (conv.id ? `Conversation #${conv.id}` : "New chat");
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
  const res = await fetch("/api/conversations");
  const data = await res.json();

  if (!data.ok) {
    console.error("Failed to load conversations:", data.error);
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

  const res = await fetch(`/api/conversations/${id}`);
  const data = await res.json();

  if (!data.ok) {
    alert(data.error || "Failed to open conversation");
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

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  autoGrow();
  sendBtn.disabled = true;

  // Optimistic user bubble
  const row = document.createElement("div");
  row.className = "row user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: currentConversationId, text }),
    });

    const data = await res.json();

    if (!data.ok) {
      alert(data.error || "Request failed");
      return;
    }

    const conv = data.conversation;
    currentConversationId = conv.id;

    renderConversation(conv);
    await loadConversationList();
  } catch (e) {
    console.error(e);
    alert("Network error");
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", sendMessage);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

newBtn.addEventListener("click", async () => {
  currentConversationId = null;
  titleEl.textContent = "New chat";
  messagesEl.innerHTML = "";
  inputEl.focus();
  await loadConversationList();
});

loadConversationList();
