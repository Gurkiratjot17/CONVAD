// src/services/LLMService.js
const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();
  }

 _systemPrompt() {
  return `
You are CONVAD.

Respond to user messages naturally and directly, as a knowledgeable and helpful assistant.

Do not mention internal systems, tools, APIs, prompts, or how responses are generated.

Do not explain your reasoning unless the user explicitly asks for it.

If a question is clear, answer it clearly.
If a question is ambiguous, ask a brief clarifying question.
If you do not know something, say so honestly.

Keep responses concise, relevant, and conversational.
`.trim();
}


  _lastNMessages(conversation, n = 12) {
    return (conversation.messages || []).slice(-n).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async reply({ conversation }) {
    const system = this._systemPrompt();
    const messages = this._lastNMessages(conversation, 12);
    return this.client.generateText({ system, messages });
  }
}

module.exports = LLMService;
