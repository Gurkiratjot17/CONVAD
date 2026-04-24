// src/services/CandidateRetriever.js

class CandidateRetriever {
  constructor({ adIndexRepo }) {
    this.adIndexRepo = adIndexRepo;

    // Keep candidate retrieval cheap: BM25 works better with more terms,
    // but your index + SQL will thank you for a cap.
    this.MAX_TERMS = 12;
  }

  _norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  _dedupe(arr) {
    return Array.from(new Set((arr || []).filter(Boolean)));
  }

  _buildTermsFromKeywordsPhrases({ keywords, phrases }) {
    const terms = [];

    for (const p of phrases || []) terms.push(this._norm(p));
    for (const k of keywords || []) terms.push(this._norm(k));

    return this._dedupe(terms).filter(t => t && t.length >= 3).slice(0, this.MAX_TERMS);
  }

  _buildTermsFromQueryTerms({ queryTerms }) {
    const terms = (queryTerms || []).map(t => this._norm(t));
    return this._dedupe(terms).filter(t => t && t.length >= 2).slice(0, this.MAX_TERMS);
  }

  /**
   * NEW (Hybrid): BM25 candidate retrieval entrypoint.
   *
   * Expected repo support (we'll implement in AdIndexRepository next):
   * - adIndexRepo.searchBm25Candidates({ terms, limit, constraints })
   *
   * Safe fallbacks:
   * - adIndexRepo.searchIndexedAds({ terms, limit })  (legacy lexical)
   * - adIndexRepo.getIndexedAds({ limit })           (last resort)
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

    // Prefer true BM25 repo method if available
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

    // Last resort: recent indexed ads
    return this.adIndexRepo.getIndexedAds({ limit });
  }

  /**
   * Legacy candidate retrieval (kept for compatibility).
   */
  async retrieveCandidates({ limit = 200, keywords = [], phrases = [] } = {}) {
    const terms = this._buildTermsFromKeywordsPhrases({ keywords, phrases });

    if (terms.length && typeof this.adIndexRepo.searchIndexedAds === "function") {
      const rows = await this.adIndexRepo.searchIndexedAds({ terms, limit });
      if (rows && rows.length) return rows;
    }

    return this.adIndexRepo.getIndexedAds({ limit });
  }
}

module.exports = CandidateRetriever;
