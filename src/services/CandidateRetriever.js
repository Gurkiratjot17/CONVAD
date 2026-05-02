// src/services/CandidateRetriever.js

/*
 * CandidateRetriever
 *
 * Responsible for retrieving a pool of candidate ads before filtering and ranking.
 *
 * Design philosophy:
 * - Use BM25-based lexical retrieval as the primary candidate generator
 * - Maintain backward compatibility with legacy keyword-based retrieval
 * - Provide multiple fallbacks to ensure the pipeline never fails (fail-soft design)
 */
class CandidateRetriever {
  constructor({ adIndexRepo }) {
    this.adIndexRepo = adIndexRepo;

     /*
     * Maximum number of terms used in retrieval queries.
     *
     * Rationale:
     * - More terms improve BM25 recall
     * - Too many terms degrade SQL performance and increase noise
     */
    this.MAX_TERMS = 12;
  }

  /*
   * Normalises text for consistent term matching.
   */
  _norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  /*
   * Removes duplicate terms while preserving valid entries.
   */
  _dedupe(arr) {
    return Array.from(new Set((arr || []).filter(Boolean)));
  }

  /*
   * Builds retrieval terms from extracted phrases and keywords.
   *
   * Used as a fallback when explicit queryTerms are unavailable.
   */
  _buildTermsFromKeywordsPhrases({ keywords, phrases }) {
    const terms = [];

    for (const p of phrases || []) terms.push(this._norm(p));
    for (const k of keywords || []) terms.push(this._norm(k));

    return this._dedupe(terms).filter(t => t && t.length >= 3).slice(0, this.MAX_TERMS); // avoid overly generic short tokens
  }

  /*
   * Builds retrieval terms from pre-tokenised queryTerms.
   *
   * Preferred path because queryTerms are already processed upstream
   * and better represent the intended search signal.
   */
  _buildTermsFromQueryTerms({ queryTerms }) {
    const terms = (queryTerms || []).map(t => this._norm(t));
    return this._dedupe(terms).filter(t => t && t.length >= 2).slice(0, this.MAX_TERMS);
  }

 /**
   * NEW (Hybrid): BM25 candidate retrieval entrypoint.
   *
   * Retrieval hierarchy:
   * 1. Use queryTerms (best signal)
   * 2. Fallback to phrases/keywords (legacy extraction)
   * 3. Fallback to raw tokenisation of queryText
   *
   * Repository fallbacks:
   * - BM25 search (preferred)
   * - Indexed term search (legacy)
   * - Full index fallback (last resort)
   *
   * This layered design ensures robustness and backward compatibility.
   */
  async retrieveCandidatesBM25({
    limit = 200,
    queryTerms = [],
    queryText = "",
    constraints = {},
    // Transitional inputs (so AdSelectionService can pass both during migration)
    keywords = [],
    phrases = [],
  } = {}) {
    // Prefer explicit queryTerms (already tokenized upstream)
    let terms = this._buildTermsFromQueryTerms({ queryTerms });

    // If queryTerms are empty, fall back to phrases/keywords (legacy extractor)
    if (!terms.length) {
      terms = this._buildTermsFromKeywordsPhrases({ keywords, phrases });
    }

    // Final fallback: attempt to tokenize queryText crudely
    if (!terms.length && queryText) {
      const raw = this._norm(queryText).match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
      terms = this._dedupe(raw).filter(t => t.length >= 2).slice(0, this.MAX_TERMS);
    }

    /*
     * Preferred retrieval path: BM25-based search.
     *
     * Advantages:
     * - Strong lexical matching
     * - Efficient SQL-based ranking
     * - Works well for short conversational queries
     */
    if (terms.length && typeof this.adIndexRepo.searchBm25Candidates === "function") {
      const rows = await this.adIndexRepo.searchBm25Candidates({
        terms,
        limit,
        constraints,
      });
      if (rows && rows.length) return rows;
    }

    // Backward-compatible: term search over indexed ads (non-BM25)
    if (terms.length && typeof this.adIndexRepo.searchIndexedAds === "function") {
      const rows = await this.adIndexRepo.searchIndexedAds({ terms, limit });
      if (rows && rows.length) return rows;
    }

    /*
     * Last-resort fallback:
     * return a generic pool of ads (e.g., most recent or default set).
     *
     * Ensures the system never breaks due to retrieval failure.
     */
    return this.adIndexRepo.getIndexedAds({ limit });
  }

   /**
   * Legacy candidate retrieval (kept for compatibility).
   *
   * This method supports older pipelines that do not use queryTerms
   * or BM25-based retrieval.
   */
  async retrieveCandidates({ limit = 200, keywords = [], phrases = [] } = {}) {
    const terms = this._buildTermsFromKeywordsPhrases({ keywords, phrases });

     /*
     * Legacy lexical search using keyword/phrase matching.
     */
    if (terms.length && typeof this.adIndexRepo.searchIndexedAds === "function") {
      const rows = await this.adIndexRepo.searchIndexedAds({ terms, limit });
      if (rows && rows.length) return rows;
    }

     /*
     * Fallback to generic indexed ads if no matches are found.
     */
    return this.adIndexRepo.getIndexedAds({ limit });
  }
}

module.exports = CandidateRetriever;
