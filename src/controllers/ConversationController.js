const ConversationService = require("../services/ConversationService");

class ConversationController {
  constructor() {
    this.conversationService = new ConversationService();
  }

  async postMessage(req, res) {
    try {
      const { userId, message, conversationId } = req.body || {};

      if (!userId || !message) {
        return res.status(400).json({ error: "userId and message are required" });
      }

      const result = await this.conversationService.handleUserMessage({
        userId,
        conversationId: conversationId || null,
        text: String(message),
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  async getConversation(req, res) {
    try {
      const { id } = req.params;
      const conv = await this.conversationService.getConversation(id);

      if (!conv) return res.status(404).json({ error: "Conversation not found" });

      return res.json(conv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = ConversationController;
