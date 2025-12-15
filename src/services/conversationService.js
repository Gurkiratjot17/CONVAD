const { randomUUID } = require("crypto");

const InMemoryConversationRepository = require("../repositories/InMemoryConversationRepository");
const IntentRouter = require("./IntentRouter");
const TaskPlanner = require("./TaskPlanner");
const TaskExecutor = require("./TaskExecutor");
const ResponseComposer = require("./ResponseComposer");

class ConversationService {
  constructor() {
    this.repo = InMemoryConversationRepository.getInstance();
    this.intentRouter = new IntentRouter();
    this.taskPlanner = new TaskPlanner();
    this.taskExecutor = new TaskExecutor();
    this.responseComposer = new ResponseComposer();
  }

  async handleUserMessage({ userId, conversationId, text }) {
    const conv = this._createOrLoadConversation({ userId, conversationId });

    const userMsg = this._makeMessage("user", text);
    conv.messages.push(userMsg);

    const intent = this.intentRouter.route(text, conv);

    let assistantText = "";

    if (intent.type === "chat") {
      assistantText = this.responseComposer.composeChat(text, conv);
    } else {
      const plan = this.taskPlanner.plan(intent, text, conv);

      if (plan.requiresClarification) {
        assistantText = this.responseComposer.composeClarification(plan.missingParams, plan.toolName);
      } else {
        const result = await this.taskExecutor.execute(plan);
        assistantText = this.responseComposer.composeTask(result, conv, plan);
      }
    }

    const assistantMsg = this._makeMessage("assistant", assistantText);
    conv.messages.push(assistantMsg);

    this.repo.save(conv);

    return {
      conversationId: conv.id,
      messages: conv.messages,
      lastReply: assistantMsg,
      intent,
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
