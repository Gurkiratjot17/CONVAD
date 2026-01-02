const ConversationRepository = require("../repositories/ConversationRepository");
class ContextBuilder {
  constructor() {
     this.repo = new ConversationRepository();
  }

  async build({ conversationId, lastN }) {
    const recent = await this.repo.getLastNMessages(conversationId, lastN);
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }
}

module.exports = ContextBuilder;
