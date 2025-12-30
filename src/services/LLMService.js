const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();
  }

  systemPrompt() {
    return `
You are CONVAD, a helpful assistant.
Answer clearly and naturally.
`.trim();
  }

  lastN(conversation, n = 12) {
    return (conversation.messages || []).slice(-n).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async reply({ conversation }) {
    const system = this.systemPrompt();
    const messages = this.lastN(conversation, 12);

    const raw = await this.client.chat({ system, messages });

    const reply =
      typeof raw === "string" && raw.trim()
        ? raw.trim()
        : "I’m not sure I understood—can you rephrase that?";

    return { reply };
  }
}

module.exports = LLMService;
