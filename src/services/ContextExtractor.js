// src/services/ContextExtractor.js

class ContextExtractor {
  constructor() {
    this.MAX_KEYWORDS = 12;
    this.MAX_PHRASES = 6;
    this.MAX_QUERY_TERMS = 18;

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

    // Very lightweight intent lexicon (upgrade later / swap for LLM classifier)
    this.INTENT_LEXICON = {
      buy: ["buy", "purchase", "order", "price", "cheap", "deal", "discount", "shop"],
      learn: ["learn", "study", "course", "tutorial", "explain", "how", "guide"],
      travel: ["flight", "hotel", "trip", "travel", "vacation", "booking", "book"],
      job: ["job", "apply", "cv", "resume", "interview", "hiring"],
      food: ["restaurant", "food", "pizza", "burger", "cook", "recipe", "takeaway", "delivery"],
      tech: ["laptop", "phone", "software", "code", "programming", "bug", "error"],
    };
  }

  _tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
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

    // Conservative crisis signals: if hit, ads should be gated off.
    const crisisSignals = [
      "suicid", "self harm", "kill myself", "end my life", "want to die",
      "i am depressed", "im depressed", "i'm depressed", "depressed for",
      "abuse", "domestic violence"
    ];

    const hit = crisisSignals.some(s => lower.includes(s));
    if (hit) {
      return { allow_ads: false, restricted: ["sensitive_crisis_or_abuse"] };
    }
    return { allow_ads: true, restricted: [] };
  }

  _inferIntentFromText(text) {
    const lower = String(text || "").toLowerCase();
    const scores = new Map();

    for (const [intent, words] of Object.entries(this.INTENT_LEXICON)) {
      let s = 0;
      for (const w of words) {
        if (lower.includes(w)) s += 1;
      }
      if (s > 0) scores.set(intent, s);
    }

    if (!scores.size) return { label: "unknown", confidence: 0.0, scores: {} };

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const [topIntent, topScore] = sorted[0];
    const secondScore = sorted[1]?.[1] ?? 0;

    // crude confidence: separation + magnitude
    const confidence = Math.max(0, Math.min(1, (topScore - secondScore + topScore) / 10));

    const scoreObj = {};
    for (const [k, v] of scores.entries()) scoreObj[k] = v;

    return { label: topIntent, confidence, scores: scoreObj };
  }

  _buildQueryText({ userText, keywords, phrases }) {
    // Stable canonical query: last user intent + top phrases + top keywords
    const parts = [];
    if (userText) parts.push(String(userText).trim());
    if (Array.isArray(phrases) && phrases.length) parts.push(phrases.slice(0, 6).join(" | "));
    if (Array.isArray(keywords) && keywords.length) parts.push(keywords.slice(0, 12).join(" "));
    return parts
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200); // keep embedding input bounded
  }

  _buildQueryTerms({ queryText, keywords }) {
    // Prefer tokenizing queryText, then backfill from keywords
    const tokens = this._tokenize(queryText).filter(t => this._isGoodToken(t));

    const merged = [];
    for (const t of tokens) merged.push(t);
    for (const k of keywords || []) merged.push(String(k || "").trim().toLowerCase());

    // de-dupe while preserving order
    const seen = new Set();
    const out = [];
    for (const t of merged) {
      const tt = String(t || "").trim().toLowerCase();
      if (!tt) continue;
      if (tt.length < 2) continue;
      if (this.STOP.has(tt)) continue;
      if (seen.has(tt)) continue;
      seen.add(tt);
      out.push(tt);
      if (out.length >= this.MAX_QUERY_TERMS) break;
    }
    return out;
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

    // Last user message is typically the strongest signal for intent/query
    const lastUserMsg = [...boundedMessages].reverse().find(m => (m.role || "").toLowerCase() === "user");
    const lastUserText = lastUserMsg ? String(lastUserMsg.content || "") : "";

    // Canonical query fields for hybrid retrieval
    const queryText = this._buildQueryText({ userText: lastUserText, keywords, phrases });
    const queryTerms = this._buildQueryTerms({ queryText, keywords });

    // Lightweight intent inference (used by IntentPolicyGate)
    const intent = this._inferIntentFromText(queryText);

    const contextCard = {
      summary: contextText.slice(-600), // placeholder summary (upgrade later)
      intent: intent?.label || "unknown",
      intent_confidence: intent?.confidence ?? 0,
      intent_scores: intent?.scores || {},
      keywords,
      phrases,
      safety
    };

    return {
      contextCard,
      contextText,
      keywords,
      phrases,
      queryText,
      queryTerms,
      intent,
      embedding: null, // plug in your embedding service later (should embed queryText)
      safetyFlags: safety,
    };
  }
}

module.exports = ContextExtractor;
