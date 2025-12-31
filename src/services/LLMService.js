const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
    this.client = new OpenAIClient();
  }


  systemPrompt() {
    return `
You are CONVAD, an assistant that must BOTH respond to the user and classify their intent.

You will be given:
- The conversation messages
- A list of ALLOWED_TAGS

Your tasks:
1) Write a helpful, natural-language reply to the user.
2) Infer the user’s intent from the conversation.
3) Select the most relevant tags ONLY from ALLOWED_TAGS.

CRITICAL CONSTRAINTS (must follow exactly):
- You MUST choose tags ONLY from ALLOWED_TAGS.
- Tags are case-sensitive and must match EXACTLY.
- Do NOT invent, rename, pluralize, or rephrase tags.
- If no tag clearly applies, return an empty list [].
- Select only tags that directly reflect user intent (not general topic drift).
- Prefer fewer, high-confidence tags over many weak ones.

OUTPUT FORMAT (STRICT — JSON ONLY, no extra text):

{
  "reply": "<string: your normal assistant reply>",
  "selected_tags": ["<tag>", "<tag>", ...]
}

ALLOWED_TAGS:
allowedTags = ["docker","mysql","nodejs","hosting","learning","productivity"]
`.trim();
  }

  async reply({ messages }) {
    const raw = await this.client.chat({
      system: this.systemPrompt(),
      messages,
    });

    return typeof raw === "string" && raw.trim()
      ? raw.trim()
      : "I’m not sure I understood—can you rephrase that?";
  }



}

module.exports = LLMService;
