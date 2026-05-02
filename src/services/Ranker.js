// src/services/Ranker.js

/*
 * Ranker
 *
 * Scores and orders eligible advertisement candidates.
 *
 * Responsibilities:
 * - Prefer hybrid ranking using embeddings + BM25 + small rule-based boosts
 * - Fall back to BM25-only scoring when embeddings are unavailable
 * - Fall back to legacy keyword scoring when neither embeddings nor BM25 are usable
 */

class Ranker {
  constructor() {
     // Legacy keyword scoring knobs (kept as fallback)
    /*
     * Legacy constants are retained for compatibility with the older
     * keyword/phrase scoring method.
     */
    this.MAX_KEYWORDS = 12;
    this.MIN_KEYWORD_LEN = 3;
    this.PHRASE_BONUS = 2.0;

     // Hybrid scoring knobs
    /*
     * Hybrid ranking weights.
     *
     * Final score combines:
     * - Semantic similarity from embeddings
     * - Lexical relevance from BM25
     * - Small rule-based boost signals
     */
    this.W_EMBED = 0.55;
    this.W_BM25 = 0.35;
    this.W_BOOST = 0.10;

   // If embeddings are missing on too many candidates, fall back gracefully
    /*
     * Minimum candidate embedding coverage required before semantic reranking
     * is trusted.
     */
    this.MIN_EMBED_COVERAGE = 0.2; // 20%
  }

   // ---------------------------
  // Shared utilities
  // ---------------------------

  /*
   * Clamps a number into the 0..1 range.
   */
  _clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

   /*
   * Safely converts a value to a number, returning a default when invalid.
   */
  _safeNum(x, d = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
  }

   /*
   * Parses embedding values from multiple possible storage formats.
   *
   * Supported formats:
   * - number[]
   * - JSON string
   * - { vector: [...] }
   * - { embedding: [...] }
   * - { data: [...] }
   */
  _parseEmbedding(v) {
    // Supports: array, JSON array string, { vector: [...] }, { embedding: [...] }
    if (!v) return null;

    if (Array.isArray(v)) {
      return v.map(n => Number(n)).filter(n => Number.isFinite(n));
    }

    // Some rows provide embedding_json as a JSON string
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return null;
      try {
        const parsed = JSON.parse(s);
        return this._parseEmbedding(parsed);
      } catch (e) {
        return null;
      }
    }

    if (typeof v === "object") {
      if (Array.isArray(v.embedding)) return this._parseEmbedding(v.embedding);
      if (Array.isArray(v.vector)) return this._parseEmbedding(v.vector);
      if (Array.isArray(v.data)) return this._parseEmbedding(v.data);
    }

