const { randomUUID } = require("crypto");

const LLMService = require("./LLMService");
const InMemoryConversationRepository = require("../repositories/InMemoryConversationRepository");
const IntentRouter = require("./IntentRouter");
const TaskPlanner = require("./TaskPlanner");
const TaskExecutor = require("./TaskExecutor");

class ConversationService {
  constructor() {
    this.llmService = new LLMService();
    this.repo = InMemoryConversationRepository.getInstance();
    this.intentRouter = new IntentRouter();
    this.taskPlanner = new TaskPlanner();
    this.taskExecutor = new TaskExecutor();
  }

  async handleUserMessage({ userId, conversationId, text }) {
    const conv = this._createOrLoadConversation({ userId, conversationId });

    const userMsg = this._makeMessage("user", text);
    conv.messages.push(userMsg);

    const intent = this.intentRouter.route(text, conv);

    let assistantText = "";
    let pendingKeywords = undefined;
    let pendingLLMMeta = undefined;

    if (intent.type === "chat") {
      try {
        // NEW: get normal reply + backend keywords (not shown to user)
        const { reply, keywords, meta } = await this.llmService.replyWithKeywords({
          conversation: conv,
        });

        assistantText = reply;

        // Store keywords at conversation level (latest)
        conv.meta = conv.meta || {};
        conv.meta.lastKeywords = keywords;

        pendingKeywords = keywords;
        pendingLLMMeta = meta;

        // DEBUG: print keywords to terminal
        if (process.env.DEBUG_KEYWORDS === "true") {
          console.log("[KEYWORDS]", {
            conversationId: conv.id,
            keywords,
          });
        }
      } catch (e) {
        console.error("LLM error:", e);
        assistantText = "I couldn't reach the AI service right now. Please try again.";
      }
    } else {
      // Task path (deterministic tools)
      const plan = this.taskPlanner.plan(intent, text, conv);

      if (plan.requiresClarification) {
        assistantText = `To run **${plan.toolName}**, I still need: ${plan.missingParams.join(
          ", "
        )}.`;
      } else {
        const result = await this.taskExecutor.execute(plan);

        if (!result.ok) {
          assistantText = `Task **${plan.toolName}** failed: ${result.error || "unknown error"}`;
        } else {
          assistantText =
            result.summary ||
            `Task **${plan.toolName}** completed.\n\n${JSON.stringify(result.data, null, 2)}`;
        }
      }
    }

    const assistantMsg = this._makeMessage("assistant", assistantText);

    // NEW: attach keywords + OpenAI usage to the assistant message meta
    assistantMsg.meta = assistantMsg.meta || {};
    if (typeof pendingKeywords !== "undefined") assistantMsg.meta.keywords = pendingKeywords;
    if (typeof pendingLLMMeta !== "undefined") assistantMsg.meta.openai = pendingLLMMeta;

    conv.messages.push(assistantMsg);

    this.repo.save(conv);

    return {
      conversationId: conv.id,
      messages: conv.messages,
      lastReply: assistantMsg,
      intent,
      // DO NOT return keywords to client unless debugging
      // debug: { keywords: assistantMsg.meta.keywords }
    };
  }

  async getConversation(conversationId) {
    return this.repo.load(conversationId);
  }

  _createOrLoadConversation({ userId, conversationId }) {
    if (conversationId) {
      const existing = this.repo.load(conversationId);
      if (existing) return existing;
    }

    const id = conversationId || randomUUID();
    const conv = {
      id,
      userId,
      createdAt: new Date().toISOString(),
      messages: [],
      meta: {}, // NEW: conversation-level metadata
    };

    this.repo.save(conv);
    return conv;
  }

  _makeMessage(role, content) {
    return {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      meta: {},
    };
  }
}

module.exports = ConversationService;
