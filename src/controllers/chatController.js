const StreamingChatService = require("../services/StreamingChatService");
const AdEventRepository = require("../repositories/AdEventRepository");
const UserRepository = require("../repositories/UserRepository");

const service = new StreamingChatService();
const adEvents = new AdEventRepository();
const users = new UserRepository();

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

async function listConversations(req, res) {
  try {
    const conversations = await service.listConversations(req.userId);
    res.json({ ok: true, conversations });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

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

async function streamChat(req, res) {
  try {
    const { conversationId, text } = req.body || {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // immediate ping
    res.write(`event: ping\ndata: {}\n\n`);

    // keepalive
    const keepAlive = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
    });

    const result = await service.streamChat({
      userId: req.userId,
      conversationId: conversationId ?? null,
      text,
      onToken: (tok) => {
        res.write(`data: ${JSON.stringify({ token: tok })}\n\n`);
      },
    });

    clearInterval(keepAlive);

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
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    } catch {}
    res.end();
  }
}

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