    return null;
  }

   /*
   * Calculates cosine similarity between two embedding vectors.
   */
  _cosineSimilarity(a, b) {
    if (!a || !b) return null;
    const n = Math.min(a.length, b.length);
    if (!n) return null;

    let dot = 0;
    let na = 0;
    let nb = 0;

    for (let i = 0; i < n; i++) {
      const x = Number(a[i]);
      const y = Number(b[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }

    if (na <= 0 || nb <= 0) return null;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /*
   * Normalises keyword input for legacy scoring.
   */
  _normalizeKeywords(keywords) {
    const cleaned = (Array.isArray(keywords) ? keywords : [])
      .map(k => String(k || "").trim().toLowerCase())
      .filter(k => k.length >= this.MIN_KEYWORD_LEN);

    return cleaned.slice(0, this.MAX_KEYWORDS);
  }

   /*
   * Gives slightly higher weight to longer keywords because they are usually
   * more specific than short terms.
   */
  _keywordWeight(k) {
    if (k.length >= 8) return 2.0;
    if (k.length >= 5) return 1.5;
    return 1.0;
  }

  // ---------------------------
  // NEW: Embedding rerank + BM25 fusion
  // ---------------------------
  /**
   * Hybrid reranker:
   *  - Uses cosine similarity between queryEmbedding and ad.embedding
   *  - Fuses with BM25 candidate score if present (ad.bm25Score)
   *  - Applies small rule-based boosts (optional)
   *
   * Expected candidate shape includes:
   *  - ad.embedding (JSON/array/string)   (from ad_context_index.embedding_json)
   *  - ad.bm25Score (number|null)        (from searchBm25Candidates)
   */
  async rerank({
    candidates = [],
    queryEmbedding = null,
    queryText = "",
    queryTerms = [],
    safetyFlags = {},
    constraints = {},
  } = {}) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) return [];

    // Parse query embedding
     /*
     * Query embedding represents the semantic meaning of the current
     * conversation/query text.
     */
    const qEmb = this._parseEmbedding(queryEmbedding);

    // Collect bm25 stats for normalization
    /*
     * BM25 values are normalised within the candidate set so they can be
     * combined with embedding similarity in a common 0..1 range.
     */
    const bm25Vals = list
      .map(a => this._safeNum(a.bm25Score, null))
      .filter(v => v !== null && Number.isFinite(v));

    const bm25Max = bm25Vals.length ? Math.max(...bm25Vals) : 0;
    const bm25Min = bm25Vals.length ? Math.min(...bm25Vals) : 0;
    const bm25Range = bm25Max - bm25Min;

    // Compute embedding coverage
    /*
     * Embedding coverage measures how many candidates have usable embeddings.
     */
    let embedCount = 0;
    const parsedEmbeddings = new Map(); // adId -> embedding array|null
    for (const ad of list) {
      const emb = this._parseEmbedding(ad.embedding);
      parsedEmbeddings.set(ad.adId, emb);
      if (emb && emb.length) embedCount += 1;
    }
    const embedCoverage = list.length ? embedCount / list.length : 0;

    // If query embedding missing OR very low embedding coverage, degrade gracefully
     /*
     * Only use embeddings when both query embedding and candidate coverage
     * are sufficient.
     */
    const canUseEmbeddings = !!(qEmb && qEmb.length) && embedCoverage >= this.MIN_EMBED_COVERAGE;

    const scored = list.map(ad => {
      const bm25 = this._safeNum(ad.bm25Score, 0);

      // Normalize BM25 to 0..1 within candidate set
        /*
       * Normalisation prevents raw BM25 scale from dominating the hybrid score.
       */
      let bm25Norm = 0;
      if (bm25Vals.length) {
        bm25Norm = bm25Range > 0 ? (bm25 - bm25Min) / bm25Range : (bm25 > 0 ? 1 : 0);
        bm25Norm = this._clamp01(bm25Norm);
      }

      // Embedding similarity: map cosine (-1..1) => (0..1)
       /*
       * Cosine similarity is converted from -1..1 into 0..1 so it can be
       * combined with other scoring components.
       */
      let embedSim = null;
      if (canUseEmbeddings) {
        const aEmb = parsedEmbeddings.get(ad.adId);
        const cos = this._cosineSimilarity(qEmb, aEmb);
        if (cos !== null) embedSim = this._clamp01((cos + 1) / 2);
      }

      // Rule-based boosts (keep tiny; avoid overfitting)
       /*
       * Boosts provide small adjustments for explicit constraints or overlaps.
       * They are intentionally low-weight to avoid overriding relevance scores.
       */
      const boost = this._computeBoost({ ad, queryText, queryTerms, safetyFlags, constraints });

      // Final score
      let score;
      let reason;

      /*
       * Preferred path: hybrid embedding + BM25 + boost score.
       */
      if (embedSim !== null) {
        score = (this.W_EMBED * embedSim) + (this.W_BM25 * bm25Norm) + (this.W_BOOST * boost);
        reason = "hybrid_bm25_candidates_embedding_rerank_v1";
      } else if (bm25Vals.length) {
         // No embeddings available: rely on BM25 + boost
        /*
         * Fallback path when semantic ranking is unavailable.
         */
        score = (this.W_BM25 * bm25Norm) + (this.W_BOOST * boost);
        reason = "bm25_only_fallback_v1";
      } else {
        // No BM25 either: last-resort legacy keyword match
        const legacy = this._legacyScoreOne({ ad, queryText, queryTerms });
        score = legacy.score;
        reason = "legacy_keyword_fallback_v1";
      }

      return {
        ...ad,
        score: this._safeNum(score, 0),
        reason,

           /*
         * Debug metadata supports decision tracing and evaluation analysis.
         */
        _debug: {
          bm25Score: bm25Vals.length ? bm25 : null,
          bm25Norm: bm25Vals.length ? bm25Norm : null,
          embedSim,
          boost,
          embedCoverage,
          usedTerms: (queryTerms || []).slice(0, 12),
        },
      };
    });

     /*
     * Sort by score, then by adId to keep ordering deterministic.
     */
    scored.sort((a, b) => (b.score - a.score) || (b.adId - a.adId));
    return scored;
  }

  /*
   * Computes small rule-based boost signals.
   *
   * Boosts are supplementary and should not dominate BM25 or embedding scores.
   */
  _computeBoost({ ad, queryText, queryTerms, safetyFlags, constraints }) {
    // Keep boosts in 0..1 range
    let boost = 0;

    // Slight boost if geo matches constraint
    const geoScope = constraints?.geoScope ? String(constraints.geoScope) : null;
    if (geoScope && ad.geoScope && String(ad.geoScope) === geoScope) boost += 0.2;

    // Slight boost if price tier matches constraint (if you add it later)
    const priceTier = constraints?.priceTier ? String(constraints.priceTier) : null;
    if (priceTier && ad.priceTier && String(ad.priceTier) === priceTier) boost += 0.1;

    // Mild lexical overlap boost (helps when embeddings are weak/noisy)
     /*
     * Overlap boost rewards candidates that contain query terms directly
     * in their indexed ad text.
     */
    const text = String(ad.adText || `${ad.title || ""} ${ad.description || ""}`).toLowerCase();
    const terms = (queryTerms || []).slice(0, 12);
    let overlaps = 0;
    for (const t of terms) {
      if (t && t.length >= 3 && text.includes(String(t).toLowerCase())) overlaps += 1;
    }
    if (terms.length) boost += Math.min(0.3, overlaps / terms.length * 0.3);

    // Safety: if system flags are present, you might downrank risky categories
    // (EligibilityFilter should block, but we can softly downrank too)
    if (safetyFlags && safetyFlags.blockAds === true) boost -= 1; // will clamp later

    // Clamp to 0..1
    if (boost < 0) boost = 0;
    if (boost > 1) boost = 1;
    return boost;
  }

  /*
   * Last-resort scoring method used when neither embeddings nor BM25 are available.
   */
  _legacyScoreOne({ ad, queryText, queryTerms }) {
    // Use queryTerms as proxy keywords
    const kwList = this._normalizeKeywords(queryTerms || []);
    const kwSet = new Set(kwList);

    // PhraseList: use a few longer n-grams from queryText (very light)
    const q = String(queryText || "").trim().toLowerCase();
    const phraseList = [];
    if (q.length >= 12) phraseList.push(q.slice(0, 40)); // crude; just for fallback

    const text = String(ad.adText || `${ad.title || ""} ${ad.description || ""}`).toLowerCase();

    let hitCount = 0;
    let weighted = 0;

     /*
     * Keyword matches are weighted by token specificity.
     */
    for (const k of kwSet) {
      if (text.includes(k)) {
        hitCount += 1;
        weighted += this._keywordWeight(k);
      }
    }

    let phraseHits = 0;

     /*
     * Phrase matches provide additional relevance signal.
     */
    for (const p of phraseList) {
      if (p && p.length >= 6 && text.includes(p)) phraseHits += 1;
    }

    const score = weighted + (phraseHits * this.PHRASE_BONUS);

    return {
      score,
      debug: { hitCount, weighted, phraseHits, usedKeywords: kwList },
    };
  }

  // ---------------------------
  // Legacy API: keep score() working (used if AdSelectionService falls back)
  // ---------------------------

   /*
   * Legacy keyword/phrase ranking API.
   *
   * This remains available for backward compatibility if hybrid reranking
   * is not used by AdSelectionService.
   */
  score({ candidates, keywords, phrases }) {
    const kwList = this._normalizeKeywords(keywords);
    const kwSet = new Set(kwList);

    const phraseList = (Array.isArray(phrases) ? phrases : [])
      .map(p => String(p || "").trim().toLowerCase())
      .filter(p => p.length >= 4);

    const scored = (candidates || []).map(ad => {
      const text = String(ad.adText || `${ad.title} ${ad.description || ""}`).toLowerCase();

      let hitCount = 0;
      let weighted = 0;

        /*
       * Score keyword overlap between extracted context and ad text.
       */
      for (const k of kwSet) {
        if (text.includes(k)) {
          hitCount += 1;
          weighted += this._keywordWeight(k);
        }
      }

      let phraseHits = 0;

      /*
       * Score phrase overlap separately because phrases carry stronger
       * contextual meaning than isolated keywords.
       */
      for (const p of phraseList) {
        if (text.includes(p)) phraseHits += 1;
      }

      const score = weighted + (phraseHits * this.PHRASE_BONUS);

      return {
        ...ad,
        score,
        reason: "context_keyword_match_v2",

        /*
         * Debug metadata helps explain legacy scoring decisions.
         */
        _debug: {
          hitCount,
          weighted,
          phraseHits,
          usedKeywords: kwList,
          usedPhrases: phraseList.slice(0, 5),
        },
      };
    });

    scored.sort((a, b) => (b.score - a.score) || (b.adId - a.adId));
    return scored;
  }
}

module.exports = Ranker;
