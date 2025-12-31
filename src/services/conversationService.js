const ConversationRepository = require("../repositories/ConversationRepository");
const LLMService = require("./LLMService");
const ContextBuilder = require("./ContextBuilder");

class ConversationService {
  constructor() {
    this.repo = new ConversationRepository();
    this.llm = new LLMService();

    this.contextBuilder = new ContextBuilder({ repo: this.repo });

    this.LAST_N = 6; // pick what you want
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

    const messages = await this.contextBuilder.build({
      conversationId: convId,
      lastN: this.LAST_N,
    });

    

    const reply = await this.llm.reply({ messages });

    await this.repo.addMessage({
      conversationId: convId,
      role: "assistant",
      content: reply,
    });

    const updated = await this.repo.getConversation(convId);

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
}

module.exports = ConversationService;
