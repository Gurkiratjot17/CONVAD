const OpenAIClient = require("./OpenAIClient");
const ConversationRepository = require("../repositories/ConversationRepository");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();
    this.repo = new ConversationRepository();

    // cache
    this._allowedTags = null;
    this._allowedTagsLoadedAt = 0;
    this._allowedTagsTtlMs = 5 * 60 * 1000; // refresh every 5 mins
  }

  replyOnlySystemPrompt() {
    return `
You are CONVAD, a helpful assistant.
Return ONLY the assistant's reply as plain text.
Do not output JSON.
`.trim();
  }

  async getAllowedTags() {
    const now = Date.now();
    if (this._allowedTags && (now - this._allowedTagsLoadedAt) < this._allowedTagsTtlMs) {
      return this._allowedTags;
    }

    const tags = await this.repo.listTags(); // returns ["docker","mysql",...]
    this._allowedTags = (tags || []).map(t => String(t).trim()).filter(Boolean);
    this._allowedTagsLoadedAt = now;
    return this._allowedTags;
  }

  async taggerSystemPrompt() {
    const allowed = await this.getAllowedTags();
    return `
You are an intent tagger.
Return ONLY valid JSON and nothing else.

Schema:
{ "selected_tags": [{"tag":"string","confidence":0.0}] }

Rules:
- Choose 0–4 tags from ALLOWED_TAGS only (exact match, case-sensitive).
- If none apply, selected_tags = [].
- Confidence is 0.0 to 1.0.

ALLOWED_TAGS:
${allowed.join(", ")}
`.trim();
  }

  _extractJson(raw) {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e === -1 || e <= s) return null;
    return raw.slice(s, e + 1);
  }

  async classifyTags({ messages }) {
    const system = await this.taggerSystemPrompt();

    const raw = await this.client.chat({
      system,
      messages,
    });

    const jsonStr = this._extractJson(raw);
    if (!jsonStr) return [];

    try {
      const parsed = JSON.parse(jsonStr);
      const selected = Array.isArray(parsed?.selected_tags) ? parsed.selected_tags : [];

      // hard-validate against allowed tags
      const allowed = new Set((await this.getAllowedTags()));
      return selected
        .filter(x => x && typeof x.tag === "string")
        .map(x => ({
          tag: x.tag.trim(),
          confidence: Number.isFinite(Number(x.confidence)) ? Number(x.confidence) : 0.5,
        }))
        .filter(x => allowed.has(x.tag))
        .slice(0, 4);
    } catch {
      return [];
    }
  }
}

module.exports = LLMService;
