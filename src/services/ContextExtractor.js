// src/services/ContextExtractor.js
class ContextExtractor {
  constructor() {
    this.MAX_KEYWORDS = 12;
    this.MAX_PHRASES = 6;

    this.STOP = new Set([
      "the","a","an","and","or","but","if","then","else","to","of","in","on","for","with","at","by",
      "i","you","we","they","he","she","it","is","are","was","were","be","been","being",
      "my","your","our","their","me","him","her","them",
      "this","that","these","those",
      "what","how","why","when","where","which",
      "can","could","should","would","do","did","does",
      "today","tomorrow","yesterday","please","thanks","thank"
    ]);

    // role weighting: prioritize user intent
    this.ROLE_WEIGHT = {
      user: 2,
      assistant: 1
    };
  }

  _tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);
  }

  _isGoodToken(t) {
    if (!t) return false;
    if (t.length < 3) return false;
    if (this.STOP.has(t)) return false;
    // avoid mostly-numeric tokens
    if (/^\d+$/.test(t)) return false;
    return true;
  }

  _keywordsFromMessages(messages) {
    const freq = new Map();

    for (const m of (messages || [])) {
      const role = (m.role || "user").toLowerCase();
      const w = this.ROLE_WEIGHT[role] || 1;

      const tokens = this._tokenize(m.content).filter(t => this._isGoodToken(t));
      for (const t of tokens) {
        freq.set(t, (freq.get(t) || 0) + w);
      }
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.MAX_KEYWORDS)
      .map(([t]) => t);
  }

  _phrasesFromMessages(messages) {
    // simple bigrams from USER messages only (best signal)
    const freq = new Map();

    const userMsgs = (messages || []).filter(m => (m.role || "").toLowerCase() === "user");
    for (const m of userMsgs) {
      const tokens = this._tokenize(m.content).filter(t => this._isGoodToken(t));

      for (let i = 0; i < tokens.length - 1; i++) {
        const a = tokens[i];
        const b = tokens[i + 1];
        // skip if either is too short or stopword (already filtered)
        const phrase = `${a} ${b}`;
        freq.set(phrase, (freq.get(phrase) || 0) + 1);
      }
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.MAX_PHRASES)
      .map(([p]) => p);
  }

  _safetyFlagsFromText(text) {
    const lower = String(text || "").toLowerCase();

    // You can broaden this later, but keep it conservative for now
    const crisisSignals = [
      "suicid", "self harm", "kill myself", "end my life", "want to die",
      "depressed for", "i am depressed", "im depressed"
    ];

    const hit = crisisSignals.some(s => lower.includes(s));
    if (hit) {
      return { allow_ads: false, restricted: ["mental_health_crisis"] };
    }
    return { allow_ads: true, restricted: [] };
  }

  extract({ messages }) {
    const boundedMessages = (messages || []).slice(-12);

    const contextText = boundedMessages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n")
      .slice(-4000);

    const keywords = this._keywordsFromMessages(boundedMessages);
    const phrases = this._phrasesFromMessages(boundedMessages);

    const safety = this._safetyFlagsFromText(contextText);

    const contextCard = {
      summary: contextText.slice(-600), // placeholder summary (upgrade later)
      intent: "unknown",
      keywords,
      phrases,
      safety
    };

    return {
      contextCard,
      contextText,
      keywords,
      phrases,
      embedding: null,
      safetyFlags: safety,
    };
  }
}

module.exports = ContextExtractor;
