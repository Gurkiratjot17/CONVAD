// src/services/OpenAIClient.js
class OpenAIClient {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.baseUrl = "https://api.openai.com/v1";
  }

  _assertConfigured() {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it to your environment/.env file.");
    }
  }

  /**
   * Uses the Responses API (recommended for new projects).
   * Docs: /v1/responses
   */
  async generateText({ system, messages }) {
    this._assertConfigured();

    // Build a compact text input from conversation messages
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const input = `${system}\n\n${transcript}\n\nASSISTANT:`;

    const res = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();

    // Responses API provides output text; simplest robust extraction:
    // Many SDKs expose output_text helper; here we parse common shape.
    const outputText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.output?.[0]?.content?.[0]?.value ||
      "";

    return String(outputText).trim();
  }
}

module.exports = OpenAIClient;
