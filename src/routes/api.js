const express = require("express");
const ConversationService = require("../services/ConversationService");

const router = express.Router();
const service = new ConversationService();

const DEFAULT_USER_ID = 1;

router.get("/conversations", async (req, res) => {
  try {
    const conversations = await service.listConversations(DEFAULT_USER_ID);
    res.json({ ok: true, conversations });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const conversation = await service.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, conversation });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { conversationId, text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    const conversation = await service.sendMessage({
      userId: DEFAULT_USER_ID,
      conversationId: conversationId ?? null,
      text,
    });

    res.json({ ok: true, conversation });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
