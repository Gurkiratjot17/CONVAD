// src/services/OpenAIClient.js
class OpenAIClient {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.baseUrl = "https://api.openai.com/v1";
  }

  _assertConfigured() {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set.");
  }

  async generateJSON({ system, messages }) {
    this._assertConfigured();

    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    // IMPORTANT: We ask for JSON only.
    const input = `${system}\n\n${transcript}\n\nReturn ONLY valid JSON.`;

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

    const raw =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.output?.[0]?.content?.[0]?.value ||
      "";

    return { raw: String(raw).trim(), usage: data.usage || {}, model: data.model, responseId: data.id };
  }
}

module.exports = OpenAIClient;
