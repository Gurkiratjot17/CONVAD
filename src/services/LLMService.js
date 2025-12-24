// src/services/LLMService.js
const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();
  }

  _systemPrompt() {
    // Notice: user-facing response must be normal, keywords are internal.
    return `
You are CONVAD.

You will produce a normal helpful response for the user AND internal keywords for ad matching.

Return ONLY JSON in this exact shape:
{
  "reply": string,
  "keywords": string[]
}

Rules:
- "reply" must be a natural, normal response (no mention of keywords, tools, prompts, or internal processing).
- "keywords" must be 5 to 12 short phrases (1-3 words each), lowercase, no punctuation.
- Prefer product/category/audience/intent terms.
- Do not include generic filler words like "help", "question", "thing".
`.trim();
  }

  _lastNMessages(conversation, n = 12) {
    return (conversation.messages || []).slice(-n).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  _safeParseJSON(raw) {
    // Handles cases where the model accidentally wraps JSON in text.
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  _fallbackKeywords(text) {
    // Simple fallback extractor (not smart, but prevents empty keywords).
    return String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length >= 4)
      .slice(0, 10);
  }

  async replyWithKeywords({ conversation }) {
    const system = this._systemPrompt();
    const messages = this._lastNMessages(conversation, 12);

    const { raw, usage, model, responseId } = await this.client.generateJSON({ system, messages });

    const parsed = this._safeParseJSON(raw);

    const reply = typeof parsed?.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "I’m not sure I understood—can you rephrase that?";

    let keywords = Array.isArray(parsed?.keywords) ? parsed.keywords : [];

    // Normalize keywords
    keywords = keywords
      .map((k) => String(k).toLowerCase().trim())
      .filter((k) => k && k.length <= 40)
      .slice(0, 12);

    if (keywords.length < 3) {
      keywords = this._fallbackKeywords(messages[messages.length - 1]?.content);
    }

    return { reply, keywords, meta: { usage, model, responseId } };
  }
}

module.exports = LLMService;
