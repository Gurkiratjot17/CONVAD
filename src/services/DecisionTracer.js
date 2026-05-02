// src/services/DecisionTracer.js

/*
 * DecisionTracer
 *
 * Builds a structured explanation object for each ad-selection decision.
 *
 * Purpose:
 * - Make ad selection auditable
 * - Support admin analytics and “why this ad?” explanations
 * - Preserve evidence of context, policy gating, retrieval, ranking, and alternatives
 *
 * This is important for evaluating whether CONVAD selects ads transparently
 * and without relying on persistent user profiling.
 */

class DecisionTracer {
  /*
   * Builds the full trace_json object persisted with each ad decision.
   */
  buildTrace({ contextCard, candidatesScored, chosen, meta = {} }) {
     /*
     * Store only the top candidates as alternatives.
     *
     * This keeps trace_json useful for evaluation without making it too large.
     */
    const top = (candidatesScored || []).slice(0, 10);

    /*
     * Extract context signals from the context card.
     */
    const keywords = contextCard?.keywords || [];
    const phrases = contextCard?.phrases || [];
    const safety = contextCard?.safety || { allow_ads: true, restricted: [] };

     /*
     * Support multiple intent field names for compatibility with older traces.
     */
    const intentLabel =
      contextCard?.intent ||
      contextCard?.intent_label ||
      contextCard?.intentLabel ||
      "unknown";

     /*
     * Intent confidence is optional because some extraction methods may not
     * produce a calibrated confidence score.
     */
    const intentConfidence =
      contextCard?.intent_confidence ??
      contextCard?.intentConfidence ??
      null;

    const intentScores = contextCard?.intent_scores || contextCard?.intentScores || null;

    // Prefer query fields if present (from ContextExtractor + AdSelectionService)
    /*
     * Query fields are preferred because they represent the canonical retrieval
     * input used by the hybrid BM25 and embedding-ranking pipeline.
     */
    const queryText = meta.queryText ?? contextCard?.queryText ?? null;
    const queryTerms = meta.queryTerms ?? contextCard?.queryTerms ?? null;

    // Gate info (from AdSelectionService)
    /*
     * Policy-gate metadata records whether ad display was restricted and why.
     */
    const gated = meta.gated ?? false;
    const gateReasons = meta.gateReasons ?? [];
    const gateConstraints = meta.gateConstraints ?? {};

    // Retrieval + ranking tags (from AdSelectionService)
     /*
     * Retrieval and ranking labels identify which pipeline variant was used.
     */
    const retrieval = meta.retrieval ?? null;
    const ranking = meta.ranking ?? null;

    return {
       /*
       * Trace version allows future schema changes while preserving
       * compatibility with existing decision records.
       */
      version: "v2_hybrid_bm25_candidates_embedding_rerank",
       /*
       * Timestamp captures when the trace was generated.
       */
      timestamp: new Date().toISOString(),

       // DB / trace linkage (helps audits)
      /*
       * References link this trace back to the conversation, snapshot,
       * turn, and decision record.
       */
      refs: {
        conversationId: meta.conversationId ?? null,
        snapshotId: meta.snapshotId ?? null,
        turnIndex: meta.turnIndex ?? null,
        decisionId: meta.decisionId ?? null,
      },

      // 1) What the system believed about the conversation
       /*
       * Context section records the system's interpretation of the current
       * conversation state at selection time.
       */
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
      /*
       * Policy section records whether ad selection was gated or constrained.
       */
      policy: {
        gated,
        gateReasons,
        constraints: gateConstraints,
      },

      // 3) What happened in selection (high-level, human readable)
       /*
       * Pipeline section summarises retrieval/ranking strategy and candidate flow.
       */
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
      /*
       * Decision section stores either the selected ad or the reason no ad was selected.
       */
      decision: chosen
        ? {
            chosenAdId: chosen.adId,
            score: chosen.score,
            reason: chosen.reason,

            /*
             * Human-readable explanation used by admin tools and “why this ad?” UI.
             */
            explanation: this._explainChoice({ chosen, contextCard, meta }),

             /*
             * Debug data is retained for technical inspection but is not required
             * for normal user-facing explanation.
             */
            debug: chosen._debug || null,

            /*
             * Ranking signals expose the main factors behind the selected ad score.
             */
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

             /*
             * No-ad reason distinguishes between policy blocking,
             * safety restriction, and relevance failure.
             */
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
       /*
       * Alternatives preserve the top scored candidates for later review.
       *
       * This helps explain whether the chosen ad was clearly stronger than
       * other options or only narrowly selected.
       */
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

   /*
   * Builds a concise human-readable explanation for the selected ad.
   */
  _explainChoice({ chosen, contextCard, meta }) {
    /*
     * Use only a small number of terms so the explanation stays readable.
     */
    const kws = (contextCard?.keywords || []).slice(0, 6);
    const phs = (contextCard?.phrases || []).slice(0, 3);

    /*
     * Prefer queryTerms because they reflect the retrieval input more directly
     * than raw keywords or phrases.
     */
    const queryTerms = Array.isArray(meta?.queryTerms) ? meta.queryTerms.slice(0, 10) : null;

    /*
     * Retrieve lexical and semantic ranking signals where available.
     */
    const bm25 = chosen?.bm25Score ?? chosen?._debug?.bm25Score ?? null;
    const embedSim = chosen?._debug?.embedSim ?? null;

    const parts = [];

     /*
     * Semantic match indicates similarity between the query embedding
     * and the advertisement embedding.
     */
    if (embedSim !== null && embedSim !== undefined) {
      parts.push(`High semantic match (embedSim=${Number(embedSim).toFixed(3)})`);
    }

     /*
     * BM25 score indicates lexical relevance between query terms and indexed ad text.
     */
    if (bm25 !== null && bm25 !== undefined) {
      parts.push(`Strong lexical match (bm25=${Number(bm25).toFixed(3)})`);
    }

     /*
     * Include the terms that most directly explain the retrieval decision.
     */
    if (queryTerms && queryTerms.length) parts.push(`Query terms: ${queryTerms.join(", ")}`);
    else {
      if (phs.length) parts.push(`Key phrases: ${phs.join(", ")}`);
      if (kws.length) parts.push(`Keywords: ${kws.join(", ")}`);
    }

    /*
     * Fallback explanation when no detailed ranking signals are available.
     */
    if (!parts.length) return "Selected as highest-ranked candidate under the current ranking policy.";
    return parts.join(" | ");
  }
}

module.exports = DecisionTracer;
