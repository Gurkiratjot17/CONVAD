// src/services/EmbeddingService.js

/**
 * EmbeddingService
 *
 * Generates vector embeddings for text using the OpenAI Embeddings API.
 *
 * Responsibilities:
 * - Convert query text into numerical vectors for semantic similarity
 * - Cache embeddings to reduce repeated API calls
 * - Fail gracefully when the API is unavailable
 *
 * This service enables semantic reranking in the hybrid ad-selection pipeline.
 */

class EmbeddingService {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    timeoutMs = Number(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || 12000),
    cacheMax = Number(process.env.EMBED_CACHE_MAX || 500),
  } = {}) {

   /*
     * API configuration for embedding requests.
     */
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");

     /*
     * Timeout ensures embedding requests do not block the pipeline indefinitely.
     */
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 12000;

    /*
     * Simple in-memory LRU cache to reduce duplicate API calls.
     *
     * Trade-off:
     * - Faster repeated queries
     * - Limited by memory and process lifetime
     */
    this.cacheMax = Number.isFinite(cacheMax) ? cacheMax : 500;

     /*
     * Cache structure:
     * key → { embedding, timestamp }
     */
    this.cache = new Map(); 
  }

  /*
   * Retrieves embedding from cache.
   *
   * Implements LRU behaviour by refreshing access order.
   */
  _cacheGet(key) {
    const v = this.cache.get(key);
    if (!v) return null;

    // refresh LRU
    this.cache.delete(key);
    this.cache.set(key, v);

    return v.embedding || null;
  }

  /*
   * Stores embedding in cache and enforces size limit.
   */
  _cacheSet(key, embedding) {
    if (!key) return;
    this.cache.set(key, { embedding, ts: Date.now() });

   /*
     * Simple LRU eviction:
     * remove oldest entry when cache exceeds max size.
     */
    while (this.cache.size > this.cacheMax) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  /*
   * Generates a stable cache key for a given input text.
   *
   * The key includes:
   * - model name (ensures compatibility across models)
   * - truncated text (to bound key size)
   *
   * Note:
   * - Collisions are acceptable because cache is an optimisation layer,
   *   not a source of truth.
   */
  _stableKey(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    // keep key bounded; collisions are acceptable for caching
    return `${this.model}:${t.slice(0, 600)}`;
  }

    /*
   * Main embedding function.
   *
   * Returns:
   * - embedding vector (number[])
   * - or null if embedding fails (fail-soft behaviour)
   */
  async embedText(text) {
    const input = String(text || "").trim();
    if (!input) return null;

    /*
     * If API key is missing, disable embeddings gracefully.
     */
    if (!this.apiKey) {
      console.warn("[EmbeddingService] Missing OPENAI_API_KEY — embeddings disabled.");
      return null;
    }

    /*
     * Check cache first to avoid unnecessary API calls.
     */
    const key = this._stableKey(input);
    const cached = this._cacheGet(key);
    if (cached) return cached;

     /*
     * Setup request timeout using AbortController.
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
       /*
       * Call OpenAI embeddings endpoint.
       */
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

       /*
       * Handle non-success responses.
       */
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("[EmbeddingService] Embedding request failed:", res.status, errText.slice(0, 400));
        return null;
      }

       /*
       * Parse embedding from API response.
       */
      const data = await res.json();
      const emb = data?.data?.[0]?.embedding;

       /*
       * Validate embedding structure.
       */
      if (!Array.isArray(emb) || !emb.length) {
        console.warn("[EmbeddingService] No embedding returned (unexpected response shape).");
        return null;
      }

        /*
       * Cache the embedding for future reuse.
       */
      this._cacheSet(key, emb);
      return emb;
    } catch (e) {
       /*
       * Fail-soft behaviour:
       * embedding errors should not break the ad-selection pipeline.
       */
      console.warn("[EmbeddingService] Embedding request error:", e?.message || e);
      return null;
    } finally {
       /*
       * Always clear timeout to avoid memory leaks.
       */
      clearTimeout(timer);
    }
  }
}

module.exports = EmbeddingService;
