// src/services/LLMService.js

/*
 * LLMService
 *
 * Provides higher-level language model functionality for CONVAD.
 *
 * Responsibilities:
 * - Build system prompts for assistant replies
 * - Delegate chat completion requests to OpenAIClient
 * - Optionally support LLM-based context extraction in future
 */
const OpenAIClient = require("./OpenAIClient");

class LLMService {
  constructor() {
      /*
     * OpenAIClient handles the lower-level API communication.
     */
    this.client = new OpenAIClient();
  }

  /**
   * System prompt for normal assistant replies.
   * Accepts optional contextmessages (string or array) and injects it into the prompt.
   */
  replyOnlySystemPrompt({ contextmessages } = {}) {
    const ctx = Array.isArray(contextmessages)
      ? contextmessages.filter(Boolean).join("\n")
      : (contextmessages ? String(contextmessages) : "");

    /*
     * Add current date so the assistant has basic temporal awareness.
     */
    const today = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    return `
  You are CONVAD, a helpful assistant. When someone ask who created or developed you just say "Mr. Gurkiratjot Singh". Don't mention about openAI as CONVAD is a product of Gurkiratjot Singh.
  Return ONLY the assistant's reply as plain text.
  Today's date is: ${today}
  Do not output JSON.
  ${ctx ? `\nContext:\n${ctx}\n` : ""}
  `.trim();
  }

  /**
   * OPTIONAL (future): Extract a structured Context Card from messages using the LLM.
   * You are currently using a deterministic ContextExtractor, so you likely don't need this yet.
   *
   * Returns:
   * {
   *   intent: string,
   *   keywords: string[],
   *   phrases: string[],
   *   summary: string,
   *   safety: { allow_ads: boolean, restricted: string[] }
   * }
   */
  async extractContextCardLLM({ messages, maxKeywords = 12, maxPhrases = 6 } = {}) {
    const system = `
You extract conversational context for an ad-matching system.
Return ONLY valid JSON. No markdown, no extra text.

Schema:
{
  "intent": "string",
  "keywords": ["string"],
  "phrases": ["string"],
  "summary": "string",
  "safety": { "allow_ads": true, "restricted": ["string"] }
}

Rules:
- Keep summary <= 2 sentences.
- keywords: up to ${maxKeywords}
- phrases: up to ${maxPhrases}
- safety.allow_ads false if the user expresses self-harm intent or crisis content.
`.trim();

 /*
     * Send messages to the LLM using the context-extraction prompt.
     */
    const raw = await this.client.chat({
      system,
      messages: Array.isArray(messages) ? messages : [],
    });

     /*
     * Extract JSON from the model response.
     */
    const jsonStr = this._extractJson(raw);

     /*
     * Fail-safe fallback if the model does not return parseable JSON.
     */
    if (!jsonStr) {
      return {
        intent: "unknown",
        keywords: [],
        phrases: [],
        summary: "",
        safety: { allow_ads: true, restricted: [] },
      };
    }

    try {
       /*
       * Parse and validate the model output into a predictable shape.
       */
      const parsed = JSON.parse(jsonStr);

      return {
        intent: typeof parsed.intent === "string" ? parsed.intent : "unknown",
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
        phrases: Array.isArray(parsed.phrases) ? parsed.phrases.map(String) : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        safety: parsed.safety && typeof parsed.safety === "object"
          ? {
              allow_ads: parsed.safety.allow_ads !== false,
              restricted: Array.isArray(parsed.safety.restricted)
                ? parsed.safety.restricted.map(String)
                : [],
            }
          : { allow_ads: true, restricted: [] },
      };
    } catch {
       /*
       * Fail-safe fallback if JSON parsing fails.
       */
      return {
        intent: "unknown",
        keywords: [],
        phrases: [],
        summary: "",
        safety: { allow_ads: true, restricted: [] },
      };
    }
  }

  // ---- helpers ----

  /*
   * Extracts the first JSON-like object from a raw model response.
   *
   * This protects against cases where the model accidentally includes
   * extra text before or after the JSON object.
   */
  _extractJson(raw) {
    const text = String(raw || "");
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s === -1 || e === -1 || e <= s) return null;
    return text.slice(s, e + 1);
  }
}

module.exports = LLMService;
