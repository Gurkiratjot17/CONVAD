class ContextBuilder {
  constructor({ repo }) {
    this.repo = repo;
  }

  async build({ conversationId, lastN = 12 }) {
    const recent = await this.repo.getLastNMessages(conversationId, lastN);
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }
}

module.exports = ContextBuilder;
