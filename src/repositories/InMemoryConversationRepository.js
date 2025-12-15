class InMemoryConversationRepository {
  constructor() {
    this.store = new Map();
  }

  static getInstance() {
    if (!InMemoryConversationRepository._instance) {
      InMemoryConversationRepository._instance = new InMemoryConversationRepository();
    }
    return InMemoryConversationRepository._instance;
  }

  save(conversation) {
    this.store.set(conversation.id, conversation);
  }

  load(conversationId) {
    return this.store.get(conversationId) || null;
  }
}

module.exports = InMemoryConversationRepository;
