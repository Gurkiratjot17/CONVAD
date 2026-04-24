// src/services/OpenAIClient.js
class OpenAIClient {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available. Use Node 18+ or polyfill fetch.");
    }
  }

  async chat({ system, messages, temperature = 0.7, signal, jsonOnly = false }) {
    const body = {
      model: this.model,
      messages: [{ role: "system", content: system }, ...(Array.isArray(messages) ? messages : [])],
      temperature,
    };

    // If you ever need strict JSON output later (context card), flip jsonOnly=true
    // Note: response_format support depends on endpoint/model behavior.
    if (jsonOnly) body.response_format = { type: "json_object" };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  async chatStream({ system, messages, onDelta, temperature = 0.7, signal }) {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: system }, ...(Array.isArray(messages) ? messages : [])],
        temperature,
        stream: true,
      }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${text}`);
    }

    const decoder = new TextDecoder("utf-8");
    const reader = resp.body.getReader();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;

          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) onDelta(delta);
          } catch {
            // ignore malformed chunks
          }
        }
      }
    }
  }
}

module.exports = OpenAIClient;
