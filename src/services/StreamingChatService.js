const ConversationRepository = require("../repositories/ConversationRepository");
const LLMService = require("./LLMService");
const OpenAIClient = require("./OpenAIClient");

class StreamingChatService {
  constructor() {
    this.repo = new ConversationRepository();
    this.llm = new LLMService();
    this.client = new OpenAIClient();
  }

  async streamChat({ userId, conversationId, text, onToken }) {
    let convId = conversationId ? Number(conversationId) : null;
    if (conversationId && Number.isNaN(convId)) throw new Error("conversationId must be numeric");

    if (!convId) {
      convId = await this.repo.createConversation({ userId, title: null });
    }

    await this.repo.addMessage({ conversationId: convId, role: "user", content: text });

    const conv = await this.repo.getConversation(convId);
    const system = this.llm.systemPrompt();

    const messages = (conv.messages || []).slice(-12).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let fullReply = "";

    await this.client.chatStream({
      system,
      messages,
      onDelta: (delta) => {
        fullReply += delta;
        onToken(delta);
      },
    });

   

    await this.repo.addMessage({ conversationId: convId, role: "assistant", content: fullReply });

    // title if missing
    const updated = await this.repo.getConversation(convId);
    if (!updated.title) {
      const firstUser = updated.messages.find((m) => m.role === "user")?.content || "";
      const title = firstUser.trim().slice(0, 60);
      if (title) await this.repo.updateTitle(convId, title);
    }

    return { conversationId: convId };
  }
}

module.exports = StreamingChatService;
