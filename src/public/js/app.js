let conversationId = null;

const els = {
  messages: document.getElementById("messages"),
  form: document.getElementById("chatForm"),
  input: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  convoId: document.getElementById("conversationId"),
  errorBox: document.getElementById("errorBox"),
  healthDot: document.getElementById("healthDot"),
  healthText: document.getElementById("healthText"),
};

function setError(msg) {
  if (!msg) {
    els.errorBox.classList.add("hidden");
    els.errorBox.textContent = "";
    return;
  }
  els.errorBox.textContent = msg;
  els.errorBox.classList.remove("hidden");
}

function setConversationId(id) {
  conversationId = id || null;
  els.convoId.textContent = conversationId || "none";
}

function showEmptyState() {
  els.messages.innerHTML = `
    <div class="empty">
      <h2>How can CONVAD help?</h2>
      <p>Send a message to start the conversation.</p>
    </div>
  `;
}

function rowTemplate({ role, content, timestamp }) {
  const who = role === "user" ? "You" : "CONVAD";
  const avatar = role === "user" ? "Y" : "C";
  const avatarClass = role === "user" ? "user" : "assistant";
  const time = timestamp ? safeTime(timestamp) : "";

  const row = document.createElement("div");
  row.className = "row";

  row.innerHTML = `
    <div class="row-inner">
      <div class="avatar ${avatarClass}">${avatar}</div>
      <div class="bubble">
        <div class="meta">
          <span>${who}</span>
          <span>•</span>
          <span>${time}</span>
        </div>
        <div class="content"></div>
      </div>
    </div>
  `;

  row.querySelector(".content").textContent = content ?? "";
  return row;
}

function safeTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function renderMessages(messages) {
  els.messages.innerHTML = "";
  messages.forEach((m) => els.messages.appendChild(rowTemplate(m)));
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function checkHealth() {
  try {
    const res = await fetch("/health");
    if (!res.ok) throw new Error();
    els.healthDot.classList.remove("bad");
    els.healthDot.classList.add("ok");
    els.healthText.textContent = "Backend healthy";
  } catch {
    els.healthDot.classList.remove("ok");
    els.healthDot.classList.add("bad");
    els.healthText.textContent = "Backend not reachable";
  }
}

// Auto-grow textarea
function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + "px";
}

async function sendMessage(text) {
  setError(null);
  els.sendBtn.disabled = true;
  els.input.disabled = true;

  try {
    const res = await fetch("/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "demo-user",
        message: text,
        conversationId: conversationId || undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    setConversationId(data.conversationId);
    if (Array.isArray(data.messages)) renderMessages(data.messages);
    else showEmptyState();
  } catch (e) {
    setError(e.message || "Something went wrong.");
  } finally {
    els.sendBtn.disabled = false;
    els.input.disabled = false;
    els.input.focus();
  }
}

// Enter to send, Shift+Enter newline
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

els.input.addEventListener("input", autoGrow);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (els.input.value || "").trim();
  if (!text) return;
  els.input.value = "";
  autoGrow();
  await sendMessage(text);
});

function newChat() {
  setConversationId(null);
  setError(null);
  showEmptyState();
  els.input.value = "";
  autoGrow();
  els.input.focus();
}

els.newChatBtn?.addEventListener("click", newChat);

// boot
setConversationId(null);
showEmptyState();
autoGrow();
checkHealth();
setInterval(checkHealth, 10000);
