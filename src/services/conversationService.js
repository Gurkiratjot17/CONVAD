const ConversationRepository = require("../repositories/ConversationRepository");
const LLMService = require("./LLMService");

class ConversationService {
  constructor() {
    this.repo = new ConversationRepository();
    this.llm = new LLMService();
  }

  async sendMessage({ userId, conversationId, text }) {
    let convId = conversationId ? Number(conversationId) : null;
    if (conversationId && Number.isNaN(convId)) {
      throw new Error("conversationId must be numeric");
    }

    if (!convId) {
      convId = await this.repo.createConversation({ userId, title: null });
    }

    await this.repo.addMessage({
      conversationId: convId,
      role: "user",
      content: text,
    });

    const convForLLM = await this.repo.getConversation(convId);
    const { reply } = await this.llm.reply({ conversation: this._toLLMConv(convForLLM) });

    await this.repo.addMessage({
      conversationId: convId,
      role: "assistant",
      content: reply,
    });

    const updated = await this.repo.getConversation(convId);

    // Auto-title based on first user message if missing
    if (!updated.title) {
      const firstUser = updated.messages.find((m) => m.role === "user")?.content || "";
      const title = firstUser.trim().slice(0, 60);
      if (title) await this.repo.updateTitle(convId, title);
      return this.repo.getConversation(convId);
    }

    return updated;
  }

  async getConversation(conversationId) {
    const id = Number(conversationId);
    if (Number.isNaN(id)) throw new Error("conversationId must be numeric");
    return this.repo.getConversation(id);
  }

  async listConversations(userId) {
    return this.repo.listConversations(userId);
  }

  // Convert DB conversation shape into the shape LLMService expects
  _toLLMConv(dbConv) {
    return {
      messages: (dbConv?.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }
}

module.exports = ConversationService;
