const ConversationRepository = require("../repositories/ConversationRepository");
const LLMService = require("./LLMService");
const OpenAIClient = require("./OpenAIClient");
const ContextBuilder = require("./ContextBuilder");

class StreamingChatService {
  constructor() {
    this.repo = new ConversationRepository();
    this.llm = new LLMService();
    this.client = new OpenAIClient();
    this.contextBuilder = new ContextBuilder({ repo: this.repo });

    this.LAST_N = 6; // pick what you want
  }

  async streamChat({ userId, conversationId, text, onToken }) {
    let convId = conversationId ? Number(conversationId) : null;
    if (conversationId && Number.isNaN(convId)) throw new Error("conversationId must be numeric");

    if (!convId) {
      convId = await this.repo.createConversation({ userId, title: null });
    }

    await this.repo.addMessage({ conversationId: convId, role: "user", content: text });

    const conv = await this.repo.getConversation(convId);

  const contextmessages = await this.contextBuilder.build({
      conversationId: convId,
      lastN: this.LAST_N,
    });
    

    // ✅ IMPORTANT: stream plain text, not JSON
    const system = this.llm.replyOnlySystemPrompt({contextmessages});

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

    // ✅ After streaming finishes: classify tags (backend only)
    const tags = await this.llm.classifyTags({
      messages: [...messages, { role: "assistant", content: fullReply }],
    });

    console.log("[IntentTags]", { conversationId: convId, userId, tags });

    // title if missing
    const updated = await this.repo.getConversation(convId);
    if (!updated.title) {
      const firstUser = updated.messages.find((m) => m.role === "user")?.content || "";
      const title = firstUser.trim().slice(0, 60);
      if (title) await this.repo.updateTitle(convId, title);
    }

    return { conversationId: convId };
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

module.exports = StreamingChatService;
