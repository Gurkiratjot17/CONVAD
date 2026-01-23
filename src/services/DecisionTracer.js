// src/services/DecisionTracer.js
class DecisionTracer {
  buildTrace({ contextCard, candidatesScored, chosen, meta = {} }) {
    const top = (candidatesScored || []).slice(0, 10);

    const keywords = contextCard?.keywords || [];
    const phrases = contextCard?.phrases || [];
    const safety = contextCard?.safety || { allow_ads: true, restricted: [] };

    return {
      version: "v1_contextual_keyword_ranker",
      timestamp: new Date().toISOString(),

      // DB / trace linkage (helps audits)
      refs: {
        conversationId: meta.conversationId ?? null,
        snapshotId: meta.snapshotId ?? null,
        turnIndex: meta.turnIndex ?? null,
      },

      // 1) What the system believed about the conversation
      context: {
        intent: contextCard?.intent || "unknown",
        keywords,
        phrases,
        safety,
        summary: contextCard?.summary || null,
      },

      // 2) What happened in selection (high-level, human readable)
      pipeline: {
        retrievalTerms: {
          phrases: phrases.slice(0, 6),
          keywords: keywords.slice(0, 12),
        },
        candidateCount: meta.candidateCount ?? null,
        eligibleCount: meta.eligibleCount ?? null,
        selectedCount: meta.selectedCount ?? null,
        topScore: meta.topScore ?? null,
      },

      // 3) Final choice and why it won
      decision: chosen
        ? {
            chosenAdId: chosen.adId,
            score: chosen.score,
            reason: chosen.reason,
            explanation: this._explainChoice({ chosen, contextCard }),
            debug: chosen._debug || null,
          }
        : {
            chosenAdId: null,
            score: null,
            reason: safety.allow_ads === false ? "blocked_by_safety" : "no_ad_selected",
            explanation:
              safety.allow_ads === false
                ? "Ads were suppressed due to safety policy for this conversation context."
                : "No candidate achieved a positive relevance score under the current ranking policy.",
          },

      // 4) Alternatives (helps auditing + evaluation)
      alternatives: top.map(c => ({
        adId: c.adId,
        score: c.score,
        reason: c.reason,
        debug: c._debug || null,
      })),
    };
  }

  _explainChoice({ contextCard }) {
    const kws = (contextCard?.keywords || []).slice(0, 6);
    const phs = (contextCard?.phrases || []).slice(0, 3);

    const parts = [];
    if (phs.length) parts.push(`Matched key phrases: ${phs.join(", ")}`);
    if (kws.length) parts.push(`Matched keywords: ${kws.join(", ")}`);

    if (!parts.length) return "Selected as highest-ranked candidate under the current ranking policy.";
    return parts.join(" | ");
  }
}

module.exports = DecisionTracer;
