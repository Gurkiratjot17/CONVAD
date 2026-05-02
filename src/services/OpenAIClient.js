// src/services/OpenAIClient.js

/*
 * OpenAIClient
 *
 * Low-level API client for communicating with the OpenAI Chat Completions API.
 *
 * Responsibilities:
 * - Send standard chat completion requests
 * - Send streaming chat completion requests
 * - Centralise API configuration, model selection, and error handling
 */
class OpenAIClient {
  constructor() {
    /*
     * API configuration is loaded from environment variables so credentials
     * and model settings are not hard-coded.
     */
    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

    /*
     * Fail fast if required runtime configuration is missing.
     */
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available. Use Node 18+ or polyfill fetch.");
    }
  }

   /*
   * Sends a non-streaming chat completion request.
   *
   * Used when the full model response is needed before continuing.
   */
  async chat({ system, messages, temperature = 0.7, signal, jsonOnly = false }) {
     /*
     * Construct the chat payload with a system message followed by conversation messages.
     */
    const body = {
      model: this.model,
      messages: [{ role: "system", content: system }, ...(Array.isArray(messages) ? messages : [])],
      temperature,
    };

    // If you ever need strict JSON output later (context card), flip jsonOnly=true
    // Note: response_format support depends on endpoint/model behavior.
    if (jsonOnly) body.response_format = { type: "json_object" };

     /*
     * Send request to the chat completions endpoint.
     */
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

     /*
     * Surface API errors to the caller with response status and message.
     */
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${text}`);
    }

     /*
     * Extract assistant message content from the API response.
     */
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

   /*
   * Sends a streaming chat completion request.
   *
   * Used for real-time conversational output via incremental deltas.
   */
  async chatStream({ system, messages, onDelta, temperature = 0.7, signal }) {
    /*
     * Request streamed response chunks from the API.
     */
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

     /*
     * Streaming requires both a successful response and a readable body.
     */
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${text}`);
    }

     /*
     * Decode Server-Sent Event stream chunks from the response body.
     */
    const decoder = new TextDecoder("utf-8");
    const reader = resp.body.getReader();
    let buffer = "";

    /*
     * Read and process stream chunks until completion.
     */
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      /*
       * Append decoded text to the buffer because SSE messages may arrive
       * split across multiple chunks.
       */
      buffer += decoder.decode(value, { stream: true });

       /*
       * Split complete SSE events from the remaining partial buffer.
       */
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          /*
           * Only process SSE data lines.
           */
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();

          /*
           * End of stream marker.
           */
          if (data === "[DONE]") return;

          try {
             /*
             * Extract incremental assistant text and pass it to the caller.
             */
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) onDelta(delta);
          } catch {
            /*
             * Ignore malformed stream chunks so one bad chunk does not break
             * the entire streaming response.
             */
          }
        }
      }
    }
  }
}

module.exports = OpenAIClient;
