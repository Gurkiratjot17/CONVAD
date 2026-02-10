// src/services/DecisionTracer.js

class DecisionTracer {
  buildTrace({ contextCard, candidatesScored, chosen, meta = {} }) {
    const top = (candidatesScored || []).slice(0, 10);

    const keywords = contextCard?.keywords || [];
    const phrases = contextCard?.phrases || [];
    const safety = contextCard?.safety || { allow_ads: true, restricted: [] };

    const intentLabel =
      contextCard?.intent ||
      contextCard?.intent_label ||
      contextCard?.intentLabel ||
      "unknown";

    const intentConfidence =
      contextCard?.intent_confidence ??
      contextCard?.intentConfidence ??
      null;

    const intentScores = contextCard?.intent_scores || contextCard?.intentScores || null;

    // Prefer query fields if present (from ContextExtractor + AdSelectionService)
    const queryText = meta.queryText ?? contextCard?.queryText ?? null;
    const queryTerms = meta.queryTerms ?? contextCard?.queryTerms ?? null;

    // Gate info (from AdSelectionService)
    const gated = meta.gated ?? false;
    const gateReasons = meta.gateReasons ?? [];
    const gateConstraints = meta.gateConstraints ?? {};

    // Retrieval + ranking tags (from AdSelectionService)
    const retrieval = meta.retrieval ?? null;
    const ranking = meta.ranking ?? null;

    return {
      version: "v2_hybrid_bm25_candidates_embedding_rerank",
      timestamp: new Date().toISOString(),

      // DB / trace linkage (helps audits)
      refs: {
        conversationId: meta.conversationId ?? null,
        snapshotId: meta.snapshotId ?? null,
        turnIndex: meta.turnIndex ?? null,
        decisionId: meta.decisionId ?? null,
      },

      // 1) What the system believed about the conversation
      context: {
        intent: intentLabel,
        intentConfidence,
        intentScores,
        keywords,
        phrases,
        safety,
        summary: contextCard?.summary || null,
        queryText,
        queryTerms,
      },

      // 2) Policy gating (explicit)
      policy: {
        gated,
        gateReasons,
        constraints: gateConstraints,
      },

      // 3) What happened in selection (high-level, human readable)
      pipeline: {
        retrieval,
        ranking,
        retrievalTerms: {
          // Keep legacy signals (useful for debugging)
          phrases: phrases.slice(0, 6),
          keywords: keywords.slice(0, 12),

          // Hybrid signals (preferred)
          queryTerms: Array.isArray(queryTerms) ? queryTerms.slice(0, 18) : null,
        },
        candidateCount: meta.candidateCount ?? null,
        eligibleCount: meta.eligibleCount ?? null,
        selectedCount: meta.selectedCount ?? null,
        topScore: meta.topScore ?? null,
      },

      // 4) Final choice and why it won
      decision: chosen
        ? {
            chosenAdId: chosen.adId,
            score: chosen.score,
            reason: chosen.reason,
            explanation: this._explainChoice({ chosen, contextCard, meta }),
            debug: chosen._debug || null,
            signals: {
              bm25Score: chosen.bm25Score ?? chosen._debug?.bm25Score ?? null,
              bm25Norm: chosen._debug?.bm25Norm ?? null,
              embedSim: chosen._debug?.embedSim ?? null,
              boost: chosen._debug?.boost ?? null,
              retrieval: chosen.retrieval ?? null,
            },
          }
        : {
            chosenAdId: null,
            score: null,
            reason:
              gated
                ? "blocked_by_policy_gate"
                : safety.allow_ads === false
                  ? "blocked_by_safety"
                  : "no_ad_selected",
            explanation: gated
              ? "Ads were suppressed by the policy gate (e.g., safety or frequency capping)."
              : safety.allow_ads === false
                ? "Ads were suppressed due to safety policy for this conversation context."
                : "No candidate achieved a positive relevance score under the current ranking policy.",
          },

      // 5) Alternatives (helps auditing + evaluation)
      alternatives: top.map(c => ({
        adId: c.adId,
        score: c.score,
        reason: c.reason,
        signals: {
          bm25Score: c.bm25Score ?? c._debug?.bm25Score ?? null,
          bm25Norm: c._debug?.bm25Norm ?? null,
          embedSim: c._debug?.embedSim ?? null,
          boost: c._debug?.boost ?? null,
          retrieval: c.retrieval ?? null,
        },
        debug: c._debug || null,
      })),
    };
  }

  _explainChoice({ chosen, contextCard, meta }) {
    const kws = (contextCard?.keywords || []).slice(0, 6);
    const phs = (contextCard?.phrases || []).slice(0, 3);

    const queryTerms = Array.isArray(meta?.queryTerms) ? meta.queryTerms.slice(0, 10) : null;

    const bm25 = chosen?.bm25Score ?? chosen?._debug?.bm25Score ?? null;
    const embedSim = chosen?._debug?.embedSim ?? null;

    const parts = [];

    if (embedSim !== null && embedSim !== undefined) {
      parts.push(`High semantic match (embedSim=${Number(embedSim).toFixed(3)})`);
    }
    if (bm25 !== null && bm25 !== undefined) {
      parts.push(`Strong lexical match (bm25=${Number(bm25).toFixed(3)})`);
    }

    if (queryTerms && queryTerms.length) parts.push(`Query terms: ${queryTerms.join(", ")}`);
    else {
      if (phs.length) parts.push(`Key phrases: ${phs.join(", ")}`);
      if (kws.length) parts.push(`Keywords: ${kws.join(", ")}`);
    }

    if (!parts.length) return "Selected as highest-ranked candidate under the current ranking policy.";
    return parts.join(" | ");
  }
}

module.exports = DecisionTracer;
