const StreamingChatService = require("../services/StreamingChatService");
const AdEventRepository = require("../repositories/AdEventRepository");
const UserRepository = require("../repositories/UserRepository");

/*
 * Service instances:
 * - StreamingChatService → handles conversation + LLM + ad pipeline
 * - AdEventRepository → logs user interactions with ads
 * - UserRepository → fetches user data
 */
const service = new StreamingChatService();
const adEvents = new AdEventRepository();
const users = new UserRepository();

/*
 * Returns current authenticated user profile.
 */
async function getMe(req, res) {
  try {
    const user = await users.getById(req.userId);

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/*
 * Lists all conversations for the authenticated user.
 */
async function listConversations(req, res) {
  try {
    const conversations = await service.listConversations(req.userId);
    res.json({ ok: true, conversations });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/*
 * Retrieves a single conversation.
 * Includes ownership check to prevent access to other users' conversations.
 */
async function getConversation(req, res) {
  try {
    const conversation = await service.getConversation(req.params.id);

    if (!conversation || conversation.userId !== req.userId) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, conversation });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

/*
 * Streams chat responses using Server-Sent Events (SSE).
 *
 * Flow:
 * - Validate input
 * - Set SSE headers
 * - Stream tokens from LLM in real-time
 * - Send final response including ads + metadata
 */
async function streamChat(req, res) {
  try {
    const { conversationId, text } = req.body || {};

    /*
     * Validate user input.
     */
    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    /*
     * Set SSE headers for real-time streaming.
     */
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");  // disables proxy buffering
    res.flushHeaders?.();

    /*
     * Send initial ping to establish connection.
     */
    res.write(`event: ping\ndata: {}\n\n`);

    /*
     * Keep connection alive (important for proxies / long responses).
     */
    const keepAlive = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

     /*
     * Clean up on client disconnect.
     */
    req.on("close", () => {
      clearInterval(keepAlive);
    });

     /*
     * Execute chat pipeline:
     * - LLM streaming
     * - context extraction
     * - ad selection
     */
    const result = await service.streamChat({
      userId: req.userId,
      conversationId: conversationId ?? null,
      text,
      onToken: (tok) => {
        res.write(`data: ${JSON.stringify({ token: tok })}\n\n`);
      },
    });

    clearInterval(keepAlive);

    /*
     * Send final event with conversation metadata + ads.
     */
    res.write(
      `event: done\ndata: ${JSON.stringify({
        conversationId: result.conversationId,
        ads: result.ads || [],
        meta: result.meta || null,
      })}\n\n`
    );

    res.end();
  } catch (e) {
    console.error(e);

  
    /*
     * Send SSE error event if something fails mid-stream.
     */
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    } catch {}
    res.end();
  }
}

/*
 * Logs ad click interaction.
 * This represents explicit user engagement.
 */
async function logAdClick(req, res) {
  try {
    const adId = Number(req.params.adId);
    if (Number.isNaN(adId)) {
      return res.status(400).json({ ok: false, error: "adId must be numeric" });
    }

    const { conversationId, snapshotId, decisionId, meta } = req.body || {};
    const convId = Number(conversationId);

    if (!convId || Number.isNaN(convId)) {
      return res.status(400).json({ ok: false, error: "conversationId is required" });
    }

    await adEvents.logEvent({
      conversationId: convId,
      snapshotId: snapshotId ? Number(snapshotId) : null,
      adId,
      eventType: "click",
      eventMeta: { decisionId: decisionId ?? null, ...(meta || {}) },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/*
 * Logs ad hide interaction.
 * Represents negative feedback / user rejection.
 */
async function logAdHide(req, res) {
  try {
    const adId = Number(req.params.adId);
    if (Number.isNaN(adId)) {
      return res.status(400).json({ ok: false, error: "adId must be numeric" });
    }

    const { conversationId, snapshotId, decisionId, meta } = req.body || {};
    const convId = Number(conversationId);

    if (!convId || Number.isNaN(convId)) {
      return res.status(400).json({ ok: false, error: "conversationId is required" });
    }

    await adEvents.logEvent({
      conversationId: convId,
      snapshotId: snapshotId ? Number(snapshotId) : null,
      adId,
      eventType: "hide",
      eventMeta: { decisionId: decisionId ?? null, ...(meta || {}) },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/*
 * Logs ad render event.
 * IMPORTANT:
 * This is the key signal for what the user actually SAW.
 * Used by IntentPolicyGate for frequency capping.
 */
async function logAdRender(req, res) {
  try {
    const adId = Number(req.params.adId);
    if (Number.isNaN(adId)) {
      return res.status(400).json({ ok: false, error: "adId must be numeric" });
    }

    const { conversationId, snapshotId, decisionId, meta } = req.body || {};
    const convId = Number(conversationId);

    if (!convId || Number.isNaN(convId)) {
      return res.status(400).json({ ok: false, error: "conversationId is required" });
    }

    await adEvents.logEvent({
      conversationId: convId,
      snapshotId: snapshotId ? Number(snapshotId) : null,
      adId,
      eventType: "IMPRESSION_RENDERED",
      eventMeta: { decisionId: decisionId ?? null, ...(meta || {}) },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = {
  getMe,
  listConversations,
  getConversation,
  streamChat,
  logAdClick,
  logAdHide,
  logAdRender,
};