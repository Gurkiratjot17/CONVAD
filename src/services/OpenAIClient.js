class OpenAIClient {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
  }

  async chat({ system, messages }) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: system }, ...messages],
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    return raw;
  }
}

module.exports = OpenAIClient;
