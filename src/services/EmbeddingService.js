// src/services/EmbeddingService.js

/**
 * EmbeddingService
 * - Creates embeddings for text using OpenAI's Embeddings API.
 * - Includes a small in-memory cache to reduce duplicate calls.
 *
 * Requirements:
 *   - Node 18+ (global fetch)
 *   - env: OPENAI_API_KEY
 *
 * Docs:
 *   POST https://api.openai.com/v1/embeddings
 *   body: { model, input }
 *   response: { data: [{ embedding: number[] }] }
 */

class EmbeddingService {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    timeoutMs = Number(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || 12000),
    cacheMax = Number(process.env.EMBED_CACHE_MAX || 500),
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 12000;

    this.cacheMax = Number.isFinite(cacheMax) ? cacheMax : 500;
    this.cache = new Map(); // key -> { embedding, ts }
  }

  _cacheGet(key) {
    const v = this.cache.get(key);
    if (!v) return null;

    // refresh LRU
    this.cache.delete(key);
    this.cache.set(key, v);

    return v.embedding || null;
  }

  _cacheSet(key, embedding) {
    if (!key) return;
    this.cache.set(key, { embedding, ts: Date.now() });

    // simple LRU cap
    while (this.cache.size > this.cacheMax) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  _stableKey(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    // keep key bounded; collisions are acceptable for caching
    return `${this.model}:${t.slice(0, 600)}`;
  }

  async embedText(text) {
    const input = String(text || "").trim();
    if (!input) return null;

    if (!this.apiKey) {
      console.warn("[EmbeddingService] Missing OPENAI_API_KEY — embeddings disabled.");
      return null;
    }

    const key = this._stableKey(input);
    const cached = this._cacheGet(key);
    if (cached) return cached;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("[EmbeddingService] Embedding request failed:", res.status, errText.slice(0, 400));
        return null;
      }

      const data = await res.json();
      const emb = data?.data?.[0]?.embedding;

      if (!Array.isArray(emb) || !emb.length) {
        console.warn("[EmbeddingService] No embedding returned (unexpected response shape).");
        return null;
      }

      this._cacheSet(key, emb);
      return emb;
    } catch (e) {
      console.warn("[EmbeddingService] Embedding request error:", e?.message || e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = EmbeddingService;
