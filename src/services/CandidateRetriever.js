// src/services/CandidateRetriever.js
class CandidateRetriever {
  constructor({ adIndexRepo }) {
    this.adIndexRepo = adIndexRepo;
    this.MAX_TERMS = 10;
  }

  _buildTerms({ keywords, phrases }) {
    const terms = [];

    for (const p of (phrases || [])) terms.push(String(p || "").trim().toLowerCase());
    for (const k of (keywords || [])) terms.push(String(k || "").trim().toLowerCase());

    return [...new Set(terms.filter(t => t && t.length >= 3))].slice(0, this.MAX_TERMS);
  }

  async retrieveCandidates({ limit = 200, keywords = [], phrases = [] }) {
    const terms = this._buildTerms({ keywords, phrases });

    if (terms.length && typeof this.adIndexRepo.searchIndexedAds === "function") {
      const rows = await this.adIndexRepo.searchIndexedAds({ terms, limit });
      if (rows && rows.length) return rows;
    }

    return this.adIndexRepo.getIndexedAds({ limit });
  }
}

module.exports = CandidateRetriever;
