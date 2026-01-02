const express = require("express");
const StreamingChatService = require("../services/StreamingChatService");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const service = new StreamingChatService();

router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const conversations = await service.listConversations(req.userId);
    res.json({ ok: true, conversations });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const conversation = await service.getConversation(req.params.id);
    if (!conversation || conversation.userId !== req.userId) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    res.json({ ok: true, conversation });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ✅ streaming endpoint
router.post("/chat/stream", requireAuth, async (req, res) => {
  try {
    const { conversationId, text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    // SSE headers (no buffering)
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // ✅ send something immediately (forces browser to start streaming)
    res.write(`event: ping\ndata: {}\n\n`);

    // ✅ keepalive ping every 15s so proxies don't kill the connection
    const keepAlive = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    // if client disconnects, stop work / stop timer
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
      `event: done\ndata: ${JSON.stringify({ conversationId: result.conversationId })}\n\n`
    );
    res.end();
  } catch (e) {
    console.error(e);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    } catch {}
    res.end();
  }
});


module.exports = router;
