// src/services/Ranker.js
class Ranker {
  constructor() {
    this.MAX_KEYWORDS = 12;
    this.MIN_KEYWORD_LEN = 3;
    this.PHRASE_BONUS = 2.0; // small boost if phrase matches
  }

  _normalizeKeywords(keywords) {
    const cleaned = (Array.isArray(keywords) ? keywords : [])
      .map(k => String(k || "").trim().toLowerCase())
      .filter(k => k.length >= this.MIN_KEYWORD_LEN);

    // cap size to keep scoring stable
    return cleaned.slice(0, this.MAX_KEYWORDS);
  }

  _keywordWeight(k) {
    // simple specificity heuristic: longer word = more specific
    // 3-4 chars: 1, 5-7: 1.5, 8+: 2
    if (k.length >= 8) return 2.0;
    if (k.length >= 5) return 1.5;
    return 1.0;
  }

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

      for (const k of kwSet) {
        if (text.includes(k)) {
          hitCount += 1;
          weighted += this._keywordWeight(k);
        }
      }

      let phraseHits = 0;
      for (const p of phraseList) {
        if (text.includes(p)) phraseHits += 1;
      }

      const score = weighted + (phraseHits * this.PHRASE_BONUS);

      return {
        ...ad,
        score,
        reason: "context_keyword_match_v2",
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
